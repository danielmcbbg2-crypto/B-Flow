-- Fixes from the review of the store and of accounts without a login.

-- A login deleted in Supabase (Authentication → Users) withdraws the invite as well, so someone
-- signing up with that email can't take the account over; the app's next invite allows a login
-- again. Otherwise as before: through the API login_invited stays as it was, and the email can't
-- change once there's a login.
create or replace function public.guard_profile_login() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if public.is_api_user() then new.login_invited := false; end if;
    return new;
  end if;
  if public.is_api_user() then
    new.login_invited := old.login_invited;
    if old.auth_id is not null and new.email is distinct from old.email then
      raise exception 'The email can’t change once the account has a login.' using errcode = 'check_violation';
    end if;
  end if;
  if old.auth_id is null and new.email is distinct from old.email then
    new.login_invited := false;
  end if;
  if old.auth_id is not null and new.auth_id is null then
    new.login_invited := false;
  end if;
  return new;
end;
$$;

-- Where visitors' orders came from, to limit each one rather than everyone at once. Kept for a
-- day, and only place_order reads or writes it (no access through the API).
create table public.order_attempts (
  ip         text not null,
  created_at timestamptz not null default now()
);
create index on public.order_attempts (ip, created_at);
alter table public.order_attempts enable row level security;
revoke all on public.order_attempts from anon, authenticated;

-- As before, with fairer limits: a visitor (by connection and by email) can place 5 orders an
-- hour and a signed-in customer 10, so one person flooding the form can't block anyone else; a
-- much higher cap on all visitors' orders stays as a backstop. A cart over 30 different products
-- says so instead of "Your cart is empty".
create or replace function public.place_order(
  p_items jsonb, p_name text, p_email text, p_phone text, p_delivery text, p_address text default '', p_notes text default ''
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me        text := public.current_profile_id();
  is_trade  boolean := exists (select 1 from public.profiles where id = me and role = 'provider' and status = 'active');
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
           case when is_trade and t.price is not null then t.price else p.price end, c.qty
    from jsonb_to_recordset(cart) as c (product_id text, qty integer)
    join public.products p on p.id = c.product_id
    left join public.product_trade_prices t on t.id = p.id;
  select sum(unit_price * qty), sum(qty) into o_total, o_count from public.order_items where order_id = o_id;
  update public.orders set total = o_total where id = o_id;

  if me is null and caller_ip is not null then
    delete from public.order_attempts where created_at < now() - interval '1 day';
    insert into public.order_attempts (ip) values (caller_ip);
  end if;

  insert into public.inbox (user_id, title, body)
    select id, 'New store order #' || o_number,
           p_name || case when is_trade then ' (trade)' else '' end || ' — ' || o_count || ' item(s), $'
             || to_char(o_total, 'FM999,999,990.00') || ', ' || p_delivery
    from public.profiles where role = 'admin' and status = 'active';

  return jsonb_build_object('id', o_id, 'number', o_number, 'total', o_total);
end;
$$;
