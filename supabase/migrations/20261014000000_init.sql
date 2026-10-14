-- Next Phase Maintenance — shared database schema for Supabase.
--
-- Run this once in the Supabase dashboard (SQL Editor → New query → paste → Run),
-- or with the Supabase CLI: `supabase db push`.
--
-- Access model (enforced by row-level security, not by the app):
--   admin    — everything (finance needs canManageInvoices, accounts need canEditPermissions)
--   client   — own properties, requests, projects, invoices and inbox
--   provider — jobs and projects assigned to them, plus the related properties and clients

-- ───────────────────────────── Tables ─────────────────────────────

create table public.profiles (
  id          text primary key default gen_random_uuid()::text,
  auth_id     uuid unique references auth.users (id) on delete set null,
  name        text not null,
  email       text not null,
  role        text not null check (role in ('admin', 'client', 'provider')),
  phone       text not null default '',
  company     text,
  trade       text,
  permissions text[] not null default '{}',
  status      text not null default 'invited' check (status in ('active', 'invited', 'suspended')),
  created_at  timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));

create table public.properties (
  id            text primary key default gen_random_uuid()::text,
  client_id     text not null references public.profiles (id) on delete cascade,
  address       text not null,
  suburb        text not null default '',
  postcode      text not null default '',
  paint_colors  jsonb not null default '{"walls":"","trim":"","ceiling":""}',
  skirt_profile text not null default '',
  cladding_type text not null default '',
  access_code   text not null default '',
  notes         text not null default '',
  floor_plan    text
);

create table public.requests (
  id                   text primary key default gen_random_uuid()::text,
  number               integer generated always as identity (start with 1001) unique,
  client_id            text not null references public.profiles (id) on delete cascade,
  property_id          text not null references public.properties (id) on delete restrict,
  title                text not null,
  description          text not null default '',
  category             text not null,
  urgency              text not null default 'standard' check (urgency in ('urgent', 'standard')),
  photos               text[] not null default '{}',
  completion_photos    text[] not null default '{}',
  status               text not null default 'pending'
                         check (status in ('pending', 'assigned', 'in_progress', 'awaiting_parts', 'completed')),
  assigned_provider_id text references public.profiles (id) on delete set null,
  scheduled_date       date,
  notes                text not null default '',
  sms_notified         boolean not null default false,
  created_at           timestamptz not null default now(),
  completed_at         timestamptz
);

create table public.projects (
  id                   text primary key default gen_random_uuid()::text,
  number               integer generated always as identity (start with 201) unique,
  client_id            text not null references public.profiles (id) on delete cascade,
  property_id          text not null references public.properties (id) on delete restrict,
  title                text not null,
  description          text not null default '',
  type                 text not null default 'renovation' check (type in ('renovation', 'maintenance_contract')),
  budget               numeric(12, 2) not null default 0,
  quote_amount         numeric(12, 2),
  scope_of_works       text not null default '',
  status               text not null default 'quote_requested'
                         check (status in ('quote_requested', 'quoted', 'approved', 'in_progress', 'completed', 'rejected')),
  assigned_provider_id text references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now()
);

create table public.project_milestones (
  id         text primary key default gen_random_uuid()::text,
  project_id text not null references public.projects (id) on delete cascade,
  title      text not null,
  date       date not null,
  done       boolean not null default false
);

create table public.project_expenses (
  id          text primary key default gen_random_uuid()::text,
  project_id  text not null references public.projects (id) on delete cascade,
  -- Kept (without the name) if the trade's account is deleted, so project costs stay complete.
  provider_id text references public.profiles (id) on delete set null,
  date        date not null,
  description text not null,
  category    text not null,
  amount      numeric(12, 2) not null check (amount >= 0),
  status      text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected'))
);

create table public.invoices (
  id                text primary key default gen_random_uuid()::text,
  request_id        text references public.requests (id) on delete set null,
  project_id        text references public.projects (id) on delete set null,
  -- Records are kept: a client with jobs or invoices can't be deleted (suspend them instead).
  client_id         text not null references public.profiles (id) on delete restrict,
  qb_invoice_number text not null,
  amount            numeric(12, 2) not null,
  status            text not null default 'draft' check (status in ('draft', 'sent', 'paid')),
  bank_transfer_ref text not null default '',
  paid_date         date,
  due_date          date not null,
  created_at        timestamptz not null default now()
);

