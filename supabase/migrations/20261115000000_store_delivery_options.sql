-- Delivery options at checkout: pickup, Melbourne standard delivery (1 to 3 business days, still
-- 'delivery'), Melbourne same-day delivery and Australia-wide delivery. Every delivery cost is
-- confirmed by the office after the order. Installation is offered in metro Melbourne only, so it
-- can't be combined with Australia-wide delivery.

alter table public.orders drop constraint if exists orders_delivery_check;
alter table public.orders add constraint orders_delivery_check check (delivery in ('pickup', 'delivery', 'same_day', 'australia'));
comment on column public.orders.delivery is 'pickup, delivery (Melbourne standard, 1-3 business days), same_day (Melbourne) or australia (quoted to the address).';

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
  installs  text;
  cl        text;
  prop      text;
  q_id      text;
  q_number  integer;
begin
  p_name := btrim(coalesce(p_name, ''));
  p_email := btrim(coalesce(p_email, ''));
  p_phone := btrim(coalesce(p_phone, ''));
  p_address := btrim(coalesce(p_address, ''));
  p_notes := btrim(coalesce(p_notes, ''));
  if p_name = '' or length(p_name) > 120 then raise exception 'Enter your name'; end if;
  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(p_email) > 200 then raise exception 'Enter a valid email address'; end if;
  if length(regexp_replace(p_phone, '\D', '', 'g')) < 8 or length(p_phone) > 40 then raise exception 'Enter a phone number we can reach you on'; end if;
  if p_delivery not in ('pickup', 'delivery', 'same_day', 'australia') then raise exception 'Choose pickup or a delivery option'; end if;
  if p_delivery <> 'pickup' and p_address = '' then raise exception 'Enter the delivery address'; end if;
  if length(p_address) > 300 or length(p_notes) > 2000 then raise exception 'Address or notes are too long'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception 'Up to 30 different products per order. Please split it into two orders.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) i
             where jsonb_typeof(i) <> 'object'
                or (i ? 'options' and jsonb_typeof(i -> 'options') not in ('object', 'null'))
                or (i ? 'install' and jsonb_typeof(i -> 'install') not in ('boolean', 'null'))) then
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

  -- The same product with the same choices (and the same supply-only or supply-and-install) counts
  -- once, with the quantities added up.
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'options', options, 'qty', qty, 'install', install)) into cart
    from (
      select i.product_id, coalesce(i.options, '{}') as options, coalesce(i.install, false) as install, sum(i.qty)::integer as qty
      from jsonb_to_recordset(p_items) as i (product_id text, qty integer, options jsonb, install boolean)
      group by i.product_id, coalesce(i.options, '{}'), coalesce(i.install, false)
    ) c;
  -- Installing needs somewhere to install it.
  if p_address = '' and exists (select 1 from jsonb_to_recordset(cart) as c (install boolean) where c.install) then
    raise exception 'Enter the address where it''s to be installed';
  end if;
  -- Installation is offered in metro Melbourne only.
  if p_delivery = 'australia' and exists (select 1 from jsonb_to_recordset(cart) as c (install boolean) where c.install) then
    raise exception 'Installation is available in metro Melbourne only. Untick "Install it for me" to order with Australia-wide delivery.';
  end if;
  if exists (select 1 from jsonb_to_recordset(cart) as c (product_id text, qty integer)
             where c.product_id is null or c.qty is null or c.qty not between 1 and 99) then
    raise exception 'Each item needs a quantity from 1 to 99';
  end if;

  -- Each line's price and what was chosen; anything no longer available is listed together.
  for line in select * from jsonb_to_recordset(cart) as c (product_id text, options jsonb, qty integer, install boolean) loop
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
                                         'qty', line.qty, 'options', array_to_string(chosen, ' · '), 'install', line.install);
  end loop;
  if cardinality(bad) > 0 then raise exception 'No longer available: %', array_to_string(bad, ', '); end if;

  insert into public.orders (customer_id, name, email, phone, delivery, address, notes, trade, total)
    values (me, p_name, p_email, p_phone, p_delivery, p_address, p_notes, is_trade, 0)
    returning id, number into o_id, o_number;
  insert into public.order_items (order_id, product_id, title, sku, unit_price, qty, options, install)
    select o_id, l.product_id, l.title, l.sku, l.unit_price, l.qty, l.options, l.install
    from jsonb_to_recordset(lines) as l (product_id text, title text, sku text, unit_price numeric, qty integer, options text, install boolean);
  select sum(unit_price * qty), sum(qty) into o_total, o_count from public.order_items where order_id = o_id;
  update public.orders set total = o_total where id = o_id;

  if me is null and caller_ip is not null then
    delete from public.order_attempts where created_at < now() - interval '1 day';
    insert into public.order_attempts (ip) values (caller_ip);
  end if;

  -- Items to be installed: a quote request in the Quotes pipeline, linked to the order, for the
  -- office to price by hand. It's for the customer's client account: their own when they're a signed-
  -- in client, else a client without a login with their email (made if there isn't one; a login's
  -- email is never reused, so nobody can add requests to someone else's portal).
  select string_agg(i.qty || ' × ' || i.title || case when i.options <> '' then ' (' || i.options || ')' else '' end, E'\n' order by i.title)
    into installs from public.order_items i where i.order_id = o_id and i.install;
  if installs is not null then
    if is_client then
      cl := me;
    else
      select id into cl from public.profiles
       where role = 'client' and auth_id is null and lower(email) = lower(p_email) order by created_at limit 1;
      if cl is null then
        insert into public.profiles (name, email, role, phone, status, permissions)
          values (p_name, case when exists (select 1 from public.profiles where lower(email) = lower(p_email)) then null else p_email end,
                  'client', p_phone, 'invited', '{canSubmitRequests}')
          returning id into cl;
      end if;
    end if;
    select id into prop from public.properties where client_id = cl and lower(btrim(address)) = lower(p_address) limit 1;
    if prop is null then
      insert into public.properties (client_id, address, notes) values (cl, p_address, 'From store order #' || o_number) returning id into prop;
    end if;
    insert into public.projects (client_id, property_id, title, description, scope_of_works, status, order_id)
      values (cl, prop, 'Install: store order #' || o_number,
              'Installation requested with store order #' || o_number || ' (supplied with the order).' || E'\n\n'
                || 'Contact: ' || p_name || ', ' || p_phone || ', ' || p_email
                || case when p_notes <> '' then E'\n\nCustomer notes: ' || p_notes else '' end,
              'Install:' || E'\n' || installs, 'quote_requested', o_id)
      returning id, number into q_id, q_number;
  end if;

  insert into public.inbox (user_id, title, body)
    select id, 'New store order #' || o_number,
           p_name || case when is_trade then ' (trade)' when is_client then ' (client)' else '' end || ' — ' || o_count || ' item(s), $'
             || to_char(o_total, 'FM999,999,990.00') || ', '
             || case p_delivery when 'pickup' then 'pickup' when 'delivery' then 'Melbourne standard delivery'
                                when 'same_day' then 'Melbourne same-day delivery' else 'Australia-wide delivery' end
             || case when q_id is not null then '. Installation requested: quote #' || q_number || ' is waiting to be priced in Quotes.' else '' end
    from public.profiles where role = 'admin' and status = 'active';

  return jsonb_build_object('id', o_id, 'number', o_number, 'total', o_total, 'install_quote', q_number);
end;
$$;

