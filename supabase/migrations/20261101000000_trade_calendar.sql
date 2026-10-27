-- Trades' calendar: they see every booking on the projects they work on (so they know who else is
-- on site), and can move their own bookings and maintenance orders. Nothing else is theirs to move.
-- The office is told whenever a trade moves something.

-- Every task on a project the trade works on (its own trade, or booked for one of its tasks).
alter policy tasks_select on public.project_tasks using (
  has_perm('canManageProjects')
  or assignee_id = current_profile_id()
  or (client_visible and owns_project(project_id))
  or works_on_project(project_id)
);

-- A trade may move their own booking (its dates) as well as its status and notes. Everything else
-- about the schedule stays with the office. (Only their own: tasks_update already limits them to
-- tasks booked for them.)
create or replace function public.guard_task_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not public.is_api_user() or public.has_perm('canManageProjects') then return new; end if;
  if (to_jsonb(new) - array['status', 'notes', 'start_date', 'end_date']) is distinct from (to_jsonb(old) - array['status', 'notes', 'start_date', 'end_date']) then
    raise exception 'Only the office can change the schedule; you can move your own booking and update its status and notes';
  end if;
  if new.start_date is distinct from old.start_date or new.end_date is distinct from old.end_date then
    perform public.notify_admins(
      'Booking moved: ' || left(new.title, 120),
      (select coalesce(name, 'A trade') from public.profiles where id = public.current_profile_id())
        || ' moved it from ' || to_char(old.start_date, 'FMDD Mon') || ' to ' || to_char(new.start_date, 'FMDD Mon')
        || coalesce(' (P-' || (select number from public.projects where id = new.project_id) || ')', '') || '.',
      null,
      new.project_id
    );
  end if;
  return new;
end;
$$;

-- A trade moving their maintenance order (the columns they may change are guarded already).
create function public.notify_request_moved() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.is_api_user() and not public.has_perm('canDispatchJobs')
     and new.scheduled_date is distinct from old.scheduled_date then
    perform public.notify_admins(
      'Job moved: #' || new.number || ' ' || left(new.title, 120),
      (select coalesce(name, 'A trade') from public.profiles where id = public.current_profile_id())
        || ' moved it ' || coalesce('from ' || to_char(old.scheduled_date, 'FMDD Mon') || ' ', '')
        || coalesce('to ' || to_char(new.scheduled_date, 'FMDD Mon'), 'off the calendar') || '.',
      new.id,
      null
    );
  end if;
  return new;
end;
$$;
create trigger notify_request_moved after update of scheduled_date on public.requests
  for each row execute function public.notify_request_moved();
revoke execute on function public.notify_request_moved() from public, anon, authenticated;
