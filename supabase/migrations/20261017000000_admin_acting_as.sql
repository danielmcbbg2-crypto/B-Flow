-- Admins can open a client's or service provider's dashboard and act in it. The records keep who
-- really did each thing: the person signed in, not the owner of the dashboard.

-- Who created each job, quote request and expense. For anyone signed in through the app it is
-- always set to themselves, whatever the app sends, and it can't be changed afterwards. The server
-- functions and SQL run in the dashboard (not API users) may set it themselves.
alter table public.requests add column created_by text references public.profiles (id) on delete set null;
alter table public.projects add column created_by text references public.profiles (id) on delete set null;
alter table public.project_expenses add column created_by text references public.profiles (id) on delete set null;

create function public.stamp_created_by() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not public.is_api_user() then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := public.current_profile_id();
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create trigger stamp_created_by before insert or update on public.requests
  for each row execute function public.stamp_created_by();
create trigger stamp_created_by before insert or update on public.projects
  for each row execute function public.stamp_created_by();
create trigger stamp_created_by before insert or update on public.project_expenses
  for each row execute function public.stamp_created_by();

-- Records made before this column existed: assume the owner made them.
update public.requests set created_by = client_id where created_by is null;
update public.projects set created_by = client_id where created_by is null;
update public.project_expenses set created_by = provider_id where created_by is null;

-- An admin viewing a service provider's dashboard sees their inbox and can acknowledge work
-- orders for them (the column guard still limits changes to read / acknowledged).
drop policy inbox_select on public.inbox;
create policy inbox_select on public.inbox for select to authenticated using (user_id = current_profile_id() or is_admin());
drop policy inbox_update on public.inbox;
create policy inbox_update on public.inbox for update to authenticated using (user_id = current_profile_id() or is_admin());

-- Who acknowledged a work order, so one acknowledged by an admin from the trade's dashboard says so.
alter table public.inbox add column acknowledged_by text references public.profiles (id) on delete set null;

create function public.stamp_acknowledged_by() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not public.is_api_user() then return new; end if;
  if tg_op = 'INSERT' then
    new.acknowledged_by := case when new.acknowledged then public.current_profile_id() end;
  elsif new.acknowledged and not old.acknowledged then
    new.acknowledged_by := public.current_profile_id();
  else
    new.acknowledged_by := old.acknowledged_by;
  end if;
  return new;
end;
$$;

create trigger stamp_acknowledged_by before insert or update on public.inbox
  for each row execute function public.stamp_acknowledged_by();

update public.inbox set acknowledged_by = user_id where acknowledged and acknowledged_by is null;

-- Who accepted or declined a quote, so one an admin answered from the client's dashboard says so.
alter table public.projects add column quote_decided_by text references public.profiles (id) on delete set null;

create function public.stamp_quote_decided_by() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not public.is_api_user() then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'quoted' and new.status in ('approved', 'rejected') then
    new.quote_decided_by := public.current_profile_id();
  elsif tg_op = 'UPDATE' then
    new.quote_decided_by := old.quote_decided_by;
  else
    new.quote_decided_by := null;
  end if;
  return new;
end;
$$;

create trigger stamp_quote_decided_by before insert or update on public.projects
  for each row execute function public.stamp_quote_decided_by();
