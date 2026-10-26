-- Leads: enquiries from the website's "Get a quote" form, from people without an account.
--
-- Visitors can only send one through submit_lead (checked and rate-limited); nobody can read them
-- back except the office (dispatch or projects permission), who follow them up and can turn one into
-- a client account.

create table public.leads (
  id          text primary key default gen_random_uuid()::text,
  number      integer generated always as identity (start with 3001) unique,
  name        text not null,
  email       text not null default '',
  phone       text not null default '',
  company     text not null default '',
  suburb      text not null default '',
  services    text[] not null default '{}',
  urgency     text not null default 'flexible' check (urgency in ('urgent', 'soon', 'flexible')),
  contact_by  text not null default 'phone' check (contact_by in ('phone', 'email')),
  message     text not null default '',
  status      text not null default 'new' check (status in ('new', 'contacted', 'won', 'lost')),
  notes       text not null default '',
  -- The client account made from this lead, if any.
  client_id   text references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index on public.leads (created_at);

alter table public.leads enable row level security;
create policy leads_select on public.leads for select to authenticated
  using (has_perm('canManageProjects') or has_perm('canDispatchJobs'));
create policy leads_update on public.leads for update to authenticated
  using (has_perm('canManageProjects') or has_perm('canDispatchJobs'));
create policy leads_delete on public.leads for delete to authenticated
  using (has_perm('canManageProjects') or has_perm('canDispatchJobs'));

-- The office moves a lead along and keeps notes; what the visitor sent stays as sent.
create function public.guard_lead_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not public.is_api_user() then return new; end if;
  if (to_jsonb(new) - array['status', 'notes', 'client_id']) is distinct from (to_jsonb(old) - array['status', 'notes', 'client_id']) then
    raise exception 'What the enquiry said can’t be changed; add a note instead';
  end if;
  return new;
end;
$$;
create trigger guard_lead_update before update on public.leads
  for each row execute function public.guard_lead_update();
revoke execute on function public.guard_lead_update() from public, anon, authenticated;

-- Where enquiries came from, to limit each visitor rather than everyone. Kept for a day; only
-- submit_lead reads or writes it.
create table public.lead_attempts (
  ip         text not null,
  created_at timestamptz not null default now()
);
create index on public.lead_attempts (ip, created_at);
alter table public.lead_attempts enable row level security;
revoke all on public.lead_attempts from anon, authenticated;

create function public.submit_lead(
  p_name text, p_email text, p_phone text, p_suburb text, p_services jsonb, p_urgency text,
  p_contact_by text, p_message text, p_company text default ''
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  headers   json := nullif(current_setting('request.headers', true), '')::json;
  caller_ip text := nullif(btrim(coalesce(headers->>'cf-connecting-ip', split_part(headers->>'x-forwarded-for', ',', 1))), '');
  l_number  integer;
  l_id      text;
  l_services text[];
begin
  p_name := btrim(coalesce(p_name, ''));
  p_email := btrim(coalesce(p_email, ''));
  p_phone := btrim(coalesce(p_phone, ''));
  p_suburb := btrim(coalesce(p_suburb, ''));
  p_company := btrim(coalesce(p_company, ''));
  p_message := btrim(coalesce(p_message, ''));
  if jsonb_typeof(p_services) is distinct from 'array' then p_services := '[]'; end if;
  l_services := coalesce((select array_agg(distinct btrim(s)) from jsonb_array_elements_text(p_services) s where btrim(s) <> ''), '{}');
  if p_name = '' or length(p_name) > 120 then raise exception 'Enter your name'; end if;
  if p_email <> '' and (p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(p_email) > 200) then raise exception 'Enter a valid email address'; end if;
  if p_phone <> '' and (length(regexp_replace(p_phone, '\D', '', 'g')) < 8 or length(p_phone) > 40) then raise exception 'Enter a valid phone number'; end if;
  if p_email = '' and p_phone = '' then raise exception 'Leave a phone number or email so we can reply'; end if;
  if p_contact_by not in ('phone', 'email') then p_contact_by := case when p_phone <> '' then 'phone' else 'email' end; end if;
  if p_contact_by = 'phone' and p_phone = '' then p_contact_by := 'email'; end if;
  if p_contact_by = 'email' and p_email = '' then p_contact_by := 'phone'; end if;
  if p_urgency not in ('urgent', 'soon', 'flexible') then p_urgency := 'flexible'; end if;
  if cardinality(l_services) > 10 or exists (select 1 from unnest(l_services) s where length(s) > 60) then raise exception 'Choose up to 10 services'; end if;
  if length(p_suburb) > 80 or length(p_company) > 120 or length(p_message) > 2000 then raise exception 'Some details are too long'; end if;

  -- Slows down anyone flooding the form, without blocking other people.
  if (p_email <> '' and (select count(*) from public.leads where lower(email) = lower(p_email) and created_at > now() - interval '1 hour') >= 3)
     or (p_phone <> '' and (select count(*) from public.leads
          where regexp_replace(phone, '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g') and created_at > now() - interval '1 hour') >= 3)
     or (caller_ip is not null and (select count(*) from public.lead_attempts a where a.ip = caller_ip and a.created_at > now() - interval '1 hour') >= 5)
     or (select count(*) from public.leads where created_at > now() - interval '10 minutes') >= 60 then
    raise exception 'We’ve already got your enquiry. For anything urgent, please call us.';
  end if;

  insert into public.leads (name, email, phone, company, suburb, services, urgency, contact_by, message)
    values (p_name, p_email, p_phone, p_company, p_suburb, l_services, p_urgency, p_contact_by, p_message)
    returning id, number into l_id, l_number;

  if caller_ip is not null then
    delete from public.lead_attempts where created_at < now() - interval '1 day';
    insert into public.lead_attempts (ip) values (caller_ip);
  end if;

  insert into public.inbox (user_id, title, body)
    select id,
           case when p_urgency = 'urgent' then 'Urgent enquiry #' else 'New enquiry #' end || l_number || ': ' || p_name,
           concat_ws(' · ', nullif(array_to_string(l_services, ', '), ''), nullif(p_suburb, ''),
                     case p_contact_by when 'phone' then 'call ' || p_phone else 'email ' || p_email end)
    from public.profiles
    where role = 'admin' and status = 'active'
      and ('canManageProjects' = any (permissions) or 'canDispatchJobs' = any (permissions));

  return jsonb_build_object('id', l_id, 'number', l_number);
end;
$$;
revoke execute on function public.submit_lead(text, text, text, text, jsonb, text, text, text, text) from public;
grant execute on function public.submit_lead(text, text, text, text, jsonb, text, text, text, text) to anon, authenticated;

alter publication supabase_realtime add table public.leads;
