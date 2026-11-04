-- QuickBooks invoices for store orders. When an order is placed, the quickbooks function finds or
-- creates the customer in QuickBooks Online, creates the invoice (GST inclusive) and has QuickBooks
-- email it with its pay link, straight away (the office confirms the order later). Cancelling an
-- unpaid order voids its invoice; a paid one is flagged for a refund. Paid invoices mark their
-- orders paid.
--
-- Limits on automatic invoices (set by the office): an order over the most an automatic invoice may
-- be, or past the day's number of automatic invoices, waits as "held" until the office approves it.
--
-- The connection to QuickBooks (its tokens) is kept in qbo_connection, which only the server can
-- read: no policies, no grants. The app sees only whether it's connected (qbo_status()).

create table public.qbo_connection (
  id                int primary key default 1 check (id = 1),
  realm_id          text,
  company_name      text not null default '',
  refresh_token     text,
  access_token      text,
  access_expires_at timestamptz,
  connected_at      timestamptz,
  connected_by      text references public.profiles (id) on delete set null,
  -- The QuickBooks item store sales are recorded against, and the GST tax code (found or made once).
  item_id           text,
  tax_code_id       text,
  last_paid_check   timestamptz,
  last_error        text not null default '',
  -- The sign-in started from the app (single use, short-lived), and who started it.
  oauth_state       text,
  oauth_state_at    timestamptz,
  oauth_by          text references public.profiles (id) on delete set null,
  -- One sync at a time (QuickBooks hands out a new refresh token when it's used).
  run_lock_until    timestamptz,
  -- The one QuickBooks company the store may connect to (the first connected; QBO_REALM_ID overrides).
  -- Disconnecting keeps it, so a stolen admin login can't swap in another company.
  pinned_realm_id   text,
  -- Limits on automatic invoices: how many in 24 hours, and the most one may be (inc. GST).
  auto_daily_limit  int not null default 20 check (auto_daily_limit between 0 and 1000),
  auto_max_total    numeric(12,2) not null default 5000 check (auto_max_total >= 0)
);
alter table public.qbo_connection enable row level security;
revoke all on public.qbo_connection from public, anon, authenticated;
create index on public.qbo_connection (connected_by);
create index on public.qbo_connection (oauth_by);

-- Each order's invoice.
alter table public.orders
  add column if not exists invoice_status text not null default 'pending'
    check (invoice_status in ('pending', 'working', 'sent', 'failed', 'paid', 'voided', 'refund_needed', 'skipped', 'held')),
  add column if not exists qbo_invoice_id text,
  add column if not exists invoice_number text not null default '',
  add column if not exists pay_link text not null default '',
  add column if not exists invoice_error text not null default '',
  add column if not exists invoice_attempts int not null default 0,
  add column if not exists invoice_next_try timestamptz not null default now(),
  add column if not exists invoiced_at timestamptz,
  -- The office approved invoicing it (past the limits), and when it was taken up automatically.
  add column if not exists invoice_approved boolean not null default false,
  add column if not exists invoice_auto_at timestamptz;
create index if not exists orders_invoice_auto_at on public.orders (invoice_auto_at) where invoice_auto_at is not null;

-- An order's lines in the order they were added, so the invoice lists them as the order does.
alter table public.order_items add column if not exists seq bigint generated always as identity;

-- Orders placed before QuickBooks was connected aren't invoiced by it.
update public.orders set invoice_status = 'skipped' where invoice_status = 'pending';

-- Only the server records invoices: the app can't change these fields.
create function public.guard_order_invoice() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.is_api_user() then
    if tg_op = 'INSERT' then
      new.invoice_status := 'pending'; new.qbo_invoice_id := null; new.invoice_number := ''; new.pay_link := '';
      new.invoice_error := ''; new.invoice_attempts := 0; new.invoice_next_try := now(); new.invoiced_at := null;
      new.invoice_approved := false; new.invoice_auto_at := null;
    else
      new.invoice_status := old.invoice_status; new.qbo_invoice_id := old.qbo_invoice_id; new.invoice_number := old.invoice_number;
      new.pay_link := old.pay_link; new.invoice_error := old.invoice_error; new.invoice_attempts := old.invoice_attempts;
      new.invoice_next_try := old.invoice_next_try; new.invoiced_at := old.invoiced_at;
      new.invoice_approved := old.invoice_approved; new.invoice_auto_at := old.invoice_auto_at;
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_order_invoice before insert or update on public.orders
  for each row execute function public.guard_order_invoice();
revoke execute on function public.guard_order_invoice() from public, anon, authenticated;

-- Whether QuickBooks is connected, for the office (no tokens).
create function public.qbo_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.has_perm('canManageStore') or public.has_perm('canManageInvoices') then
    coalesce((select jsonb_build_object('connected', realm_id is not null and refresh_token is not null, 'company', company_name,
                                        'connected_at', connected_at, 'last_error', last_error,
                                        'daily_limit', auto_daily_limit, 'max_total', auto_max_total)
                from public.qbo_connection where id = 1), '{"connected": false, "daily_limit": 20, "max_total": 5000}'::jsonb)
  end
$$;
revoke execute on function public.qbo_status() from public, anon;
grant execute on function public.qbo_status() to authenticated;

-- The office sets the limits on automatic invoices.
create function public.qbo_set_limits(p_daily int, p_max numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.has_perm('canManageStore') or public.has_perm('canManageInvoices')) then
    raise exception 'You need the “Manage store & orders” or “Manage invoices” permission';
  end if;
  if p_daily is null or p_daily < 0 or p_daily > 1000 then raise exception 'The daily number must be between 0 and 1000'; end if;
  if p_max is null or p_max < 0 then raise exception 'The largest amount can’t be negative'; end if;
  insert into public.qbo_connection (id, auto_daily_limit, auto_max_total) values (1, p_daily, round(p_max, 2))
  on conflict (id) do update set auto_daily_limit = excluded.auto_daily_limit, auto_max_total = excluded.auto_max_total;
end;
$$;
revoke execute on function public.qbo_set_limits(int, numeric) from public, anon;
grant execute on function public.qbo_set_limits(int, numeric) to authenticated;

-- A customer's own order's invoice, for the confirmation screen (visitors have no account to read
-- their order with): the order id and the email it was placed with, within a day of ordering.
create function public.order_invoice(p_id text, p_email text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status', o.invoice_status, 'number', o.invoice_number, 'pay_link', o.pay_link)
    from public.orders o
   where o.id = p_id and lower(o.email) = lower(btrim(coalesce(p_email, ''))) and o.created_at > now() - interval '1 day'
$$;
revoke execute on function public.order_invoice(text, text) from public;
grant execute on function public.order_invoice(text, text) to anon, authenticated;

-- The office asks for a failed invoice to be tried again, or approves one that was held (or not
-- invoiced): approved, it's invoiced whatever the limits.
create function public.retry_order_invoice(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_perm('canManageStore') then raise exception 'You need the “Manage store & orders” permission'; end if;
  update public.orders set invoice_status = 'pending', invoice_attempts = 0, invoice_next_try = now(), invoice_error = '',
                           invoice_approved = true
   where id = p_id and invoice_status in ('failed', 'skipped', 'held') and status <> 'cancelled';
  perform public.kick_quickbooks();
end;
$$;

-- Wake the quickbooks function (where pg_net is installed). It takes no input: it only does what's
-- waiting (invoices to make, invoices to void, a paid check now and then).
create function public.kick_quickbooks() returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if to_regnamespace('net') is null then return; end if;
  perform net.http_post(
    url := 'https://djgacgzmpmbrftkdlqrb.supabase.co/functions/v1/quickbooks',
    body := '{"run":true}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb);
end;
$$;
revoke execute on function public.kick_quickbooks() from public, anon, authenticated;
revoke execute on function public.retry_order_invoice(text) from public, anon;
grant execute on function public.retry_order_invoice(text) to authenticated;

create function public.kick_quickbooks_on_order() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or (new.status = 'cancelled' and old.status is distinct from 'cancelled') then
    perform public.kick_quickbooks();
  end if;
  return null;
end;
$$;
create trigger kick_quickbooks after insert or update of status on public.orders
  for each row execute function public.kick_quickbooks_on_order();
revoke execute on function public.kick_quickbooks_on_order() from public, anon, authenticated;

-- Retries, voids and the paid check, every 15 minutes, while QuickBooks is connected.
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and to_regnamespace('net') is not null then
    perform cron.schedule('quickbooks-sync', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://djgacgzmpmbrftkdlqrb.supabase.co/functions/v1/quickbooks',
    body := '{"run":true}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb)
  where exists (select 1 from public.qbo_connection where refresh_token is not null);
$$);
  end if;
end;
$do$;

-- The server claims orders whose invoice is due (new, or a failed try whose wait is over, or a
-- claim left behind by a run that stopped), so two runs never invoice the same order. A new order
-- the office hasn't approved is held instead when it's over the largest automatic invoice, or when
-- the last 24 hours' automatic invoices have reached the daily number; the office is told.
create function public.claim_order_invoices(max_rows int default 5)
returns setof public.orders
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  lim_daily int;
  lim_max numeric;
  used int;
  why text;
begin
  select coalesce(auto_daily_limit, 20), coalesce(auto_max_total, 5000) into lim_daily, lim_max from public.qbo_connection where id = 1;
  lim_daily := coalesce(lim_daily, 20);
  lim_max := coalesce(lim_max, 5000);
  -- One claim at a time, so the day's count can't be overtaken by two runs at once.
  perform pg_advisory_xact_lock(hashtext('claim_order_invoices'));
  select count(*) into used from public.orders where invoice_auto_at > now() - interval '24 hours';
  for o in
    select * from public.orders
     where invoice_next_try <= now() and status <> 'cancelled'
       and (invoice_status = 'pending' or (invoice_status = 'failed' and invoice_attempts < 6) or invoice_status = 'working')
     order by created_at
     limit max_rows
     for update skip locked
  loop
    if o.invoice_status = 'pending' and not o.invoice_approved and o.invoice_auto_at is null then
      why := case
        when o.total > lim_max then 'Over the $' || to_char(lim_max, 'FM999,999,990.00') || ' limit for automatic invoices'
        when used >= lim_daily then 'The day’s ' || lim_daily || ' automatic invoices have been sent'
      end;
      if why is not null then
        update public.orders set invoice_status = 'held', invoice_error = why || ': approve it to send the invoice.' where id = o.id;
        insert into public.inbox (user_id, title, body)
          select id, 'Order #' || o.number || ': approve its invoice',
                 why || '. Open the order (Admin → Store → Orders) and click Approve and invoice to send its QuickBooks invoice.'
            from public.profiles
           where role = 'admin' and status = 'active' and 'canManageStore' = any (permissions);
        continue;
      end if;
      used := used + 1;
      update public.orders set invoice_auto_at = now() where id = o.id;
      o.invoice_auto_at := now();
    end if;
    update public.orders set invoice_status = 'working', invoice_next_try = now() + interval '10 minutes' where id = o.id;
    o.invoice_status := 'working';
    return next o;
  end loop;
end;
$$;
revoke all on function public.claim_order_invoices(int) from public, anon, authenticated;
grant execute on function public.claim_order_invoices(int) to service_role;
