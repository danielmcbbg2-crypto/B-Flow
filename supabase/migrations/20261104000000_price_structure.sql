-- The store's price structure: every product has three prices, each set from what it costs us at a
-- fixed margin (on the selling price, so 30% margin = cost ÷ 0.70), rounded up to the dollar:
--   public   visitors and anyone not signed in      30%
--   client   signed-in clients                       25%
--   trade    signed-in service providers (trades)    17%
-- The margins are in settings.pricing (the office can change them). "What it costs us" is the cost
-- the office enters for the product, or else the supplier's price as last read from their page, so
-- when the supplier changes their price the store's prices follow. A product can be taken off
-- automatic pricing (auto_price) to set its prices by hand.
--
-- Every change to a product's prices is kept in product_price_history (why, the cost it was based
-- on, the three prices, and who changed it, if a person did).

alter table public.settings add column if not exists pricing jsonb not null default '{"public": 30, "client": 25, "trade": 17}';

alter table public.product_sources add column if not exists auto_price boolean not null default true;

-- The signed-in clients' price (store managers set it; clients see it on published products).
create table public.product_client_prices (
  id    text primary key references public.products (id) on delete cascade,
  price numeric(12, 2) not null check (price >= 0)
);
alter table public.product_client_prices enable row level security;
create policy client_prices_select on public.product_client_prices for select to authenticated using (
  has_perm('canManageStore')
  or (current_role_name() = 'client' and exists (select 1 from public.products p where p.id = product_client_prices.id and p.status = 'published'))
);
create policy client_prices_insert on public.product_client_prices for insert to authenticated with check (has_perm('canManageStore'));
create policy client_prices_update on public.product_client_prices for update to authenticated using (has_perm('canManageStore'));
create policy client_prices_delete on public.product_client_prices for delete to authenticated using (has_perm('canManageStore'));

create table public.product_price_history (
  id           uuid primary key default gen_random_uuid(),
  product_id   text not null references public.products (id) on delete cascade,
  at           timestamptz not null default now(),
  reason       text not null default '',
  cost_basis   numeric(12, 2),
  public_price numeric(12, 2),
  client_price numeric(12, 2),
  trade_price  numeric(12, 2),
  changed_by   text references public.profiles (id) on delete set null
);
create index on public.product_price_history (product_id, at);
create index on public.product_price_history (changed_by);
alter table public.product_price_history enable row level security;
create policy price_history_select on public.product_price_history for select to authenticated using (has_perm('canManageStore'));

-- A price at a margin on the selling price, rounded up to the dollar (never below the margin).
create function public.price_at_margin(p_cost numeric, p_margin numeric) returns numeric
language sql immutable set search_path = '' as $$
  select case when p_cost is null or p_cost <= 0 or p_margin is null or p_margin < 0 or p_margin >= 100 then null
              else ceil(round(p_cost / (1 - p_margin / 100), 4)) end
$$;

-- The product's price for a tier ('public', 'client' or 'trade') under automatic pricing, or null
-- when it isn't automatically priced (no supplier details, pricing off, or nothing to base it on).
create function public.auto_price_for(p_product text, p_tier text) returns numeric
language sql stable security definer set search_path = '' as $$
  select public.price_at_margin(coalesce(s.cost, s.supplier_price), (st.pricing ->> p_tier)::numeric)
    from public.product_sources s, public.settings st
   where s.id = p_product and s.auto_price and st.id = 1
$$;

