-- Booking reminders: the day before a booking, the trade and the client get a reminder in their
-- portal inbox (with the time and address), so nobody forgets a start. Bookings are:
--   project tasks   on a running project (approved or in progress), not done; the client only
--                   hears about tasks marked for them
--   maintenance     jobs with a scheduled date that aren't completed
-- A database job runs it every afternoon (Melbourne time decides what "tomorrow" is). Each reminder
-- is recorded in reminder_log, so running it twice never sends anything twice. Texts from the
-- office's phones are kept in the text log, as for other texts.

create table public.reminder_log (
  id           text primary key default gen_random_uuid()::text,
  kind         text not null check (kind in ('task', 'request')),
  ref_id       text not null,
  booking_date date not null,
  recipient_id text not null references public.profiles (id) on delete cascade,
  sent_at      timestamptz not null default now(),
  unique (kind, ref_id, booking_date, recipient_id)
);
create index on public.reminder_log (booking_date);

-- Admins can see what went out; only the job writes to it.
alter table public.reminder_log enable row level security;
create policy reminder_log_select on public.reminder_log for select to authenticated using (is_admin());

create function public.send_booking_reminders(p_day date default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d date := coalesce(p_day, (now() at time zone 'Australia/Melbourne')::date + 1);
  b record;
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
    -- Only people who can sign in get one.
    continue when not exists (select 1 from public.profiles where id = b.recipient_id and status = 'active');
    insert into public.reminder_log (kind, ref_id, booking_date, recipient_id)
    values (b.kind, b.ref_id, d, b.recipient_id)
    on conflict do nothing;
    continue when not found;
    insert into public.inbox (user_id, title, body, request_id, project_id)
    values (
      b.recipient_id,
      left('Booked for ' || to_char(d, 'FMDay FMDD FMMonth') || ': ' || b.title, 200),
      left(
        case when b.for_client then 'Our team is booked at your place' else 'You are booked at' end
        || ' ' || b.address || case when b.suburb <> '' then ', ' || b.suburb else '' end
        || coalesce(' from ' || to_char(b.start_time, 'FMHH12:MI am'), '')
        || ' (' || b.job || ').'
        || case when b.for_client then ' Please make sure we can get in. Reply in the portal if the day doesn''t suit.'
                else ' Let the office know straight away if you can''t make it.' end,
        2000),
      b.request_id,
      b.project_id
    );
    sent := sent + 1;
  end loop;
  return sent;
end;
$$;
-- Only the scheduled job (and the dashboard's SQL editor) runs it.
revoke execute on function public.send_booking_reminders(date) from public, anon, authenticated;

-- Every day at 06:00 UTC: 5pm in Melbourne in summer, 4pm in winter. Skipped where pg_cron isn't
-- installed (local test databases).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('booking-reminders', '0 6 * * *', 'select public.send_booking_reminders()');
  end if;
end;
$$;