create table public.sms_log (
  id              text primary key default gen_random_uuid()::text,
  recipient_phone text not null,
  message         text not null,
  sent_at         timestamptz not null default now(),
  status          text not null check (status in ('dispatched', 'queued', 'failed')),
  trigger_event   text not null,
  detail          text
);

create table public.inbox (
  id           text primary key default gen_random_uuid()::text,
  user_id      text not null references public.profiles (id) on delete cascade,
  title        text not null,
  body         text not null default '',
  created_at   timestamptz not null default now(),
  read         boolean not null default false,
  requires_ack boolean not null default false,
  acknowledged boolean not null default false,
  request_id   text references public.requests (id) on delete set null,
  project_id   text references public.projects (id) on delete set null
);

-- One row of business settings. SMS credentials are NOT stored here: they are
-- Supabase secrets read only by the send-sms server function.
create table public.settings (
  id   integer primary key default 1 check (id = 1),
  sms  jsonb not null default '{"recipients":[],"notifyOnNewRequest":true,"notifyOnUrgentOnly":false,"notifyProviderOnAssign":true}',
  bank jsonb not null default '{"accountName":"Next Phase Maintenance","bsb":"","accountNumber":""}'
);
insert into public.settings (id) values (1);

create index on public.properties (client_id);
create index on public.requests (client_id);
create index on public.requests (assigned_provider_id);
create index on public.projects (client_id);
create index on public.projects (assigned_provider_id);
create index on public.project_milestones (project_id);
create index on public.project_expenses (project_id);
create index on public.invoices (client_id);
create index on public.inbox (user_id);

-- ───────────────────────────── Helpers ─────────────────────────────
-- SECURITY DEFINER so policies can look up the caller without recursing into profiles RLS.

create function public.current_profile_id() returns text
language sql stable security definer set search_path = public as $$
  select id from profiles where auth_id = auth.uid() and status = 'active'
$$;

create function public.current_role_name() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where auth_id = auth.uid() and status = 'active'
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_role_name() = 'admin', false)
$$;

create function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p = any (permissions) from profiles where auth_id = auth.uid() and status = 'active'), false)
$$;

-- ─────────────────────── Auth account linking ───────────────────────
-- New sign-ins are invite-only: an auth user can only be created for an email
-- that already has a profile (the master admin, or someone an admin invited).

create function public.link_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update profiles set auth_id = new.id where lower(email) = lower(new.email) and auth_id is null;
  if not found then
    raise exception 'No Next Phase Maintenance invitation exists for %', new.email;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.link_auth_user();

-- Called by an invited user after choosing their password.
create function public.activate_my_account() returns void
language sql security definer set search_path = public as $$
  update profiles set status = 'active' where auth_id = auth.uid() and status = 'invited'
$$;

