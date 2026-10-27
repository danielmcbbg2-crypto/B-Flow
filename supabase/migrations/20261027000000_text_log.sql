-- Texts sent from the office's own phones: the portal opens Messages with the text ready, so it
-- can't know whether it was sent. This keeps a record of each one it handed over: who opened which
-- text to which number, and when (set by the database, so it can't be backdated or put in someone
-- else's name). Admins can add to it and read it; nobody can change or delete an entry.

create table public.text_log (
  id              text primary key default gen_random_uuid()::text,
  recipient_phone text not null check (length(recipient_phone) between 1 and 40),
  message         text not null check (length(message) <= 2000),
  trigger_event   text not null default '' check (length(trigger_event) <= 120),
  opened_by       text references public.profiles (id) on delete set null,
  opened_at       timestamptz not null default now()
);
create index on public.text_log (opened_at);

alter table public.text_log enable row level security;
create policy text_log_select on public.text_log for select to authenticated using (is_admin());
create policy text_log_insert on public.text_log for insert to authenticated with check (is_admin());

create function public.stamp_text_log() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.is_api_user() then
    new.opened_by := public.current_profile_id();
    new.opened_at := now();
  end if;
  return new;
end;
$$;
create trigger stamp_text_log before insert on public.text_log
  for each row execute function public.stamp_text_log();
revoke execute on function public.stamp_text_log() from public, anon, authenticated;

-- An admin who opened texts keeps their history, like other records of work done for people.
create or replace function public.keep_account_history() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.requests where client_id = old.id)
     or exists (select 1 from public.projects where client_id = old.id) then
    raise exception 'This account has jobs or invoices on record, so it can’t be deleted. Suspend it instead.'
      using errcode = '23503';
  end if;
  if exists (select 1 from public.requests where created_by = old.id and client_id <> old.id)
     or exists (select 1 from public.projects where client_id <> old.id and (created_by = old.id or quote_decided_by = old.id))
     or exists (select 1 from public.project_expenses where created_by = old.id and provider_id is distinct from old.id)
     or exists (select 1 from public.inbox where acknowledged_by = old.id and user_id <> old.id)
     or exists (select 1 from public.project_variations v join public.projects p on p.id = v.project_id
                where p.client_id <> old.id and (v.created_by = old.id or v.decided_by = old.id))
     or exists (select 1 from public.text_log where opened_by = old.id) then
    raise exception 'This account has done work for other people on record, so it can’t be deleted. Suspend it instead.'
      using errcode = '23503';
  end if;
  return old;
end;
$$;

alter publication supabase_realtime add table public.text_log;
