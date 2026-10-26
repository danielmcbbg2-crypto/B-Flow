-- Website maintenance requests (the home page pop-up): each one names one of our services and comes
-- with at least one photo of the job.
--
-- Visitors upload photos to a private bucket they can add to but never read back; only the office
-- (dispatch or projects permission) can see them. submit_lead only accepts photos that were just
-- uploaded there and aren't on another request.

alter table public.leads add column photos text[] not null default '{}';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('lead-photos', 'lead-photos', false, 5242880, '{image/jpeg}')
  on conflict (id) do nothing;

create policy lead_photos_upload on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'lead-photos' and name ~ '^incoming/[0-9a-f-]{36}\.jpg$');
create policy lead_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'lead-photos' and (public.has_perm('canManageProjects') or public.has_perm('canDispatchJobs')));
create policy lead_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'lead-photos' and (public.has_perm('canManageProjects') or public.has_perm('canDispatchJobs')));

-- Replaces the version without photos (no website used it yet).
drop function public.submit_lead(text, text, text, text, jsonb, text, text, text, text);

create function public.submit_lead(
  p_name text, p_email text, p_phone text, p_suburb text, p_service text, p_urgency text,
  p_contact_by text, p_message text, p_photos jsonb, p_company text default ''
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  headers   json := nullif(current_setting('request.headers', true), '')::json;
  caller_ip text := nullif(btrim(coalesce(headers->>'cf-connecting-ip', split_part(headers->>'x-forwarded-for', ',', 1))), '');
  services  constant text[] := array['Plumbing Services', 'Electrical Services', 'Painting and Decorating', 'Handyman Services',
                                     'Carpentry Services', 'Plastering Services', 'Emergency Repairs', 'Subscription Packages'];
  l_photos  text[];
  l_number  integer;
  l_id      text;
begin
  p_name := btrim(coalesce(p_name, ''));
  p_email := btrim(coalesce(p_email, ''));
  p_phone := btrim(coalesce(p_phone, ''));
  p_suburb := btrim(coalesce(p_suburb, ''));
  p_company := btrim(coalesce(p_company, ''));
  p_message := btrim(coalesce(p_message, ''));
  p_service := btrim(coalesce(p_service, ''));
  if jsonb_typeof(p_photos) is distinct from 'array' then p_photos := '[]'; end if;
  l_photos := coalesce((select array_agg(distinct p) from jsonb_array_elements_text(p_photos) p), '{}');

  if not (p_service = any (services)) then raise exception 'Choose the service you need'; end if;
  if p_name = '' or length(p_name) > 120 then raise exception 'Enter your name'; end if;
  if p_email <> '' and (p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(p_email) > 200) then raise exception 'Enter a valid email address'; end if;
  if p_phone <> '' and (length(regexp_replace(p_phone, '\D', '', 'g')) < 8 or length(p_phone) > 40) then raise exception 'Enter a valid phone number'; end if;
  if p_email = '' and p_phone = '' then raise exception 'Leave a phone number or email so we can reply'; end if;
  if p_message = '' then raise exception 'Tell us what needs doing'; end if;
  if cardinality(l_photos) = 0 then raise exception 'Add at least one photo of the job'; end if;
  if cardinality(l_photos) > 6 then raise exception 'Up to 6 photos, please'; end if;
  if exists (select 1 from unnest(l_photos) p where p !~ '^incoming/[0-9a-f-]{36}\.jpg$')
     or (select count(*) from storage.objects o where o.bucket_id = 'lead-photos' and o.name = any (l_photos)) <> cardinality(l_photos)
     or exists (select 1 from public.leads l where l.photos && l_photos) then
    raise exception 'A photo didn’t upload properly. Please add your photos again.';
  end if;
  if p_contact_by not in ('phone', 'email') then p_contact_by := case when p_phone <> '' then 'phone' else 'email' end; end if;
  if p_contact_by = 'phone' and p_phone = '' then p_contact_by := 'email'; end if;
  if p_contact_by = 'email' and p_email = '' then p_contact_by := 'phone'; end if;
  if p_urgency not in ('urgent', 'soon', 'flexible') then p_urgency := 'flexible'; end if;
  if length(p_suburb) > 80 or length(p_company) > 120 or length(p_message) > 2000 then raise exception 'Some details are too long'; end if;

  -- Slows down anyone flooding the form, without blocking other people.
  if (p_email <> '' and (select count(*) from public.leads where lower(email) = lower(p_email) and created_at > now() - interval '1 hour') >= 3)
     or (p_phone <> '' and (select count(*) from public.leads
          where regexp_replace(phone, '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g') and created_at > now() - interval '1 hour') >= 3)
     or (caller_ip is not null and (select count(*) from public.lead_attempts a where a.ip = caller_ip and a.created_at > now() - interval '1 hour') >= 5)
     or (select count(*) from public.leads where created_at > now() - interval '10 minutes') >= 60 then
    raise exception 'We’ve already got your request. For anything urgent, please call us.';
  end if;

  insert into public.leads (name, email, phone, company, suburb, services, urgency, contact_by, message, photos)
    values (p_name, p_email, p_phone, p_company, p_suburb, array[p_service], p_urgency, p_contact_by, p_message, l_photos)
    returning id, number into l_id, l_number;

  if caller_ip is not null then
    delete from public.lead_attempts where created_at < now() - interval '1 day';
    insert into public.lead_attempts (ip) values (caller_ip);
  end if;

  insert into public.inbox (user_id, title, body)
    select id,
           case when p_urgency = 'urgent' then 'Urgent request #' else 'New maintenance request #' end || l_number || ': ' || p_name,
           concat_ws(' · ', p_service, nullif(p_suburb, ''), cardinality(l_photos) || ' photo' || case when cardinality(l_photos) > 1 then 's' else '' end,
                     case p_contact_by when 'phone' then 'call ' || p_phone else 'email ' || p_email end)
    from public.profiles
    where role = 'admin' and status = 'active'
      and ('canManageProjects' = any (permissions) or 'canDispatchJobs' = any (permissions));

  return jsonb_build_object('id', l_id, 'number', l_number);
end;
$$;
revoke execute on function public.submit_lead(text, text, text, text, text, text, text, text, jsonb, text) from public;
grant execute on function public.submit_lead(text, text, text, text, text, text, text, text, jsonb, text) to anon, authenticated;