-- Lets clients and trades put a message in every admin's inbox without being able to read admin profiles.
create function public.notify_admins(p_title text, p_body text, p_request_id text default null, p_project_id text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_profile_id() is null then
    raise exception 'Not signed in';
  end if;
  insert into inbox (user_id, title, body, request_id, project_id)
  select id, left(p_title, 200), left(p_body, 2000), p_request_id, p_project_id
  from profiles where role = 'admin' and status = 'active';
end;
$$;

-- ─────────────────── Column guards for non-admin edits ───────────────────
-- These only restrict people signed in through the app/API (the `authenticated` role).
-- Trusted callers pass: the server functions (service_role), SQL run in the dashboard, and
-- foreign-key clean-up, which Postgres runs as the table owner. SECURITY INVOKER keeps
-- current_user accurate.

create function public.is_api_user() returns boolean
language sql stable as $$
  select current_user in ('authenticated', 'anon')
$$;

create function public.guard_request_update() returns trigger
language plpgsql set search_path = public as $$
declare
  editable text[] := array['status', 'completion_photos', 'notes', 'scheduled_date', 'completed_at'];
begin
  if not is_api_user() or is_admin() then return new; end if;
  if (to_jsonb(new) - editable) is distinct from (to_jsonb(old) - editable) then
    raise exception 'Only status, schedule, notes and completion photos can be changed';
  end if;
  if new.status = 'pending' and old.status <> 'pending' then
    raise exception 'Cannot move a job back to triage';
  end if;
  return new;
end;
$$;
create trigger guard_request_update before update on public.requests
  for each row execute function public.guard_request_update();

create function public.guard_project_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if not is_api_user() or is_admin() then return new; end if;
  -- Clients may only accept or decline an issued quote.
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status')
     or old.status <> 'quoted' or new.status not in ('approved', 'rejected') then
    raise exception 'Clients can only accept or decline an issued quote';
  end if;
  return new;
end;
$$;
create trigger guard_project_update before update on public.projects
  for each row execute function public.guard_project_update();

create function public.guard_milestone_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if not is_api_user() or is_admin() then return new; end if;
  if (to_jsonb(new) - array['done', 'date']) is distinct from (to_jsonb(old) - array['done', 'date']) then
    raise exception 'Only milestone date and completion can be changed';
  end if;
  return new;
end;
$$;
create trigger guard_milestone_update before update on public.project_milestones
  for each row execute function public.guard_milestone_update();

create function public.guard_inbox_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if not is_api_user() then return new; end if;
  if (to_jsonb(new) - array['read', 'acknowledged']) is distinct from (to_jsonb(old) - array['read', 'acknowledged']) then
    raise exception 'Only read and acknowledged can be changed';
  end if;
  return new;
end;
$$;
create trigger guard_inbox_update before update on public.inbox
  for each row execute function public.guard_inbox_update();

-- ─────────────────────────── Row-level security ───────────────────────────

alter table public.profiles enable row level security;
alter table public.properties enable row level security;
alter table public.requests enable row level security;
alter table public.projects enable row level security;
alter table public.project_milestones enable row level security;
alter table public.project_expenses enable row level security;
alter table public.invoices enable row level security;
alter table public.sms_log enable row level security;
alter table public.inbox enable row level security;
alter table public.settings enable row level security;

-- profiles: yourself, admins see all, and the other party on shared jobs.
create policy profiles_select on public.profiles for select to authenticated using (
  auth_id = auth.uid()
  or is_admin()
  or exists (
    select 1 from requests r
    where (r.client_id = current_profile_id() and r.assigned_provider_id = profiles.id)
       or (r.assigned_provider_id = current_profile_id() and r.client_id = profiles.id)
  )
  or exists (
    select 1 from projects p
    where (p.client_id = current_profile_id() and p.assigned_provider_id = profiles.id)
       or (p.assigned_provider_id = current_profile_id() and p.client_id = profiles.id)
  )
);
create policy profiles_insert on public.profiles for insert to authenticated with check (has_perm('canEditPermissions'));
create policy profiles_update on public.profiles for update to authenticated using (has_perm('canEditPermissions'));
create policy profiles_delete on public.profiles for delete to authenticated using (has_perm('canEditPermissions'));

-- properties
create policy properties_select on public.properties for select to authenticated using (
  is_admin()
  or client_id = current_profile_id()
  or exists (select 1 from requests r where r.property_id = properties.id and r.assigned_provider_id = current_profile_id())
  or exists (select 1 from projects p where p.property_id = properties.id and p.assigned_provider_id = current_profile_id())
);
create policy properties_insert on public.properties for insert to authenticated with check (
  is_admin() or (client_id = current_profile_id() and current_role_name() = 'client')
);
create policy properties_update on public.properties for update to authenticated
  using (is_admin() or client_id = current_profile_id())
  with check (is_admin() or client_id = current_profile_id());
create policy properties_delete on public.properties for delete to authenticated
  using (is_admin() or client_id = current_profile_id());

-- requests
create policy requests_select on public.requests for select to authenticated using (
  is_admin() or client_id = current_profile_id() or assigned_provider_id = current_profile_id()
);
create policy requests_insert on public.requests for insert to authenticated with check (
  is_admin()
  or (
    client_id = current_profile_id()
    and has_perm('canSubmitRequests')
    and status = 'pending'
    and assigned_provider_id is null
    and exists (select 1 from properties p where p.id = property_id and p.client_id = current_profile_id())
  )
);
create policy requests_update on public.requests for update to authenticated
  using (is_admin() or assigned_provider_id = current_profile_id())
  with check (is_admin() or assigned_provider_id = current_profile_id());
create policy requests_delete on public.requests for delete to authenticated using (is_admin());

-- projects
create policy projects_select on public.projects for select to authenticated using (
  is_admin() or client_id = current_profile_id() or assigned_provider_id = current_profile_id()
);
create policy projects_insert on public.projects for insert to authenticated with check (
  is_admin()
  or (
    client_id = current_profile_id()
    and status = 'quote_requested'
    and assigned_provider_id is null
    and quote_amount is null
    and exists (select 1 from properties p where p.id = property_id and p.client_id = current_profile_id())
  )
);
create policy projects_update on public.projects for update to authenticated
  using (is_admin() or client_id = current_profile_id())
  with check (is_admin() or client_id = current_profile_id());
create policy projects_delete on public.projects for delete to authenticated using (is_admin());

-- milestones (visible with their project; assigned trade can tick off / reschedule)
create policy milestones_select on public.project_milestones for select to authenticated using (
  exists (select 1 from projects p where p.id = project_id)
);
create policy milestones_insert on public.project_milestones for insert to authenticated with check (is_admin());
create policy milestones_update on public.project_milestones for update to authenticated using (
  is_admin() or exists (select 1 from projects p where p.id = project_id and p.assigned_provider_id = current_profile_id())
);
create policy milestones_delete on public.project_milestones for delete to authenticated using (is_admin());

-- expenses (assigned trade submits; admin approves)
create policy expenses_select on public.project_expenses for select to authenticated using (
  exists (select 1 from projects p where p.id = project_id)
);
create policy expenses_insert on public.project_expenses for insert to authenticated with check (
  is_admin()
  or (
    provider_id = current_profile_id()
    and status = 'submitted'
    and exists (select 1 from projects p where p.id = project_id and p.assigned_provider_id = current_profile_id())
  )
);
create policy expenses_update on public.project_expenses for update to authenticated using (is_admin());
create policy expenses_delete on public.project_expenses for delete to authenticated using (
  is_admin() or (provider_id = current_profile_id() and status = 'submitted')
);

-- invoices
create policy invoices_select on public.invoices for select to authenticated using (
  has_perm('canManageInvoices') or client_id = current_profile_id()
);
create policy invoices_insert on public.invoices for insert to authenticated with check (has_perm('canManageInvoices'));
create policy invoices_update on public.invoices for update to authenticated using (has_perm('canManageInvoices'));
create policy invoices_delete on public.invoices for delete to authenticated using (has_perm('canManageInvoices'));

-- sms log (written by the send-sms function with the service role)
create policy sms_select on public.sms_log for select to authenticated using (is_admin());
create policy sms_delete on public.sms_log for delete to authenticated using (is_admin());

-- inbox
create policy inbox_select on public.inbox for select to authenticated using (user_id = current_profile_id());
create policy inbox_insert on public.inbox for insert to authenticated with check (is_admin());
create policy inbox_update on public.inbox for update to authenticated using (user_id = current_profile_id());
create policy inbox_delete on public.inbox for delete to authenticated using (user_id = current_profile_id() or is_admin());

-- settings
create policy settings_select on public.settings for select to authenticated using (is_admin());
create policy settings_update on public.settings for update to authenticated using (is_admin());

-- ─────────────────────────── Photo storage ───────────────────────────
-- Public-read bucket with random file names: links are unguessable but not access-controlled.

insert into storage.buckets (id, name, public) values ('photos', 'photos', true) on conflict (id) do nothing;

create policy photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.current_profile_id() is not null);
create policy photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_admin());

-- ─────────────────────────── Live updates ───────────────────────────

alter publication supabase_realtime add table
  public.profiles, public.properties, public.requests, public.projects, public.project_milestones,
  public.project_expenses, public.invoices, public.sms_log, public.inbox, public.settings;

-- ─────────────────────────── Master admin ───────────────────────────
-- Create the login itself in Authentication → Users → Add user (tick "Auto confirm").
-- The trigger above links it to this profile automatically.

insert into public.profiles (id, name, email, role, permissions, status)
values (
  'u-admin', 'Next Phase Admin', 'admin@nextphasemaintenance.com.au', 'admin',
  array['canSubmitRequests', 'canDispatchJobs', 'canManageInvoices', 'canEditPermissions', 'canManageProjects', 'canSubmitExpenses'],
  'active'
);
update public.profiles p set auth_id = u.id
from auth.users u
where lower(u.email) = lower(p.email) and p.auth_id is null;