-- What the product's prices are based on and what they are, now.
create function public.record_price(p_product text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  basis numeric;
  pub numeric;
  cli numeric;
  tra numeric;
  last public.product_price_history;
begin
  select coalesce(s.cost, s.supplier_price) into basis from public.product_sources s where s.id = p_product;
  select price into pub from public.products where id = p_product;
  if not found then return; end if;
  select price into cli from public.product_client_prices where id = p_product;
  select price into tra from public.product_trade_prices where id = p_product;
  select * into last from public.product_price_history where product_id = p_product order by at desc, id desc limit 1;
  if found and last.public_price is not distinct from pub and last.client_price is not distinct from cli
     and last.trade_price is not distinct from tra and last.cost_basis is not distinct from basis then
    return;
  end if;
  insert into public.product_price_history (product_id, reason, cost_basis, public_price, client_price, trade_price, changed_by)
  values (p_product, left(p_reason, 120), basis, pub, cli, tra, public.current_profile_id());
end;
$$;

-- Sets all three prices of an automatically priced product (and records them).
create function public.reprice_product(p_product text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.auto_price_for(p_product, 'public') is null then return; end if;
  perform set_config('npm.repricing', 'on', true);
  -- The triggers below put in the right prices; these only make them run.
  update public.products set price = price where id = p_product;
  insert into public.product_client_prices (id, price) values (p_product, 0) on conflict (id) do update set price = excluded.price;
  insert into public.product_trade_prices (id, price) values (p_product, 0) on conflict (id) do update set price = excluded.price;
  perform set_config('npm.repricing', 'off', true);
  perform public.record_price(p_product, p_reason);
end;
$$;

-- Automatic pricing wins over any price sent in, for each tier. (These triggers run as the owner:
-- the helpers they use are closed to everyone else, as they'd reveal other tiers' prices.)
create function public.enforce_public_price() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  auto numeric := public.auto_price_for(new.id, 'public');
begin
  if auto is not null then new.price := auto; end if;
  return new;
end;
$$;
create trigger enforce_public_price before insert or update of price on public.products
  for each row execute function public.enforce_public_price();

create function public.enforce_tier_price() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  auto numeric := public.auto_price_for(new.id, tg_argv[0]);
begin
  if auto is not null then new.price := auto; end if;
  return new;
end;
$$;
create trigger enforce_client_price before insert or update on public.product_client_prices
  for each row execute function public.enforce_tier_price('client');
create trigger enforce_trade_price before insert or update on public.product_trade_prices
  for each row execute function public.enforce_tier_price('trade');

-- Prices set by hand (automatic pricing off) are recorded too.
create function public.record_price_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('npm.repricing', true), 'off') <> 'on' then
    perform public.record_price(new.id, case when tg_op = 'INSERT' then 'Product added' else 'Price set by hand' end);
  end if;
  return null;
end;
$$;
create trigger record_public_price after insert or update of price on public.products
  for each row execute function public.record_price_change();
create trigger record_client_price after insert or update on public.product_client_prices
  for each row execute function public.record_price_change();
create trigger record_trade_price after insert or update on public.product_trade_prices
  for each row execute function public.record_price_change();

-- A new cost, a new supplier price, or automatic pricing switched on: the prices follow.
create function public.reprice_on_source() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.reprice_product(new.id, 'Priced automatically');
  elsif new.auto_price and not old.auto_price then
    perform public.reprice_product(new.id, 'Automatic pricing switched on');
  elsif new.cost is distinct from old.cost then
    perform public.reprice_product(new.id, 'Cost changed');
  elsif new.supplier_price is distinct from old.supplier_price then
    perform public.reprice_product(new.id, 'Supplier price changed');
  end if;
  return null;
end;
$$;
create trigger reprice_on_source after insert or update of cost, supplier_price, auto_price on public.product_sources
  for each row execute function public.reprice_on_source();

-- New margins: every automatically priced product follows.
create function public.reprice_on_margins() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  pid text;
begin
  if new.pricing is distinct from old.pricing then
    for pid in select id from public.product_sources where auto_price loop
      perform public.reprice_product(pid, 'Margins changed');
    end loop;
  end if;
  return null;
end;
$$;
create trigger reprice_on_margins after update of pricing on public.settings
  for each row execute function public.reprice_on_margins();

revoke execute on function public.auto_price_for(text, text), public.record_price(text, text), public.reprice_product(text, text),
  public.enforce_public_price(), public.enforce_tier_price(), public.record_price_change(), public.reprice_on_source(),
  public.reprice_on_margins() from public, anon, authenticated;

-- The margins must make sense: each between 0 and 95%.
alter table public.settings add constraint pricing_margins check (
  (pricing ->> 'public')::numeric between 0 and 95 and (pricing ->> 'client')::numeric between 0 and 95 and (pricing ->> 'trade')::numeric between 0 and 95
);

-- Orders: signed-in clients pay the client price, trades the trade price, everyone else the public price.
create or replace function public.place_order(
  p_items jsonb, p_name text, p_email text, p_phone text, p_delivery text, p_address text default '', p_notes text default ''
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me        text := public.current_profile_id();
  my_role   text := (select role from public.profiles where id = me and status = 'active');
  is_trade  boolean := coalesce(my_role = 'provider', false);
  is_client boolean := coalesce(my_role = 'client', false);
  -- Cloudflare, in front of the API, sets cf-connecting-ip and the client can't change it
  -- (x-forwarded-for is only a fallback).
  headers   json := nullif(current_setting('request.headers', true), '')::json;
  caller_ip text := nullif(btrim(coalesce(headers->>'cf-connecting-ip', split_part(headers->>'x-forwarded-for', ',', 1))), '');
  o_id      text;
  o_number  integer;
  o_total   numeric(12, 2);
  o_count   integer;
  cart      jsonb;
  bad       text;
begin
  p_name := btrim(coalesce(p_name, ''));
  p_email := btrim(coalesce(p_email, ''));
  p_phone := btrim(coalesce(p_phone, ''));
  p_address := btrim(coalesce(p_address, ''));
  p_notes := btrim(coalesce(p_notes, ''));
  if p_name = '' or length(p_name) > 120 then raise exception 'Enter your name'; end if;
  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(p_email) > 200 then raise exception 'Enter a valid email address'; end if;
  if length(regexp_replace(p_phone, '\D', '', 'g')) < 8 or length(p_phone) > 40 then raise exception 'Enter a phone number we can reach you on'; end if;
  if p_delivery not in ('pickup', 'delivery') then raise exception 'Choose pickup or delivery'; end if;
  if p_delivery = 'delivery' and p_address = '' then raise exception 'Enter the delivery address'; end if;
  if length(p_address) > 300 or length(p_notes) > 2000 then raise exception 'Address or notes are too long'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception 'Up to 30 different products per order. Please split it into two orders.';
  end if;

  -- Slows down anyone flooding the order form, without blocking other people.
  if me is not null then
    if (select count(*) from public.orders where customer_id = me and created_at > now() - interval '1 hour') >= 10 then
      raise exception 'Too many orders just now. Please call us or try again later.';
    end if;
  elsif (select count(*) from public.orders
          where customer_id is null and lower(email) = lower(p_email) and created_at > now() - interval '1 hour') >= 5
     or (caller_ip is not null and (select count(*) from public.order_attempts a
          where a.ip = caller_ip and a.created_at > now() - interval '1 hour') >= 5)
     or (select count(*) from public.orders where customer_id is null and created_at > now() - interval '10 minutes') >= 100 then
    raise exception 'Too many orders just now. Please call us or try again later.';
  end if;

  -- The same product twice counts once, with the quantities added up.
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'qty', qty)) into cart
    from (
      select i.product_id, sum(i.qty)::integer as qty
      from jsonb_to_recordset(p_items) as i (product_id text, qty integer)
      group by i.product_id
    ) c;
  if exists (select 1 from jsonb_to_recordset(cart) as c (product_id text, qty integer)
             where c.product_id is null or c.qty is null or c.qty not between 1 and 99) then
    raise exception 'Each item needs a quantity from 1 to 99';
  end if;
  select string_agg(coalesce(p.title, 'an item'), ', ') into bad
    from jsonb_to_recordset(cart) as c (product_id text, qty integer)
    left join public.products p on p.id = c.product_id
    where p.id is null or p.status <> 'published' or p.stock = 'out_of_stock';
  if bad is not null then raise exception 'No longer available: %', bad; end if;

  insert into public.orders (customer_id, name, email, phone, delivery, address, notes, trade, total)
    values (me, p_name, p_email, p_phone, p_delivery, p_address, p_notes, is_trade, 0)
    returning id, number into o_id, o_number;
  insert into public.order_items (order_id, product_id, title, sku, unit_price, qty)
    select o_id, p.id, p.title, p.sku,
           case when is_trade and t.price is not null then t.price
                when is_client and cp.price is not null then cp.price
                else p.price end, c.qty
    from jsonb_to_recordset(cart) as c (product_id text, qty integer)
    join public.products p on p.id = c.product_id
    left join public.product_trade_prices t on t.id = p.id
    left join public.product_client_prices cp on cp.id = p.id;
  select sum(unit_price * qty), sum(qty) into o_total, o_count from public.order_items where order_id = o_id;
  update public.orders set total = o_total where id = o_id;

  if me is null and caller_ip is not null then
    delete from public.order_attempts where created_at < now() - interval '1 day';
    insert into public.order_attempts (ip) values (caller_ip);
  end if;

  insert into public.inbox (user_id, title, body)
    select id, 'New store order #' || o_number,
           p_name || case when is_trade then ' (trade)' when is_client then ' (client)' else '' end || ' — ' || o_count || ' item(s), $'
             || to_char(o_total, 'FM999,999,990.00') || ', ' || p_delivery
    from public.profiles where role = 'admin' and status = 'active';

  return jsonb_build_object('id', o_id, 'number', o_number, 'total', o_total);
