-- Clients accept quotes from a private link, and a deposit invoice goes out straight away.
--
-- Each issued quote gets a long random link (quote_token). Anyone with it can see that quote and
-- accept or decline it (quote_by_token, answer_quote_by_token): clients without a portal login
-- answer that way, signed-in clients can also answer in the portal.
--
-- Once a quote is accepted (either way), its deposit is worked out here and queued: the quickbooks
-- function creates the deposit invoice in QuickBooks, emails it with its pay link, records it in
-- invoices (linked to the first payment stage) and marks it paid when it's paid.
--
-- The deposit is the quote's first payment stage; without stages, 10% of the quote (5% from
-- $20,000). Victoria's Domestic Building Contracts Act caps a deposit at 10% of the contract price
-- under $20,000 and 5% from $20,000, so a first stage above that is held for the office to change,
-- not sent.

alter table public.projects
  add column quote_token text unique,
  add column quote_answered_name text not null default '',
  add column deposit_status text not null default 'none'
    check (deposit_status in ('none', 'pending', 'working', 'sent', 'failed', 'held', 'paid', 'skipped')),
  add column deposit_amount numeric(12, 2),
  add column deposit_invoice_id text references public.invoices (id) on delete set null,
  add column deposit_error text not null default '',
  add column deposit_attempts int not null default 0,
  add column deposit_next_try timestamptz not null default now();
create index on public.projects (deposit_invoice_id);
create index projects_deposit_due on public.projects (deposit_next_try) where deposit_status in ('pending', 'failed', 'working');

-- Invoices QuickBooks made: its id there, and the pay link it emailed.
alter table public.invoices
  add column qbo_invoice_id text,
  add column pay_link text not null default '';

-- Quotes already issued get their link now.
update public.projects set quote_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
 where status = 'quoted' and quote_token is null;

/** The quote's total inc. GST, as the app works it out (lines rounded, then GST). */
create function public.quote_total_inc_gst(p_id text) returns numeric
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.project_quote_items where project_id = p_id)
      then round(round((select sum(round(qty * rate, 2)) from public.project_quote_items where project_id = p_id), 2) * 1.1, 2)
    else coalesce((select quote_amount from public.projects where id = p_id), 0)
  end
$$;
revoke execute on function public.quote_total_inc_gst(text) from public, anon, authenticated;

/** The deposit for an accepted quote: its amount, and why it can't be sent (or null). */
create function public.quote_deposit(p_id text, out amount numeric, out problem text)
language plpgsql stable security definer set search_path = '' as $$
declare
  total numeric := public.quote_total_inc_gst(p_id);
  cap numeric;
  stage record;
begin
  cap := round(total * case when total >= 20000 then 0.05 else 0.10 end, 2);
  select basis, value into stage from public.project_payments where project_id = p_id order by position, id limit 1;
  if stage is null then
    amount := cap;
  else
    amount := case stage.basis when 'percent' then round(total * stage.value / 100, 2) when 'amount' then round(stage.value, 2) else total end;
    if amount > cap then
      problem := 'The first payment stage ($' || to_char(amount, 'FM999,999,990.00') || ') is more than the deposit allowed for a contract of $'
        || to_char(total, 'FM999,999,990.00') || ' (10% under $20,000, 5% from $20,000, under Victoria’s Domestic Building Contracts Act). Change the payment stages, then send the deposit invoice.';
    end if;
  end if;
end;
$$;
revoke execute on function public.quote_deposit(text) from public, anon, authenticated;

-- Only the server sets the link, the deposit and QuickBooks' details: the app can't.
create function public.guard_quote_link() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.is_api_user() then
    if tg_op = 'INSERT' then
      new.quote_token := null; new.quote_answered_name := ''; new.deposit_status := 'none'; new.deposit_amount := null;
      new.deposit_invoice_id := null; new.deposit_error := ''; new.deposit_attempts := 0; new.deposit_next_try := now();
    else
      new.quote_token := old.quote_token; new.quote_answered_name := old.quote_answered_name; new.deposit_status := old.deposit_status;
      new.deposit_amount := old.deposit_amount; new.deposit_invoice_id := old.deposit_invoice_id; new.deposit_error := old.deposit_error;
      new.deposit_attempts := old.deposit_attempts; new.deposit_next_try := old.deposit_next_try;
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_quote_link before insert or update on public.projects
  for each row execute function public.guard_quote_link();
