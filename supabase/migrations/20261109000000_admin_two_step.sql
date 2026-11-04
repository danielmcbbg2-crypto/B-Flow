-- Two-step sign-in for admins. An admin's login only gets admin powers once it has done the second
-- step (a code from an authenticator app), which Supabase Auth records in the login's token as
-- "aal2". With just the password ("aal1"), the database treats an admin as having no access, so a
-- stolen or guessed admin password alone opens nothing. Clients and trades are unaffected.
--
-- Every access rule for admins goes through is_admin(), has_perm() or current_profile_id(), so the
-- check lives in those three (and the two outbox rules that checked the role directly now use
-- is_admin()). The server functions check the same thing for their admin actions.

create or replace function public.second_step_done() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;
grant execute on function public.second_step_done() to anon, authenticated, service_role;

create or replace function public.current_profile_id() returns text
language sql stable security definer set search_path = '' as $$
  select id from public.profiles
   where auth_id = auth.uid() and status = 'active' and (role <> 'admin' or public.second_step_done())
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_role_name() = 'admin', false) and public.second_step_done()
$$;

create or replace function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p = any (permissions) and (role <> 'admin' or public.second_step_done())
                     from public.profiles where auth_id = auth.uid() and status = 'active'), false)
$$;

alter policy "Admins read outbox" on public.sms_outbox using ((select public.is_admin()));
alter policy "Admins queue texts" on public.sms_outbox with check ((select public.is_admin()));
