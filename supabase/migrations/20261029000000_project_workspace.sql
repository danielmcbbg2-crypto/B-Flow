-- Project workspace: schedule (stages and tasks booked with trades), site diary, defects (punch
-- list) and documents.
--
-- Who sees what:
--   office (projects permission)  everything, and runs it all
--   the project's client          the schedule (tasks marked for them), diary entries shared with
--                                 them, every defect (and can raise one), documents shared with them
--   trades on the project         (the project's trade, or anyone booked for one of its tasks) their
--                                 own tasks, the diary (and add to it), defects given to them, and
--                                 documents shared with trades
-- The database records who wrote, raised, fixed and closed things, and when.

-- ───────────── schedule ─────────────
create table public.project_tasks (
  id             text primary key default gen_random_uuid()::text,
  project_id     text not null references public.projects (id) on delete cascade,
  position       integer not null default 0,
  stage          text not null default '' check (length(stage) <= 80),
  title          text not null check (length(btrim(title)) between 1 and 160),
  start_date     date not null,
  end_date       date not null,
  -- When the trade is booked to arrive on the first day (for reminders); optional.
  start_time     time,
  assignee_id    text references public.profiles (id) on delete set null,
  status         text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  notes          text not null default '' check (length(notes) <= 2000),
  client_visible boolean not null default true,
  check (end_date >= start_date)
);
create index on public.project_tasks (project_id);
create index on public.project_tasks (assignee_id, start_date);

-- ───────────── site diary ─────────────
create table public.project_diary (
  id                text primary key default gen_random_uuid()::text,
  project_id        text not null references public.projects (id) on delete cascade,
  date              date not null default current_date,
  weather           text not null default '' check (length(weather) <= 80),
  on_site           text not null default '' check (length(on_site) <= 300),
  work_done         text not null check (length(btrim(work_done)) between 1 and 4000),
  issues            text not null default '' check (length(issues) <= 2000),
  photos            text[] not null default '{}' check (cardinality(photos) <= 12),
  share_with_client boolean not null default false,
  author_id         text references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now()
);
create index on public.project_diary (project_id, date);

-- ───────────── defects ─────────────
create table public.project_defects (
  id          text primary key default gen_random_uuid()::text,
  project_id  text not null references public.projects (id) on delete cascade,
  number      integer not null default 0,
  title       text not null check (length(btrim(title)) between 1 and 160),
  location    text not null default '' check (length(location) <= 120),
  description text not null default '' check (length(description) <= 2000),
  assignee_id text references public.profiles (id) on delete set null,
  due_date    date,
  status      text not null default 'open' check (status in ('open', 'fixed', 'closed')),
  photos      text[] not null default '{}' check (cardinality(photos) <= 8),
  fix_photos  text[] not null default '{}' check (cardinality(fix_photos) <= 8),
  fix_notes   text not null default '' check (length(fix_notes) <= 2000),
  raised_by   text references public.profiles (id) on delete set null,
  raised_at   timestamptz not null default now(),
  fixed_by    text references public.profiles (id) on delete set null,
  fixed_at    timestamptz,
  closed_by   text references public.profiles (id) on delete set null,
  closed_at   timestamptz,
  unique (project_id, number)
);
create index on public.project_defects (project_id);

-- ───────────── documents ─────────────
create table public.project_documents (
  id           text primary key default gen_random_uuid()::text,
  project_id   text not null references public.projects (id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 160),
  category     text not null default 'Other' check (category in ('Plans', 'Permits', 'Certificates', 'Warranties', 'Contracts', 'Photos', 'Other')),
  -- Where the file is in the private project-docs bucket: <project id>/<uuid>/<file name>.
  path         text not null unique,
  size_bytes   bigint not null default 0,
  content_type text not null default '',
  share        text not null default 'office' check (share in ('office', 'client', 'trades', 'everyone')),
  uploaded_by  text references public.profiles (id) on delete set null,
  uploaded_at  timestamptz not null default now()
);
create index on public.project_documents (project_id);

-- Helpers (security definer, so policies can use them without tripping over each other's rules).
create function public.owns_project(pid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projects where id = pid and client_id = public.current_profile_id())
$$;
create function public.works_on_project(pid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projects where id = pid and assigned_provider_id = public.current_profile_id())
      or exists (select 1 from public.project_tasks where project_id = pid and assignee_id = public.current_profile_id())
$$;

alter table public.project_tasks enable row level security;
alter table public.project_diary enable row level security;
alter table public.project_defects enable row level security;
alter table public.project_documents enable row level security;

-- Tasks
create policy tasks_select on public.project_tasks for select to authenticated using (
  has_perm('canManageProjects') or assignee_id = current_profile_id()
  or (client_visible and owns_project(project_id))
  or exists (select 1 from public.projects p where p.id = project_id and p.assigned_provider_id = current_profile_id())
);
create policy tasks_insert on public.project_tasks for insert to authenticated with check (has_perm('canManageProjects'));
create policy tasks_update on public.project_tasks for update to authenticated using (has_perm('canManageProjects') or assignee_id = current_profile_id());
create policy tasks_delete on public.project_tasks for delete to authenticated using (has_perm('canManageProjects'));

-- Diary
create policy diary_select on public.project_diary for select to authenticated using (
  has_perm('canManageProjects') or works_on_project(project_id) or (share_with_client and owns_project(project_id))
);
create policy diary_insert on public.project_diary for insert to authenticated with check (has_perm('canManageProjects') or works_on_project(project_id));
create policy diary_update on public.project_diary for update to authenticated using (has_perm('canManageProjects') or author_id = current_profile_id());
create policy diary_delete on public.project_diary for delete to authenticated using (has_perm('canManageProjects') or author_id = current_profile_id());

-- Defects
create policy defects_select on public.project_defects for select to authenticated using (
  has_perm('canManageProjects') or owns_project(project_id) or assignee_id = current_profile_id()
  or exists (select 1 from public.projects p where p.id = project_id and p.assigned_provider_id = current_profile_id())
);
create policy defects_insert on public.project_defects for insert to authenticated with check (has_perm('canManageProjects') or owns_project(project_id));
create policy defects_update on public.project_defects for update to authenticated using (
  has_perm('canManageProjects') or assignee_id = current_profile_id()
  or exists (select 1 from public.projects p where p.id = project_id and p.assigned_provider_id = current_profile_id())
);
create policy defects_delete on public.project_defects for delete to authenticated using (has_perm('canManageProjects'));

-- Documents
create policy documents_select on public.project_documents for select to authenticated using (
  has_perm('canManageProjects')
  or (share in ('client', 'everyone') and owns_project(project_id))
  or (share in ('trades', 'everyone') and works_on_project(project_id))
);
create policy documents_insert on public.project_documents for insert to authenticated with check (has_perm('canManageProjects'));
create policy documents_update on public.project_documents for update to authenticated using (has_perm('canManageProjects'));
create policy documents_delete on public.project_documents for delete to authenticated using (has_perm('canManageProjects'));

-- A trade booked for a task may only move it along (status) and add notes.
create function public.guard_task_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not public.is_api_user() or public.has_perm('canManageProjects') then return new; end if;
  if (to_jsonb(new) - array['status', 'notes']) is distinct from (to_jsonb(old) - array['status', 'notes']) then
    raise exception 'Only the office can change the schedule; you can update the status and notes';
  end if;
  return new;
end;
$$;
create trigger guard_task_update before update on public.project_tasks
  for each row execute function public.guard_task_update();

-- Diary: the author is whoever wrote it; only the office shares an entry with the client.
create function public.stamp_diary() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not public.is_api_user() then return new; end if;
  if tg_op = 'INSERT' then
    new.author_id := public.current_profile_id();
    new.created_at := now();
    if not public.has_perm('canManageProjects') then new.share_with_client := false; end if;
  else
    new.author_id := old.author_id;
    new.created_at := old.created_at;
    new.project_id := old.project_id;
    if not public.has_perm('canManageProjects') then new.share_with_client := old.share_with_client; end if;
  end if;
  return new;
end;
$$;
create trigger stamp_diary before insert or update on public.project_diary
  for each row execute function public.stamp_diary();

-- Defects: numbered per project; the database records who raised, fixed and closed each one.
-- A client may raise one (and nothing more); a trade may only mark theirs fixed, with photos and notes.
create function public.stamp_defect() returns trigger
language plpgsql set search_path = '' as $$
declare
  office boolean := public.has_perm('canManageProjects');
  me     text := public.current_profile_id();
begin
  if not public.is_api_user() then return new; end if;
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('defects:' || new.project_id));
    new.number := coalesce((select max(number) from public.project_defects where project_id = new.project_id), 0) + 1;
    new.raised_by := me;
    new.raised_at := now();
    new.fixed_by := null; new.fixed_at := null; new.closed_by := null; new.closed_at := null;
    new.fix_photos := '{}'; new.fix_notes := '';
    if not office then
      new.status := 'open';
      new.assignee_id := null;
      new.due_date := null;
    elsif new.status <> 'open' then
      new.status := 'open';
    end if;
    return new;
  end if;
  new.number := old.number; new.project_id := old.project_id;
  new.raised_by := old.raised_by; new.raised_at := old.raised_at;
  if not office then
    if (to_jsonb(new) - array['status', 'fix_photos', 'fix_notes', 'fixed_by', 'fixed_at', 'closed_by', 'closed_at'])
         is distinct from (to_jsonb(old) - array['status', 'fix_photos', 'fix_notes', 'fixed_by', 'fixed_at', 'closed_by', 'closed_at'])
       or new.status not in (old.status, 'fixed') or old.status = 'closed' then
      raise exception 'You can mark a defect fixed, with photos and notes; the office checks and closes it';
    end if;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'fixed' then new.fixed_by := me; new.fixed_at := now(); end if;
    if new.status = 'closed' then new.closed_by := me; new.closed_at := now(); end if;
    if new.status = 'open' then new.fixed_by := null; new.fixed_at := null; new.closed_by := null; new.closed_at := null; end if;
  else
    new.fixed_by := old.fixed_by; new.fixed_at := old.fixed_at; new.closed_by := old.closed_by; new.closed_at := old.closed_at;
  end if;
  return new;
end;
$$;
create trigger stamp_defect before insert or update on public.project_defects
  for each row execute function public.stamp_defect();

-- Documents: who uploaded it and when.
create function public.stamp_document() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not public.is_api_user() then return new; end if;
  if tg_op = 'INSERT' then
    new.uploaded_by := public.current_profile_id();
    new.uploaded_at := now();
  else
    new.uploaded_by := old.uploaded_by; new.uploaded_at := old.uploaded_at;
    new.path := old.path; new.project_id := old.project_id;
  end if;
  return new;
end;
$$;
create trigger stamp_document before insert or update on public.project_documents
  for each row execute function public.stamp_document();

revoke execute on function public.guard_task_update(), public.stamp_diary(), public.stamp_defect(), public.stamp_document() from public, anon, authenticated;
revoke execute on function public.owns_project(text), public.works_on_project(text) from public, anon;

-- Files: a private bucket. The office uploads; anyone who can see a document's record can read its
-- file (the check runs under their own access to project_documents).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('project-docs', 'project-docs', false, 26214400, null)
  on conflict (id) do nothing;
create policy project_docs_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'project-docs' and public.has_perm('canManageProjects'));
create policy project_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'project-docs' and exists (select 1 from public.project_documents d where d.path = storage.objects.name));
create policy project_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'project-docs' and public.has_perm('canManageProjects'));

-- Office staff who raised or closed defects keep their history (a trade's own diary entries and
-- fixes don't stop their account being deleted, as with their expenses).
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
     or exists (select 1 from public.text_log where opened_by = old.id)
     or exists (select 1 from public.project_defects d join public.projects p on p.id = d.project_id
                where p.client_id <> old.id and (d.raised_by = old.id or d.closed_by = old.id)) then
    raise exception 'This account has done work for other people on record, so it can’t be deleted. Suspend it instead.'
      using errcode = '23503';
  end if;
  return old;
end;
$$;

alter publication supabase_realtime add table
  public.project_tasks, public.project_diary, public.project_defects, public.project_documents;
