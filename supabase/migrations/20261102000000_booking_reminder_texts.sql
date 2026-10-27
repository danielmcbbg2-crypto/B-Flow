-- Booking reminders by text: the afternoon before a booking, the trade and the client also get a
-- text (through the SMS outbox, so ClickSend sends it from the business's own mobile number). Unlike
-- the portal inbox reminder, this reaches people without a login too: anyone with a mobile on file
-- who isn't suspended. Switch it off in the SMS settings ("bookingReminderTexts").
--
-- Each text's event names the booking ("Booking reminder · task <id> · <date> · trade"), the same
-- as the office's tap-to-send reminders, so the office queue shows which have gone. A booking is
-- texted at most once per person per day (dedupe_key), however often the job runs.

alter table public.sms_outbox add column if not exists dedupe_key text;
create unique index if not exists sms_outbox_dedupe_key on public.sms_outbox (dedupe_key);

update public.settings
   set sms = coalesce(sms, '{}'::jsonb) || jsonb_build_object('bookingReminderTexts', coalesce((sms->>'bookingReminderTexts')::boolean, true))
 where id = 1;

-- The sender doesn't need a wake-up call where pg_net isn't installed (local test databases).
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

create or replace function public.send_booking_reminders(p_day date default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Australia/Melbourne')::date;
  d date := coalesce(p_day, today + 1);
  -- "tomorrow (Wed 28 Oct)", or "on Wed 28 Oct" when run for another day.
  said text := case when d = today + 1 then 'tomorrow (' || to_char(d, 'Dy FMDD Mon') || ')' else 'on ' || to_char(d, 'Dy FMDD Mon') end;
  texts boolean := coalesce((select (sms->>'bookingReminderTexts')::boolean from public.settings where id = 1), true);
  b record;
  who record;
  place text;
  at_time text;
  event text;
  sent integer := 0;
begin
  for b in
    -- project tasks: the trade booked for it
    select 'task' as kind, t.id as ref_id, t.assignee_id as recipient_id, p.id as project_id, null::text as request_id,
           t.title, p.title as job, t.start_time, pr.address, pr.suburb, false as for_client
    from public.project_tasks t
    join public.projects p on p.id = t.project_id
    join public.properties pr on pr.id = p.property_id
    where t.start_date = d and t.status <> 'done' and t.assignee_id is not null
      and p.status in ('approved', 'in_progress')
    union all
    -- project tasks the client can see
    select 'task', t.id, p.client_id, p.id, null, t.title, p.title, t.start_time, pr.address, pr.suburb, true
    from public.project_tasks t
    join public.projects p on p.id = t.project_id
    join public.properties pr on pr.id = p.property_id
    where t.start_date = d and t.status <> 'done' and t.client_visible
      and p.status in ('approved', 'in_progress')
    union all
    -- maintenance jobs: the trade
    select 'request', r.id, r.assigned_provider_id, null, r.id, r.title, 'Job #' || r.number, null::time, pr.address, pr.suburb, false
    from public.requests r
    join public.properties pr on pr.id = r.property_id
    where r.scheduled_date = d and r.status <> 'completed' and r.assigned_provider_id is not null
    union all
    -- maintenance jobs: the client
    select 'request', r.id, r.client_id, null, r.id, r.title, 'Job #' || r.number, null::time, pr.address, pr.suburb, true
    from public.requests r
    join public.properties pr on pr.id = r.property_id
    where r.scheduled_date = d and r.status <> 'completed'
  loop
    select name, phone, status into who from public.profiles where id = b.recipient_id;
    continue when not found;
    place := b.address || case when b.suburb <> '' then ', ' || b.suburb else '' end;
    at_time := coalesce(' from ' || to_char(b.start_time, 'FMHH12:MI am'), '');

    -- The portal inbox, for people who can sign in.
    if who.status = 'active' then
      insert into public.reminder_log (kind, ref_id, booking_date, recipient_id)
      values (b.kind, b.ref_id, d, b.recipient_id)
      on conflict do nothing;
      if found then
        insert into public.inbox (user_id, title, body, request_id, project_id)
        values (
          b.recipient_id,
          left('Booked for ' || to_char(d, 'FMDay FMDD FMMonth') || ': ' || b.title, 200),
          left(
            case when b.for_client then 'Our team is booked at your place' else 'You are booked at' end
            || ' ' || place || at_time || ' (' || b.job || ').'
            || case when b.for_client then ' Please make sure we can get in. Reply in the portal if the day doesn''t suit.'
                    else ' Let the office know straight away if you can''t make it.' end,
            2000),
          b.request_id,
          b.project_id
        );
        sent := sent + 1;
      end if;
    end if;

    -- A text, for anyone with a mobile on file.
    if texts and who.status <> 'suspended' and coalesce(btrim(who.phone), '') <> '' then
      event := 'Booking reminder · ' || b.kind || ' ' || b.ref_id || ' · ' || d || ' · ' || case when b.for_client then 'client' else 'trade' end;
      insert into public.sms_outbox (to_phone, message, event, source, dedupe_key)
      values (
        who.phone,
        left(
          'Hi ' || coalesce(nullif(split_part(btrim(who.name), ' ', 1), ''), 'there') || ', a reminder from Next Phase Maintenance: '
          || case when b.for_client
                  then 'our team is booked at ' || place || ' ' || said || at_time || ' for ' || lower(b.title)
                       || '. Please make sure we can get in, and reply to this text if the day doesn''t suit.'
                  else 'you''re booked ' || said || at_time || ' for ' || b.title || ' at ' || place || ' (' || b.job || ')'
                       || '. Let us know straight away if anything changes.' end,
          480),
        event,
        'booking_reminder',
        event || ' · ' || b.recipient_id
      )
      on conflict (dedupe_key) do nothing;
    end if;
  end loop;
  return sent;
end;
$$;
revoke execute on function public.send_booking_reminders(date) from public, anon, authenticated;
