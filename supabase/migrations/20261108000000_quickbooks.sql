-- QuickBooks invoices for store orders. When an order is placed, the quickbooks function finds or
-- creates the customer in QuickBooks Online, creates the invoice (GST inclusive) and has QuickBooks
-- email it with its pay link, straight away (the office confirms the order later). Cancelling an
-- unpaid order voids its invoice; a paid one is flagged for a refund. Paid invoices mark their
-- orders paid.
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
  run_lock_until    timestamptz
);
alter table public.qbo_connection enable row level security;
revoke all on public.qbo_connection from public, anon, authenticated;
create index on public.qbo_connection (connected_by);
create index on public.qbo_connection (oauth_by);

-- Each order's invoice.
alter table public.orders
  add column if not exists invoice_status text not null default 'pending'
    check (invoice_status in ('pending', 'working', 'sent', 'failed', 'paid', 'voided', 'refund_needed', 'skipped')),
  add column if not exists qbo_invoice_id text,
  add column if not exists invoice_number text not null default '',
  add column if not exists pay_link text not null default '',
  add column if not exists invoice_error text not null default '',
  add column if not exists invoice_attempts int not null default 0,
  add column if not exists invoice_next_try timestamptz not null default now(),
  add column if not exists invoiced_at timestamptz;

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
    else
      new.invoice_status := old.invoice_status; new.qbo_invoice_id := old.qbo_invoice_id; new.invoice_number := old.invoice_number;
      new.pay_link := old.pay_link; new.invoice_error := old.invoice_error; new.invoice_attempts := old.invoice_attempts;
      new.invoice_next_try := old.invoice_next_try; new.invoiced_at := old.invoiced_at;
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
                                        'connected_at', connected_at, 'last_error', last_error)
                from public.qbo_connection where id = 1), '{"connected": false}'::jsonb)
  end
$$;
revoke execute on function public.qbo_status() from public, anon;
grant execute on function public.qbo_status() to authenticated;

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

-- The office asks for a failed invoice to be tried again.
create function public.retry_order_invoice(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_perm('canManageStore') then raise exception 'You need the “Manage store & orders” permission'; end if;
  update public.orders set invoice_status = 'pending', invoice_attempts = 0, invoice_next_try = now(), invoice_error = ''
   where id = p_id and invoice_status in ('failed', 'skipped');
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
-- claim left behind by a run that stopped), so two runs never invoice the same order.
create function public.claim_order_invoices(max_rows int default 5)
returns setof public.orders
language sql security definer set search_path = '' as $$
  update public.orders o
     set invoice_status = 'working', invoice_next_try = now() + interval '10 minutes'
   where o.id in (
     select id from public.orders
      where invoice_next_try <= now() and status <> 'cancelled'
        and (invoice_status = 'pending' or (invoice_status = 'failed' and invoice_attempts < 6) or invoice_status = 'working')
      order by created_at
      limit max_rows
      for update skip locked)
  returning o.*;
$$;
revoke all on function public.claim_order_invoices(int) from public, anon, authenticated;
grant execute on function public.claim_order_invoices(int) to service_role;
