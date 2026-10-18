-- Online store: vanities, shower screens, tapware and more. Anyone can browse published products
-- and place an order (no payment online: the office confirms it and the customer pays by invoice or
-- bank transfer). Signed-in service providers see trade prices where one is set. Prices are always
-- worked out here, from the database, never taken from the browser.

create table public.products (
  id          text primary key default gen_random_uuid()::text,
  title       text not null,
  description text not null default '',
  category    text not null default 'Other',
  brand       text not null default '',
  sku         text not null default '',
  price       numeric(12, 2) not null check (price >= 0),
  images      text[] not null default '{}',
  status      text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  stock       text not null default 'in_stock' check (stock in ('in_stock', 'to_order', 'out_of_stock')),
  created_by  text references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Trade prices: seen by service providers and store managers only.
-- Keyed by the product's id (one row per product).
create table public.product_trade_prices (
  id    text primary key references public.products (id) on delete cascade,
  price numeric(12, 2) not null check (price >= 0)
);

-- Supplier, cost and where it was found: store managers only.
create table public.product_sources (
  id         text primary key references public.products (id) on delete cascade,
  supplier   text not null default '',
  source_url text not null default '',
  cost       numeric(12, 2) check (cost >= 0),
  notes      text not null default ''
);

create table public.orders (
  id          text primary key default gen_random_uuid()::text,
  number      integer generated always as identity (start with 5001) unique,
  -- The signed-in client or service provider who ordered; null for a visitor.
  customer_id text references public.profiles (id) on delete set null,
  name        text not null,
  email       text not null,
  phone       text not null,
  delivery    text not null check (delivery in ('pickup', 'delivery')),
  address     text not null default '',
  notes       text not null default '',
  -- Priced at trade (a service provider's order).
  trade       boolean not null default false,
  total       numeric(12, 2) not null,
  status      text not null default 'new' check (status in ('new', 'confirmed', 'paid', 'fulfilled', 'cancelled')),
  admin_notes text not null default '',
  created_at  timestamptz not null default now()
);

create table public.order_items (
  id         text primary key default gen_random_uuid()::text,
  order_id   text not null references public.orders (id) on delete cascade,
  product_id text references public.products (id) on delete set null,
  title      text not null,
  sku        text not null default '',
  unit_price numeric(12, 2) not null,
  qty        integer not null check (qty between 1 and 99)
);

create index on public.products (status);
create index on public.orders (customer_id);
create index on public.order_items (order_id);

alter table public.products enable row level security;
alter table public.product_trade_prices enable row level security;
alter table public.product_sources enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Who can manage the store. Granted to the admins who can already manage accounts (the owner).
update public.profiles set permissions = array_append(permissions, 'canManageStore')
  where role = 'admin' and 'canEditPermissions' = any (permissions) and not 'canManageStore' = any (permissions);

-- Products: visitors see published ones; store managers see and change everything.
create policy products_public on public.products for select to anon using (status = 'published');
create policy products_select on public.products for select to authenticated
  using (status = 'published' or has_perm('canManageStore'));
create policy products_insert on public.products for insert to authenticated with check (has_perm('canManageStore'));
create policy products_update on public.products for update to authenticated using (has_perm('canManageStore'));
create policy products_delete on public.products for delete to authenticated using (has_perm('canManageStore'));

create policy trade_prices_select on public.product_trade_prices for select to authenticated using (
  has_perm('canManageStore')
  or (current_role_name() = 'provider' and exists (select 1 from public.products p where p.id = product_trade_prices.id and p.status = 'published'))
);
create policy trade_prices_insert on public.product_trade_prices for insert to authenticated with check (has_perm('canManageStore'));
create policy trade_prices_update on public.product_trade_prices for update to authenticated using (has_perm('canManageStore'));
create policy trade_prices_delete on public.product_trade_prices for delete to authenticated using (has_perm('canManageStore'));

create policy sources_select on public.product_sources for select to authenticated using (has_perm('canManageStore'));
create policy sources_insert on public.product_sources for insert to authenticated with check (has_perm('canManageStore'));
create policy sources_update on public.product_sources for update to authenticated using (has_perm('canManageStore'));
create policy sources_delete on public.product_sources for delete to authenticated using (has_perm('canManageStore'));

-- Orders: the customer sees their own; store managers see all and move them along. Orders are only
-- ever created by place_order below, and kept (cancel instead of deleting).
create policy orders_select on public.orders for select to authenticated
  using (customer_id = current_profile_id() or has_perm('canManageStore'));
create policy orders_update on public.orders for update to authenticated using (has_perm('canManageStore'));
create policy order_items_select on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

-- Store managers may only change an order's progress and their own notes; what was ordered, by
-- whom and for how much stays as placed.
create function public.guard_order_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not public.is_api_user() then return new; end if;
  if (to_jsonb(new) - array['status', 'admin_notes']) is distinct from (to_jsonb(old) - array['status', 'admin_notes']) then
    raise exception 'Only an order''s status and notes can be changed';
  end if;
  return new;
end;
$$;
create trigger guard_order_update before update on public.orders
  for each row execute function public.guard_order_update();

-- Products record who added them (an admin, or the AI assistant's draft saved by one).
create trigger stamp_created_by before insert or update on public.products
  for each row execute function public.stamp_created_by();

-- Places an order for anyone, signed in or not. Items are [{ "product_id": "...", "qty": 2 }].
-- Prices come from the products (trade price for a signed-in service provider, where set); only
-- published products that aren't out of stock can be ordered. Every admin gets an inbox message.
create function public.place_order(
  p_items jsonb, p_name text, p_email text, p_phone text, p_delivery text, p_address text default '', p_notes text default ''
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me        text := public.current_profile_id();
  is_trade  boolean := exists (select 1 from public.profiles where id = me and role = 'provider' and status = 'active');
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
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'Your cart is empty';
  end if;

  -- Slows down anyone flooding the order form.
  if (select count(*) from public.orders where lower(email) = lower(p_email) and created_at > now() - interval '1 hour') >= 5
     or (me is null and (select count(*) from public.orders where customer_id is null and created_at > now() - interval '10 minutes') >= 30) then
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
           case when is_trade and t.price is not null then t.price else p.price end, c.qty
    from jsonb_to_recordset(cart) as c (product_id text, qty integer)
    join public.products p on p.id = c.product_id
    left join public.product_trade_prices t on t.id = p.id;
  select sum(unit_price * qty), sum(qty) into o_total, o_count from public.order_items where order_id = o_id;
  update public.orders set total = o_total where id = o_id;

  insert into public.inbox (user_id, title, body)
    select id, 'New store order #' || o_number,
           p_name || case when is_trade then ' (trade)' else '' end || ' — ' || o_count || ' item(s), $'
             || to_char(o_total, 'FM999,999,990.00') || ', ' || p_delivery
    from public.profiles where role = 'admin' and status = 'active';

  return jsonb_build_object('id', o_id, 'number', o_number, 'total', o_total);
end;
$$;

revoke execute on function public.place_order(jsonb, text, text, text, text, text, text) from public;
grant execute on function public.place_order(jsonb, text, text, text, text, text, text) to anon, authenticated;
revoke execute on function public.guard_order_update() from public, anon;

alter publication supabase_realtime add table
  public.products, public.product_trade_prices, public.product_sources, public.orders, public.order_items;