revoke execute on function public.guard_quote_link() from public, anon, authenticated;

create function public.guard_invoice_qbo() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.is_api_user() then
    if tg_op = 'INSERT' then new.qbo_invoice_id := null; new.pay_link := '';
    else new.qbo_invoice_id := old.qbo_invoice_id; new.pay_link := old.pay_link; end if;
  end if;
  return new;
end;
$$;
create trigger guard_invoice_qbo before insert or update on public.invoices
  for each row execute function public.guard_invoice_qbo();
revoke execute on function public.guard_invoice_qbo() from public, anon, authenticated;

-- Runs after the guards (triggers fire in name order): issuing a quote gives it a link; accepting
-- it queues the deposit.
create function public.queue_quote_deposit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d record;
begin
  if new.status = 'quoted' and new.quote_token is null then
    new.quote_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  end if;
  if tg_op = 'UPDATE' and new.status = 'approved' and old.status in ('quote_requested', 'quoted') and new.deposit_status = 'none' then
    select * into d from public.quote_deposit(new.id);
    if d.amount > 0 then
      new.deposit_amount := d.amount;
      new.deposit_attempts := 0;
      new.deposit_next_try := now();
      if d.problem is null then
        new.deposit_status := 'pending';
        new.deposit_error := '';
      else
        new.deposit_status := 'held';
        new.deposit_error := d.problem;
        insert into public.inbox (user_id, title, body, project_id)
          select id, 'Quote P-' || new.number || ' accepted: deposit held', d.problem, new.id
            from public.profiles where role = 'admin' and status = 'active' and 'canManageProjects' = any (permissions);
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger queue_quote_deposit before insert or update on public.projects
  for each row execute function public.queue_quote_deposit();
revoke execute on function public.queue_quote_deposit() from public, anon, authenticated;

create function public.kick_quickbooks_on_deposit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.deposit_status = 'pending' and old.deposit_status is distinct from 'pending' then perform public.kick_quickbooks(); end if;
  return null;
end;
$$;
create trigger kick_quickbooks_on_deposit after update of deposit_status on public.projects
  for each row execute function public.kick_quickbooks_on_deposit();
revoke execute on function public.kick_quickbooks_on_deposit() from public, anon, authenticated;

/** A quote as the client sees it from their link (null if the link isn't valid). */
create function public.quote_by_token(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'number', p.number,
    'title', p.title,
    'client', c.name,
    'address', concat_ws(', ', nullif(pr.address, ''), nullif(pr.suburb, '')),
    'scope', p.scope_of_works,
    'status', p.status,
    'valid_until', p.quote_valid_until,
    'issued_at', p.quote_issued_at,
    'answered_at', p.quote_decided_at,
    'answered_name', p.quote_answered_name,
    'items', coalesce((select jsonb_agg(jsonb_build_object('section', i.section, 'description', i.description, 'qty', i.qty, 'unit', i.unit, 'rate', i.rate) order by i.position, i.id)
                         from public.project_quote_items i where i.project_id = p.id), '[]'::jsonb),
    'inclusions', p.quote_inclusions,
    'exclusions', p.quote_exclusions,
    'total', public.quote_total_inc_gst(p.id),
    'deposit', jsonb_build_object('status', p.deposit_status, 'amount', p.deposit_amount, 'number', inv.qb_invoice_number, 'pay_link', coalesce(inv.pay_link, ''))
  )
  from public.projects p
  join public.profiles c on c.id = p.client_id
  left join public.properties pr on pr.id = p.property_id
  left join public.invoices inv on inv.id = p.deposit_invoice_id
  where p.quote_token = p_token and length(p_token) >= 32 and p.status <> 'quote_requested'
$$;
revoke execute on function public.quote_by_token(text) from public;
grant execute on function public.quote_by_token(text) to anon, authenticated;

