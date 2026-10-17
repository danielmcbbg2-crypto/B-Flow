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

-- Who last accepted or rejected a quote, and which it was, so one an admin answered from the client's
-- dashboard (or in Projects) says so. Accepting is moving an unanswered or rejected quote on (to
-- approved, in progress or completed); rejecting is moving anything to rejected (declining, or
-- cancelling later). Other moves, like in progress back to approved, keep the record. Cleared when
-- the quote is issued again.
alter table public.projects add column quote_decided_by text references public.profiles (id) on delete set null;
alter table public.projects add column quote_decision text check (quote_decision in ('approved', 'rejected'));

create function public.stamp_quote_decided_by() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not public.is_api_user() then return new; end if;
  if tg_op = 'INSERT' or new.status in ('quote_requested', 'quoted') then
    new.quote_decided_by := null;
    new.quote_decision := null;
  elsif new.status is distinct from old.status
        and (new.status = 'rejected' or old.status in ('quote_requested', 'quoted', 'rejected')) then
    new.quote_decided_by := public.current_profile_id();
    new.quote_decision := case when new.status = 'rejected' then 'rejected' else 'approved' end;
  else
    new.quote_decided_by := old.quote_decided_by;
    new.quote_decision := old.quote_decision;
  end if;
  return new;
end;
$$;

create trigger stamp_quote_decided_by before insert or update on public.projects
  for each row execute function public.stamp_quote_decided_by();

-- Accounts whose history would be lost can't be deleted (suspend them instead):
-- - a client with jobs or projects, which deleting would otherwise erase along with the account
--   (demo mode and the app already said so; only invoices actually stopped it);
-- - an account recorded as doing something for someone else, since deleting it would blank those
--   records and make its work look like the client's or trade's own. People's own records don't
--   count, so trades still delete as before (their jobs stay, unassigned).
-- The error code is the one the delete function already reports as "suspend it instead".
create function public.keep_account_history() returns trigger
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
     or exists (select 1 from public.inbox where acknowledged_by = old.id and user_id <> old.id) then
    raise exception 'This account has done work for other people on record, so it can’t be deleted. Suspend it instead.'
      using errcode = '23503';
  end if;
  return old;
end;
$$;

create trigger keep_account_history before delete on public.profiles
  for each row execute function public.keep_account_history();
