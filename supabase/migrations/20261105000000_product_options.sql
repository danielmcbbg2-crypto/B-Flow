-- Product options (variants): a product can offer up to 3 choices (e.g. Size: 600 / 750 / 900 mm,
-- Colour: White / Oak), and the customer picks one value of each. A value can cost extra: on an
-- automatically priced product the office enters what it costs us extra, and each tier's add-on is
-- that cost at the tier's margin, rounded up to the dollar (so the total never falls below the
-- margin); on a product priced by hand the office enters the extra price, the same for everyone.
--
-- What each tier sees follows the prices' own rules: the structure and the public add-ons are on the
-- product (anyone can read published products), the client and trade add-ons sit with the client
-- and trade prices, and the extra costs with the supplier details (store managers only).
--
--   products.options             [{id, name, values: [{id, label, price, available}]}]  price = public add-on
--   product_sources.option_costs {value id: extra cost}
--   product_client_prices.option_prices / product_trade_prices.option_prices  {value id: add-on}
--   order_items.options          what was chosen, e.g. "Size: 900 mm · Colour: Oak"

-- The options' shape: up to 3 options, each named with 1 to 30 values, every id unique.
create function public.valid_product_options(o jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(o) = 'array' and jsonb_array_length(o) <= 3
    and not exists (
      select 1 from jsonb_array_elements(o) g
      where jsonb_typeof(g) <> 'object'
         or jsonb_typeof(g -> 'id') is distinct from 'string' or btrim(g ->> 'id') = ''
         or jsonb_typeof(g -> 'name') is distinct from 'string' or btrim(g ->> 'name') = '' or length(g ->> 'name') > 60
         or jsonb_typeof(g -> 'values') is distinct from 'array' or jsonb_array_length(g -> 'values') not between 1 and 30
         or exists (
           select 1 from jsonb_array_elements(g -> 'values') v
           where jsonb_typeof(v) <> 'object'
              or jsonb_typeof(v -> 'id') is distinct from 'string' or btrim(v ->> 'id') = ''
              or jsonb_typeof(v -> 'label') is distinct from 'string' or btrim(v ->> 'label') = '' or length(v ->> 'label') > 80
              or jsonb_typeof(v -> 'price') is distinct from 'number' or (v ->> 'price')::numeric < 0
              or jsonb_typeof(v -> 'available') is distinct from 'boolean'
         )
    )
    and (select count(*) = count(distinct g ->> 'id') from jsonb_array_elements(o) g)
    and (select count(*) = count(distinct v ->> 'id') from jsonb_array_elements(o) g, jsonb_array_elements(g -> 'values') v)
$$;

-- {value id: amount} with every amount a number of at least 0.
create function public.valid_amounts(o jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(o) = 'object'
    and not exists (select 1 from jsonb_each(o) e where jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}')::numeric < 0)
$$;

alter table public.products add column if not exists options jsonb not null default '[]'
  constraint product_options check (public.valid_product_options(options));
alter table public.product_sources add column if not exists option_costs jsonb not null default '{}'
  constraint option_costs check (public.valid_amounts(option_costs));
alter table public.product_client_prices add column if not exists option_prices jsonb not null default '{}'
  constraint client_option_prices check (public.valid_amounts(option_prices));
alter table public.product_trade_prices add column if not exists option_prices jsonb not null default '{}'
  constraint trade_option_prices check (public.valid_amounts(option_prices));
alter table public.order_items add column if not exists options text not null default '';

-- An extra cost at a margin, rounded up to the dollar (0 for none).
create function public.option_add_on(p_cost numeric, p_margin numeric) returns numeric
language sql immutable set search_path = '' as $$
  select case when p_cost is null or p_cost <= 0 then 0
              when p_margin is null or p_margin < 0 or p_margin >= 100 then null
              else ceil(round(p_cost / (1 - p_margin / 100), 4)) end
$$;

-- Each value's add-on for a tier from its extra cost (automatically priced products).
create function public.auto_option_prices(p_product text, p_tier text, p_options jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(v ->> 'id', public.option_add_on(coalesce((s.option_costs ->> (v ->> 'id'))::numeric, 0), (st.pricing ->> p_tier)::numeric)), '{}')
    from public.product_sources s, public.settings st, jsonb_array_elements(p_options) g, jsonb_array_elements(g -> 'values') v
   where s.id = p_product and st.id = 1
$$;

-- The options with each value's price replaced from {value id: add-on}.
create function public.options_with_prices(p_options jsonb, p_prices jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(
           jsonb_set(g, '{values}', (
             select jsonb_agg(jsonb_set(v, '{price}', coalesce(p_prices -> (v ->> 'id'), '0'::jsonb)) order by vi)
               from jsonb_array_elements(g -> 'values') with ordinality as x (v, vi)
           )) order by gi), '[]')
    from jsonb_array_elements(p_options) with ordinality as y (g, gi)
$$;

-- Each value's (public) add-on, as {value id: add-on}.
create function public.option_prices_of(p_options jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(v ->> 'id', v -> 'price'), '{}')
    from jsonb_array_elements(p_options) g, jsonb_array_elements(g -> 'values') v
$$;

-- Automatic pricing sets the options' public add-ons along with the price.
create or replace function public.enforce_public_price() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  auto numeric := public.auto_price_for(new.id, 'public');
begin
  if auto is not null then
    new.price := auto;
    new.options := public.options_with_prices(new.options, public.auto_option_prices(new.id, 'public', new.options));
  end if;
  return new;
end;
$$;
create or replace trigger enforce_public_price before insert or update of price, options on public.products
  for each row execute function public.enforce_public_price();

-- Client and trade add-ons: from the extra costs at the tier's margin, or (priced by hand) the same
-- as the public add-ons.
create or replace function public.enforce_tier_price() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  auto numeric := public.auto_price_for(new.id, tg_argv[0]);
  opts jsonb := coalesce((select options from public.products where id = new.id), '[]');
begin
  if auto is not null then
    new.price := auto;
    new.option_prices := public.auto_option_prices(new.id, tg_argv[0], opts);
  else
    new.option_prices := public.option_prices_of(opts);
  end if;
  return new;
end;
$$;

-- New or changed options: the client and trade add-ons follow.
create function public.refresh_tier_options() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.options is distinct from old.options then
    update public.product_client_prices set price = price where id = new.id;
    update public.product_trade_prices set price = price where id = new.id;
  end if;
  return null;
end;
$$;
create trigger refresh_tier_options after update of options on public.products
  for each row execute function public.refresh_tier_options();

-- New extra costs reprice the product, like a new cost.
create or replace function public.reprice_on_source() returns trigger
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
  elsif new.option_costs is distinct from old.option_costs then
    perform public.reprice_product(new.id, 'Option costs changed');
  end if;
  return null;
end;
$$;
create or replace trigger reprice_on_source after insert or update of cost, supplier_price, auto_price, option_costs on public.product_sources
  for each row execute function public.reprice_on_source();

revoke execute on function public.auto_option_prices(text, text, jsonb), public.refresh_tier_options() from public, anon, authenticated;

-- Existing products' client and trade rows pick up the (empty) add-ons.
update public.product_client_prices set price = price;
update public.product_trade_prices set price = price;

-- Orders: each item can carry the options chosen ({option id: value id}); the same product with
-- different choices is a separate line. Every option must be chosen, from values still available,
-- and the price is the tier's price plus the tier's add-ons.
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
  bad       text[] := '{}';
  line      record;
  prod      public.products;
  tier      jsonb;
  base      numeric;
  g         jsonb;
  v         jsonb;
  vid       text;
  extra     numeric;
  chosen    text[];
  lines     jsonb := '[]';
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
  if exists (select 1 from jsonb_array_elements(p_items) i where jsonb_typeof(i) <> 'object' or (i ? 'options' and jsonb_typeof(i -> 'options') not in ('object', 'null'))) then
    raise exception 'Something in your cart isn''t right. Remove it and add it again.';
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

  -- The same product with the same choices counts once, with the quantities added up.
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'options', options, 'qty', qty)) into cart
    from (
      select i.product_id, coalesce(i.options, '{}') as options, sum(i.qty)::integer as qty
      from jsonb_to_recordset(p_items) as i (product_id text, qty integer, options jsonb)
      group by i.product_id, coalesce(i.options, '{}')
    ) c;
  if exists (select 1 from jsonb_to_recordset(cart) as c (product_id text, qty integer)
             where c.product_id is null or c.qty is null or c.qty not between 1 and 99) then
    raise exception 'Each item needs a quantity from 1 to 99';
  end if;

  -- Each line's price and what was chosen; anything no longer available is listed together.
  for line in select * from jsonb_to_recordset(cart) as c (product_id text, options jsonb, qty integer) loop
    select * into prod from public.products where id = line.product_id;
    if not found or prod.status <> 'published' or prod.stock = 'out_of_stock' then
      bad := bad || coalesce(prod.title, 'an item');
      continue;
    end if;
    tier := null;
    base := null;
    if is_trade then
      select to_jsonb(t) into tier from public.product_trade_prices t where t.id = prod.id;
    elsif is_client then
      select to_jsonb(t) into tier from public.product_client_prices t where t.id = prod.id;
    end if;
    base := coalesce((tier ->> 'price')::numeric, prod.price);
    if exists (select 1 from jsonb_object_keys(line.options) k
               where not exists (select 1 from jsonb_array_elements(prod.options) o where o ->> 'id' = k)) then
      raise exception 'The options chosen for % have changed. Remove it and add it again.', prod.title;
    end if;
    extra := 0;
    chosen := '{}';
    for g in select value from jsonb_array_elements(prod.options) loop
      vid := line.options ->> (g ->> 'id');
      v := (select value from jsonb_array_elements(g -> 'values') where value ->> 'id' = vid);
      if vid is null or v is null then
        raise exception 'Choose the % for %', lower(g ->> 'name'), prod.title;
      end if;
      if not (v ->> 'available')::boolean then
        bad := bad || (prod.title || ' (' || (v ->> 'label') || ')');
      end if;
      extra := extra + coalesce((tier -> 'option_prices' ->> vid)::numeric, (v ->> 'price')::numeric, 0);
      chosen := chosen || ((g ->> 'name') || ': ' || (v ->> 'label'));
    end loop;
    lines := lines || jsonb_build_object('product_id', prod.id, 'title', prod.title, 'sku', prod.sku, 'unit_price', base + extra,
                                         'qty', line.qty, 'options', array_to_string(chosen, ' · '));
  end loop;
  if cardinality(bad) > 0 then raise exception 'No longer available: %', array_to_string(bad, ', '); end if;

  insert into public.orders (customer_id, name, email, phone, delivery, address, notes, trade, total)
    values (me, p_name, p_email, p_phone, p_delivery, p_address, p_notes, is_trade, 0)
    returning id, number into o_id, o_number;
  insert into public.order_items (order_id, product_id, title, sku, unit_price, qty, options)
    select o_id, l.product_id, l.title, l.sku, l.unit_price, l.qty, l.options
    from jsonb_to_recordset(lines) as l (product_id text, title text, sku text, unit_price numeric, qty integer, options text);
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
