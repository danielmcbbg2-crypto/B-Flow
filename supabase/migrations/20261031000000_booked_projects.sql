-- Trades booked for a project's tasks (or given one of its defects) who aren't the project's own
-- trade can already read their tasks, the diary, their defects and documents shared with trades,
-- but not the project itself: its row holds the budget, quote and scope, and other project tables
-- are visible to anyone who can see it. This gives them just what they need to find the job: its
-- number, title, status and address.
create function public.my_booked_projects() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'number', p.number, 'title', p.title, 'status', p.status,
           'address', pr.address, 'suburb', pr.suburb, 'postcode', pr.postcode
         ) order by p.number), '[]'::jsonb)
  from public.projects p
  join public.properties pr on pr.id = p.property_id
  where public.current_profile_id() is not null
    and p.client_id <> public.current_profile_id()
    and p.assigned_provider_id is distinct from public.current_profile_id()
    and (exists (select 1 from public.project_tasks t where t.project_id = p.id and t.assignee_id = public.current_profile_id())
      or exists (select 1 from public.project_defects d where d.project_id = p.id and d.assignee_id = public.current_profile_id()))
$$;
revoke execute on function public.my_booked_projects() from public, anon;
grant execute on function public.my_booked_projects() to authenticated;
