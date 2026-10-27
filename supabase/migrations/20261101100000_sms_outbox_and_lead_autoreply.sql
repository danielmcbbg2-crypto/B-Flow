-- Outgoing automatic texts go through this queue. Each queued row is sent by the process-sms-outbox
-- server function, woken as soon as a row is added (and retried every 5 minutes). Rows are claimed
-- one at a time so a text is never sent twice. Also: an optional instant text back to website
-- enquiries (off until switched on in the SMS settings).
--
-- Already applied to the live project as "sms_outbox_and_lead_autoreply"; this is the same change,
-- written so it can run again harmlessly and on databases without pg_net or pg_cron (local tests).

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end;
$$;

create table if not exists public.sms_outbox (
  id uuid primary key default gen_random_uuid(),
  to_phone text not null check (length(trim(to_phone)) >= 8),
  message text not null check (length(message) between 1 and 480),
  event text not null default 'Direct message',
  source text not null default 'manual',          -- manual | claude | lead_autoreply | booking_reminder
  lead_id text references public.leads(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','sending','dispatched','failed','held')),
  detail text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists sms_outbox_pending_idx on public.sms_outbox (created_at) where status = 'pending';

alter table public.sms_outbox enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'sms_outbox' and policyname = 'Admins read outbox') then
    create policy "Admins read outbox" on public.sms_outbox for select to authenticated
      using (exists (select 1 from public.profiles p where p.auth_id = auth.uid() and p.role = 'admin' and p.status = 'active'));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'sms_outbox' and policyname = 'Admins queue texts') then
    create policy "Admins queue texts" on public.sms_outbox for insert to authenticated
      with check (exists (select 1 from public.profiles p where p.auth_id = auth.uid() and p.role = 'admin' and p.status = 'active'));
  end if;
end;
$$;

-- Atomically claim pending rows so a text is never sent twice.
create or replace function public.claim_sms_outbox(max_rows int default 20)
returns setof public.sms_outbox
language sql security definer set search_path = public as $$
  update public.sms_outbox o
     set status = 'sending', attempts = o.attempts + 1
   where o.id in (
     select id from public.sms_outbox
      where status = 'pending'
      order by created_at
      limit max_rows
      for update skip locked)
  returning o.*;
$$;
revoke all on function public.claim_sms_outbox(int) from public, anon, authenticated;
grant execute on function public.claim_sms_outbox(int) to service_role;

-- Wake the sender as soon as a text is queued (where pg_net is installed).
create or replace function public.kick_sms_outbox()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if to_regnamespace('net') is null then return null; end if;
  perform net.http_post(
    url := 'https://djgacgzmpmbrftkdlqrb.supabase.co/functions/v1/process-sms-outbox',
    body := '{}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb);
  return null;
end $$;
revoke all on function public.kick_sms_outbox() from public, anon, authenticated;

create or replace trigger sms_outbox_kick after insert on public.sms_outbox
  for each statement execute function public.kick_sms_outbox();

-- Optional instant text-back for new website enquiries (off until switched on in settings.sms.autoReply).
create or replace function public.lead_autoreply()
returns trigger language plpgsql security definer set search_path = public as $$
declare s jsonb; tmpl text; first_name text;
begin
  select sms into s from public.settings where id = 1;
  if coalesce((s->>'autoReply')::boolean, false) is not true then return new; end if;
  if coalesce(trim(new.phone), '') = '' then return new; end if;
  tmpl := coalesce(nullif(s->>'autoReplyMessage', ''), 'Hi {first_name}, it''s Daniel from Next Phase Maintenance. Thanks for your enquiry, we''ve got it. If you can, reply with a few photos of the job and we''ll come back to you with a quote.');
  first_name := split_part(trim(coalesce(new.name, '')), ' ', 1);
  if first_name = '' then first_name := 'there'; end if;
  insert into public.sms_outbox (to_phone, message, event, source, lead_id)
  values (new.phone, left(replace(tmpl, '{first_name}', first_name), 480), 'Website enquiry auto-reply', 'lead_autoreply', new.id);
  return new;
end $$;
revoke all on function public.lead_autoreply() from public, anon, authenticated;

create or replace trigger leads_autoreply after insert on public.leads
  for each row execute function public.lead_autoreply();

-- The auto-reply settings, switched off.
update public.settings
   set sms = coalesce(sms, '{}'::jsonb)
           || jsonb_build_object(
                'autoReply', coalesce((sms->>'autoReply')::boolean, false),
                'autoReplyMessage', coalesce(sms->>'autoReplyMessage',
                  'Hi {first_name}, it''s Daniel from Next Phase Maintenance. Thanks for your enquiry, we''ve got it. If you can, reply with a few photos of the job and we''ll come back to you with a quote.'))
 where id = 1;

-- Safety net: retry anything still pending every 5 minutes.
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and to_regnamespace('net') is not null then
    perform cron.schedule('sms-outbox-retry', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://djgacgzmpmbrftkdlqrb.supabase.co/functions/v1/process-sms-outbox',
    body := '{}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb)
  where exists (select 1 from public.sms_outbox where status = 'pending');
$$);
  end if;
end;
$do$;
