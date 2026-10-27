-- Quotes pipeline: when each quote was issued and answered (set by the database, for ageing,
-- follow-ups and win rates), when the office last followed it up, and reusable quote templates.

alter table public.projects
  add column quote_issued_at      timestamptz,
  add column quote_decided_at     timestamptz,
  add column quote_followed_up_at timestamptz;

-- Existing quotes: the best guess for when they were issued is when they were set up.
update public.projects set quote_issued_at = created_at where status <> 'quote_requested';

-- Runs after stamp_quote_decided_by (triggers fire in name order), so a new decision is already
-- recorded. Issuing (again) restarts the clock and the follow-ups; answering it records when.
-- Only the office records follow-ups.
create function public.stamp_quote_times() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not public.is_api_user() then return new; end if;
  if tg_op = 'INSERT' then
    new.quote_issued_at := case when new.status = 'quote_requested' then null else now() end;
    new.quote_decided_at := case when new.quote_decision is null then null else now() end;
    new.quote_followed_up_at := null;
    return new;
  end if;
  if new.status = 'quoted' and old.status is distinct from 'quoted' then
    new.quote_issued_at := now();
    new.quote_followed_up_at := null;
  else
    new.quote_issued_at := old.quote_issued_at;
    if not public.has_perm('canManageProjects') then new.quote_followed_up_at := old.quote_followed_up_at; end if;
  end if;
  if new.quote_decision is null then
    new.quote_decided_at := null;
  elsif new.quote_decision is distinct from old.quote_decision or new.quote_decided_by is distinct from old.quote_decided_by then
    new.quote_decided_at := now();
  else
    new.quote_decided_at := old.quote_decided_at;
  end if;
  return new;
end;
$$;
create trigger stamp_quote_times before insert or update on public.projects
  for each row execute function public.stamp_quote_times();
revoke execute on function public.stamp_quote_times() from public, anon, authenticated;

-- Templates: a standard quote (lines, inclusions, exclusions) to start new quotes from.
create table public.quote_templates (
  id          text primary key default gen_random_uuid()::text,
  name        text not null check (length(btrim(name)) between 1 and 120),
  items       jsonb not null default '[]' check (jsonb_typeof(items) = 'array'),
  inclusions  text not null default '',
  exclusions  text not null default '',
  created_at  timestamptz not null default now()
);
alter table public.quote_templates enable row level security;
create policy quote_templates_select on public.quote_templates for select to authenticated using (has_perm('canManageProjects'));
create policy quote_templates_insert on public.quote_templates for insert to authenticated with check (has_perm('canManageProjects'));
create policy quote_templates_update on public.quote_templates for update to authenticated using (has_perm('canManageProjects'));
create policy quote_templates_delete on public.quote_templates for delete to authenticated using (has_perm('canManageProjects'));

alter publication supabase_realtime add table public.quote_templates;
