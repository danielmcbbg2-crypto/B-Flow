-- Deleting a quote from Admin → Quotes, along with what it made in QuickBooks: its estimate is
-- deleted there, and an unpaid deposit invoice is voided (a tax invoice that was sent stays on
-- record as void rather than disappearing). The quote itself goes at once; the QuickBooks side is
-- queued in qbo_cleanup and done by the quickbooks function, which keeps retrying if QuickBooks is
-- down. Each entry is tied to the QuickBooks company it belongs to, so nothing is ever deleted or
-- voided in another company.
--
-- Only quotes: not a job that's under way or finished, and never one with money paid against it.

create table public.qbo_cleanup (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('estimate', 'invoice')),
  qbo_id      text not null,
  realm_id    text not null,
  label       text not null default '',
  status      text not null default 'pending' check (status in ('pending', 'working', 'done', 'kept', 'failed')),
  error       text not null default '',
  attempts    integer not null default 0,
  next_try    timestamptz not null default now(),
  created_by  text,
  created_at  timestamptz not null default now()
);
comment on table public.qbo_cleanup is 'QuickBooks estimates to delete and invoices to void for deleted quotes. Server only.';
create index qbo_cleanup_due on public.qbo_cleanup (next_try) where status in ('pending', 'working', 'failed');
alter table public.qbo_cleanup enable row level security;
revoke all on public.qbo_cleanup from anon, authenticated;

create function public.delete_quote(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.projects;
  realm text := (select coalesce(realm_id, pinned_realm_id) from public.qbo_connection where id = 1);
  label text;
  docs text[];
  estimates int := 0;
  invoices int := 0;
begin
  if not public.has_perm('canManageProjects') then raise exception 'You need the “Manage projects & quotes” permission'; end if;
  select * into p from public.projects where id = p_id for update;
  if not found then raise exception 'That quote wasn''t found'; end if;
  if p.status in ('in_progress', 'completed') then
    raise exception 'P-% is a job that''s under way or finished, not a quote, so it can''t be deleted here.', p.number;
  end if;
  if p.deposit_status = 'paid'
     or exists (select 1 from public.invoices i where i.project_id = p.id and i.status = 'paid')
     or exists (select 1 from public.project_payments s join public.invoices i on i.id = s.invoice_id where s.project_id = p.id and i.status = 'paid') then
    raise exception 'Money has been paid against P-%, so it can''t be deleted. Refund or credit it in QuickBooks first.', p.number;
  end if;
  if p.estimate_status = 'working' or p.deposit_status = 'working' then
    raise exception 'P-% is being sent to QuickBooks right now. Try again in a minute.', p.number;
  end if;

  label := 'Quote P-' || p.number || ': ' || p.title;
  if (p.qbo_estimate_id is not null or exists (select 1 from public.invoices i where i.project_id = p.id and i.qbo_invoice_id is not null)) and realm is null then
    raise exception 'P-% is in QuickBooks, but QuickBooks isn''t connected, so it couldn''t be removed there. Connect QuickBooks, then delete it.', p.number;
  end if;
  if p.qbo_estimate_id is not null then
    insert into public.qbo_cleanup (kind, qbo_id, realm_id, label, created_by) values ('estimate', p.qbo_estimate_id, realm, label, public.current_profile_id());
    estimates := 1;
  end if;
  insert into public.qbo_cleanup (kind, qbo_id, realm_id, label, created_by)
    select 'invoice', i.qbo_invoice_id, realm, label || ' (invoice ' || i.qb_invoice_number || ')', public.current_profile_id()
      from public.invoices i where i.project_id = p.id and i.qbo_invoice_id is not null;
  get diagnostics invoices = row_count;

  -- Its documents' files, for the app to remove from storage.
  select coalesce(array_agg(d.path), '{}') into docs from public.project_documents d where d.project_id = p.id;
  update public.project_payments set invoice_id = null where project_id = p.id;
  delete from public.invoices where project_id = p.id;
  delete from public.projects where id = p.id;
  if estimates + invoices > 0 then perform public.kick_quickbooks(); end if;
  return jsonb_build_object('number', p.number, 'estimates', estimates, 'invoices', invoices, 'documents', to_jsonb(docs));
end;
$$;
revoke execute on function public.delete_quote(text) from public, anon;
grant execute on function public.delete_quote(text) to authenticated;

/** The server claims QuickBooks clean-ups to do. */
create function public.claim_qbo_cleanup(max_rows int default 10)
returns setof public.qbo_cleanup
language sql security definer set search_path = '' as $$
  with due as (
    select c.id from public.qbo_cleanup c
     where c.next_try <= now() and (c.status in ('pending', 'working') or (c.status = 'failed' and c.attempts < 6))
     order by c.next_try
     limit max_rows
     for update skip locked
  )
  update public.qbo_cleanup c set status = 'working', next_try = now() + interval '10 minutes'
    from due where c.id = due.id
  returning c.*;
$$;
revoke execute on function public.claim_qbo_cleanup(int) from public, anon, authenticated;
