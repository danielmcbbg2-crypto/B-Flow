-- Linking a portal client to their QuickBooks customer. The office picks the customer (searched in
-- QuickBooks by the quickbooks function, which checks it exists and records it); from then on that
-- client's estimates, deposit invoices and store invoices go to that customer instead of one found
-- by email, and the customer's QuickBooks invoices (open and paid, with their pay links, including
-- ones made directly in QuickBooks) are copied into invoices, so the client and the office see them.
--
-- Only the server sets the link (an app user can't point their account at someone else's
-- customer and see their invoices), and it's tied to the QuickBooks company it was made in.

alter table public.profiles
  add column qbo_customer_id   text,
  add column qbo_customer_name text not null default '',
  add column qbo_customer_realm text,
  add column qbo_synced_at     timestamptz;
comment on column public.profiles.qbo_customer_id is 'The QuickBooks customer this client is linked to (set by the quickbooks function only).';

create or replace function public.guard_profile_qbo() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.is_api_user() then
    if tg_op = 'INSERT' then
      new.qbo_customer_id := null; new.qbo_customer_name := ''; new.qbo_customer_realm := null; new.qbo_synced_at := null;
    else
      new.qbo_customer_id := old.qbo_customer_id; new.qbo_customer_name := old.qbo_customer_name;
      new.qbo_customer_realm := old.qbo_customer_realm; new.qbo_synced_at := old.qbo_synced_at;
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_profile_qbo before insert or update on public.profiles
  for each row execute function public.guard_profile_qbo();
revoke execute on function public.guard_profile_qbo() from public, anon, authenticated;

-- Where an invoice came from: made in the portal (or for a quote's deposit), or copied from
-- QuickBooks for a linked client. Copies are kept up to date by the server; the app can't make them.
alter table public.invoices add column source text not null default 'portal' check (source in ('portal', 'quickbooks'));
create unique index invoices_qbo_invoice_id_key on public.invoices (qbo_invoice_id) where qbo_invoice_id is not null;

create or replace function public.guard_invoice_source() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.is_api_user() then
    if tg_op = 'INSERT' then
      new.source := 'portal';
    else
      new.source := old.source;
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_invoice_source before insert or update on public.invoices
  for each row execute function public.guard_invoice_source();
revoke execute on function public.guard_invoice_source() from public, anon, authenticated;