/** The client answers from their link: accept (with their name) or decline an issued quote. */
create function public.answer_quote_by_token(p_token text, p_accept boolean, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.projects;
  who text := btrim(coalesce(p_name, ''));
begin
  select * into p from public.projects where quote_token = p_token and length(p_token) >= 32 for update;
  if p.id is null then raise exception 'This quote link isn’t valid.'; end if;
  if p.status <> 'quoted' then raise exception 'This quote has already been answered.'; end if;
  if p.quote_valid_until is not null and p.quote_valid_until < (now() at time zone 'Australia/Melbourne')::date then
    raise exception 'This quote expired on %. Contact us for an updated quote.', to_char(p.quote_valid_until, 'DD/MM/YYYY');
  end if;
  if p_accept and length(who) < 2 then raise exception 'Type your name to accept the quote.'; end if;
  update public.projects
     set status = case when p_accept then 'approved' else 'rejected' end,
         quote_decision = case when p_accept then 'approved' else 'rejected' end,
         quote_decided_by = null,
         quote_decided_at = now(),
         quote_answered_name = left(who, 120)
   where id = p.id;
  insert into public.inbox (user_id, title, body, project_id)
    select id, 'Quote P-' || p.number || case when p_accept then ' accepted' else ' declined' end,
           coalesce(nullif(left(who, 120), ''), 'The client') || case when p_accept then ' accepted' else ' declined' end
             || ' “' || p.title || '” from the quote link.', p.id
      from public.profiles where role = 'admin' and status = 'active' and 'canManageProjects' = any (permissions);
  return public.quote_by_token(p_token);
end;
$$;
revoke execute on function public.answer_quote_by_token(text, boolean, text) from public;
grant execute on function public.answer_quote_by_token(text, boolean, text) to anon, authenticated;

/** The office sends (again) the deposit invoice of an accepted quote: after a failure, or once a held one's stages are fixed. */
create function public.send_quote_deposit(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare d record;
begin
  if not public.has_perm('canManageProjects') then raise exception 'You need the “Manage projects & quotes” permission'; end if;
  if not exists (select 1 from public.projects where id = p_id and status in ('approved', 'in_progress', 'completed')
                   and deposit_status in ('none', 'failed', 'held', 'skipped')) then
    raise exception 'This quote has no deposit to send.';
  end if;
  select * into d from public.quote_deposit(p_id);
  if d.problem is not null then raise exception '%', d.problem; end if;
  if not (d.amount > 0) then raise exception 'The deposit comes to $0.'; end if;
  update public.projects set deposit_status = 'pending', deposit_amount = d.amount, deposit_error = '', deposit_attempts = 0, deposit_next_try = now()
   where id = p_id;
end;
$$;
revoke execute on function public.send_quote_deposit(text) from public, anon;
grant execute on function public.send_quote_deposit(text) to authenticated;

/** The server claims deposit invoices to make (as claim_order_invoices does for orders). */
create function public.claim_deposit_invoices(max_rows int default 5)
returns table (id text, number int, title text, client_id text, property_id text, deposit_amount numeric, deposit_attempts int, first_stage text)
language sql security definer set search_path = '' as $$
  with due as (
    select p.id from public.projects p
     where p.deposit_next_try <= now()
       and (p.deposit_status = 'pending' or (p.deposit_status = 'failed' and p.deposit_attempts < 6) or p.deposit_status = 'working')
     order by p.deposit_next_try
     limit max_rows
     for update skip locked
  )
  update public.projects p
     set deposit_status = 'working', deposit_next_try = now() + interval '10 minutes'
    from due
   where p.id = due.id
  returning p.id, p.number, p.title, p.client_id, p.property_id, p.deposit_amount, p.deposit_attempts,
            (select s.id from public.project_payments s where s.project_id = p.id order by s.position, s.id limit 1);
$$;
revoke all on function public.claim_deposit_invoices(int) from public, anon, authenticated;
grant execute on function public.claim_deposit_invoices(int) to service_role;

alter table public.qbo_connection add column if not exists deposit_item_id text;
