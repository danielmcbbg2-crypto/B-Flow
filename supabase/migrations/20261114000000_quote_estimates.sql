-- Quotes as QuickBooks estimates, so the books match the portal. When a quote is issued (or
-- issued again), the quickbooks function creates (or updates) its estimate in QuickBooks with the
-- same lines, GST, expiry, inclusions and exclusions; when it's accepted or declined, the estimate
-- is marked Accepted (with who and when) or Rejected. QuickBooks doesn't email it: the client
-- already has the quote's link.

alter table public.projects
  add column qbo_estimate_id text,
  add column estimate_number text not null default '',
  add column estimate_status text not null default 'none'
    check (estimate_status in ('none', 'pending', 'working', 'synced', 'failed', 'skipped')),
  add column estimate_error text not null default '',
  add column estimate_attempts int not null default 0,
  add column estimate_next_try timestamptz not null default now();
create index projects_estimate_due on public.projects (estimate_next_try) where estimate_status in ('pending', 'failed', 'working');

alter table public.qbo_connection add column if not exists estimate_item_id text;

-- Only the server records the estimate.
create function public.guard_quote_estimate() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.is_api_user() then
    if tg_op = 'INSERT' then
      new.qbo_estimate_id := null; new.estimate_number := ''; new.estimate_status := 'none';
      new.estimate_error := ''; new.estimate_attempts := 0; new.estimate_next_try := now();
    else
      new.qbo_estimate_id := old.qbo_estimate_id; new.estimate_number := old.estimate_number; new.estimate_status := old.estimate_status;
      new.estimate_error := old.estimate_error; new.estimate_attempts := old.estimate_attempts; new.estimate_next_try := old.estimate_next_try;
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_quote_estimate before insert or update on public.projects
  for each row execute function public.guard_quote_estimate();
revoke execute on function public.guard_quote_estimate() from public, anon, authenticated;

-- Issuing, re-issuing, accepting or declining queues the estimate's update (after the guards).
create function public.queue_quote_estimate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.status = 'quoted' and (tg_op = 'INSERT' or old.status is distinct from 'quoted'))
     or (tg_op = 'UPDATE' and old.status = 'quoted' and new.status in ('approved', 'rejected') and new.estimate_status <> 'none') then
    new.estimate_status := 'pending';
    new.estimate_attempts := 0;
    new.estimate_next_try := now();
  end if;
  return new;
end;
$$;
create trigger queue_quote_estimate before insert or update on public.projects
  for each row execute function public.queue_quote_estimate();
revoke execute on function public.queue_quote_estimate() from public, anon, authenticated;

create function public.kick_quickbooks_on_estimate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.estimate_status = 'pending' and (tg_op = 'INSERT' or old.estimate_status is distinct from 'pending' or old.status is distinct from new.status) then
    perform public.kick_quickbooks();
  end if;
  return null;
end;
$$;
create trigger kick_quickbooks_on_estimate after insert or update of estimate_status, status on public.projects
  for each row execute function public.kick_quickbooks_on_estimate();
revoke execute on function public.kick_quickbooks_on_estimate() from public, anon, authenticated;

/** The office asks for a failed (or skipped) estimate to be sent to QuickBooks again. */
create function public.retry_quote_estimate(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_perm('canManageProjects') then raise exception 'You need the “Manage projects & quotes” permission'; end if;
  update public.projects set estimate_status = 'pending', estimate_attempts = 0, estimate_next_try = now(), estimate_error = ''
   where id = p_id and estimate_status in ('failed', 'skipped') and status in ('quoted', 'approved', 'in_progress', 'completed', 'rejected');
end;
$$;
revoke execute on function public.retry_quote_estimate(text) from public, anon;
grant execute on function public.retry_quote_estimate(text) to authenticated;

/** The server claims estimates to create or update. */
create function public.claim_quote_estimates(max_rows int default 5)
returns table (id text, number int, title text, status text, client_id text, qbo_estimate_id text, estimate_attempts int,
               quote_amount numeric, quote_valid_until date, quote_inclusions text, quote_exclusions text,
               quote_answered_name text, quote_decided_at timestamptz, quote_issued_at timestamptz)
language sql security definer set search_path = '' as $$
  with due as (
    select p.id from public.projects p
     where p.estimate_next_try <= now()
       and (p.estimate_status = 'pending' or (p.estimate_status = 'failed' and p.estimate_attempts < 6) or p.estimate_status = 'working')
     order by p.estimate_next_try
     limit max_rows
     for update skip locked
  )
  update public.projects p
     set estimate_status = 'working', estimate_next_try = now() + interval '10 minutes'
    from due
   where p.id = due.id
  returning p.id, p.number, p.title, p.status, p.client_id, p.qbo_estimate_id, p.estimate_attempts,
            p.quote_amount, p.quote_valid_until, p.quote_inclusions, p.quote_exclusions,
            p.quote_answered_name, p.quote_decided_at, p.quote_issued_at;
$$;
revoke all on function public.claim_quote_estimates(int) from public, anon, authenticated;
grant execute on function public.claim_quote_estimates(int) to service_role;