end;
$$;

-- Supplier price changes are worth knowing about: store managers are told what changed and what
-- the store's prices are now (apply_supplier_stock records each reading).
create function public.notify_supplier_price() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.products;
  cli numeric;
  tra numeric;
begin
  if old.supplier_price is null or new.supplier_price is null or new.supplier_price = old.supplier_price then return null; end if;
  select * into p from public.products where id = new.id;
  select price into cli from public.product_client_prices where id = new.id;
  select price into tra from public.product_trade_prices where id = new.id;
  insert into public.inbox (user_id, title, body)
  select pr.id,
         left('Supplier price ' || case when new.supplier_price > old.supplier_price then 'up' else 'down' end || ': ' || p.title, 200),
         left(coalesce(nullif(new.supplier, ''), 'The supplier') || ' now charges $' || to_char(new.supplier_price, 'FM999,999,990.00')
           || ' (was $' || to_char(old.supplier_price, 'FM999,999,990.00') || '). '
           || case when new.auto_price and new.cost is null
                   then 'Your prices are now $' || to_char(p.price, 'FM999,999,990') || ' public, $' || coalesce(to_char(cli, 'FM999,999,990'), '—')
                        || ' for clients and $' || coalesce(to_char(tra, 'FM999,999,990'), '—') || ' for trades.'
                   when new.cost is not null then 'Your prices are based on the cost you entered ($' || to_char(new.cost, 'FM999,999,990.00') || '), so they haven''t changed.'
                   else 'Automatic pricing is off for this product, so its prices haven''t changed.' end,
           2000)
    from public.profiles pr
   where pr.role = 'admin' and pr.status = 'active' and 'canManageStore' = any (pr.permissions);
  return null;
end;
$$;
-- Named to run after reprice_on_source (triggers fire in name order), so the new prices are known.
create trigger reprice_zz_notify_supplier_price after update of supplier_price on public.product_sources
  for each row execute function public.notify_supplier_price();
revoke execute on function public.notify_supplier_price() from public, anon, authenticated;

-- Products already tracked start on the new price structure now.
do $$
declare
  pid text;
begin
  for pid in select id from public.product_sources loop
    perform public.reprice_product(pid, 'Price structure introduced');
  end loop;
end;
$$;
