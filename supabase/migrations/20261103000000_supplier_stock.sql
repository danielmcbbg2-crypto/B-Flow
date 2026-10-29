-- Supplier stock tracking: every 6 hours the supplier-stock server function reads each product's
-- supplier page and records what it says (in stock, low, out of stock, how many, the price). When a
-- tracked product runs out at the supplier, its store listing switches to "Out of stock" (or "To
-- order", per product) and store managers get an inbox message; when it's back, the listing
-- switches back (only if the tracker was what changed it) and they're told again.
--
-- Only the server records stock readings: the app can turn tracking on or off and choose what an
-- out-of-stock reading does, but can't write the readings themselves.

alter table public.product_sources
  add column if not exists track_stock      boolean not null default true,
  add column if not exists out_of_stock_as  text not null default 'out_of_stock' check (out_of_stock_as in ('out_of_stock', 'to_order')),
  add column if not exists stock_status     text not null default 'unknown' check (stock_status in ('in_stock', 'low', 'out_of_stock', 'unknown')),
  add column if not exists stock_qty        integer check (stock_qty >= 0),
  add column if not exists supplier_price   numeric(12, 2) check (supplier_price >= 0),
  add column if not exists stock_note       text not null default '',
  add column if not exists stock_checked_at timestamptz,
  add column if not exists stock_changed_at timestamptz,
  -- The listing's stock was switched by the tracker (so it may switch it back).
  add column if not exists stock_auto       boolean not null default false,
  -- Fingerprint of the page's text last time, so an unchanged page isn't read again by the AI.
  add column if not exists page_hash        text not null default '';

create function public.guard_source_stock() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.is_api_user() then
    if tg_op = 'INSERT' then
      new.stock_status := 'unknown'; new.stock_qty := null; new.supplier_price := null; new.stock_note := '';
      new.stock_checked_at := null; new.stock_changed_at := null; new.stock_auto := false; new.page_hash := '';
    else
      new.stock_status := old.stock_status; new.stock_qty := old.stock_qty; new.supplier_price := old.supplier_price;
      new.stock_note := old.stock_note; new.stock_checked_at := old.stock_checked_at; new.stock_changed_at := old.stock_changed_at;
      new.stock_auto := old.stock_auto; new.page_hash := old.page_hash;
      -- A new supplier link starts afresh.
      if new.source_url is distinct from old.source_url then
        new.stock_status := 'unknown'; new.stock_qty := null; new.supplier_price := null; new.stock_note := '';
        new.stock_checked_at := null; new.page_hash := '';
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_source_stock before insert or update on public.product_sources
  for each row execute function public.guard_source_stock();
revoke execute on function public.guard_source_stock() from public, anon, authenticated;

-- Each scheduled check, for the record (and so it runs at most every few hours).
create table public.stock_check_runs (
  id         uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  trigger    text not null default 'scheduled' check (trigger in ('scheduled', 'manual')),
  checked    integer not null default 0,
  changed    integer not null default 0,
  failed     integer not null default 0
);
alter table public.stock_check_runs enable row level security;
create policy stock_runs_select on public.stock_check_runs for select to authenticated using (has_perm('canManageStore'));

-- Records a reading from the supplier's page, and acts on a change. Server only.
create function public.apply_supplier_stock(
  p_product text, p_status text, p_qty integer, p_price numeric, p_note text, p_hash text default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  s public.product_sources;
  p public.products;
  before text;
  was_out boolean;
  now_out boolean;
  title text;
  body text;
begin
  if p_status not in ('in_stock', 'low', 'out_of_stock', 'unknown') then raise exception 'Bad stock status %', p_status; end if;
  select * into s from public.product_sources where id = p_product for update;
  if not found then return 'no source'; end if;
  select * into p from public.products where id = p_product for update;
  before := s.stock_status;

  -- Can't tell this time: keep the last reading, note why.
  if p_status = 'unknown' then
    update public.product_sources
       set stock_note = left(coalesce(p_note, ''), 300), stock_checked_at = now(), page_hash = coalesce(p_hash, page_hash)
     where id = p_product;
    return 'unknown';
  end if;

  update public.product_sources
     set stock_status = p_status, stock_qty = p_qty, supplier_price = coalesce(p_price, supplier_price),
         stock_note = left(coalesce(p_note, ''), 300), stock_checked_at = now(), page_hash = coalesce(p_hash, page_hash),
         stock_changed_at = case when before is distinct from p_status then now() else stock_changed_at end
   where id = p_product;
  if before = p_status or not s.track_stock or p.status = 'archived' then return 'same'; end if;

  was_out := before = 'out_of_stock';
  now_out := p_status = 'out_of_stock';
  if now_out and p.stock = 'in_stock' then
    update public.products set stock = s.out_of_stock_as where id = p_product;
    update public.product_sources set stock_auto = true where id = p_product;
    title := 'Out of stock at ' || coalesce(nullif(s.supplier, ''), 'the supplier') || ': ' || p.title;
    body := 'The store listing now shows "' || case s.out_of_stock_as when 'to_order' then 'To order' else 'Out of stock' end
            || '". It switches back when the supplier has it again.';
  elsif now_out then
    title := 'Out of stock at ' || coalesce(nullif(s.supplier, ''), 'the supplier') || ': ' || p.title;
    body := 'The store listing was already "' || replace(p.stock, '_', ' ') || '", so it''s unchanged.';
  elsif was_out then
    if s.stock_auto and p.stock <> 'in_stock' then
      update public.products set stock = 'in_stock' where id = p_product;
      body := 'The store listing shows "In stock" again.';
    else
      body := 'The store listing is "' || replace(p.stock, '_', ' ') || '"; change it if you''d like to sell it again.';
    end if;
    update public.product_sources set stock_auto = false where id = p_product;
    title := 'Back in stock at ' || coalesce(nullif(s.supplier, ''), 'the supplier') || ': ' || p.title;
  elsif p_status = 'low' then
    title := 'Running low at ' || coalesce(nullif(s.supplier, ''), 'the supplier') || ': ' || p.title;
    body := coalesce('Only ' || p_qty || ' left. ', '') || 'Order soon if you need it.';
  else
    return 'changed';
  end if;
  insert into public.inbox (user_id, title, body)
  select id, left(title, 200), left(body || coalesce(' ' || nullif(p_note, ''), ''), 2000)
    from public.profiles
   where role = 'admin' and status = 'active' and 'canManageStore' = any (permissions);
  return 'changed';
end;
$$;
revoke execute on function public.apply_supplier_stock(text, text, integer, numeric, text, text) from public, anon, authenticated;
grant execute on function public.apply_supplier_stock(text, text, integer, numeric, text, text) to service_role;

-- Check every 6 hours (where pg_cron and pg_net are installed).
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and to_regnamespace('net') is not null then
    perform cron.schedule('supplier-stock', '17 */6 * * *', $$
  select net.http_post(
    url := 'https://djgacgzmpmbrftkdlqrb.supabase.co/functions/v1/supplier-stock',
    body := '{"scheduled":true}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb);
$$);
  end if;
end;
$do$;
