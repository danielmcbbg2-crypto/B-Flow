-- Clients and service providers can be added before they have a login: nothing is sent, and an
-- email address is optional until an admin gives them access with an invite. Their properties,
-- projects and jobs are recorded against the same account, so they see them once they sign in.

-- No email yet is stored as null (the unique index allows any number of those). A sign-up is
-- only ever matched to a profile by email, so an account without one can't be signed into.
alter table public.profiles alter column email drop not null;

-- Whether a login exists. One is created when the first invite is sent, so the app can tell "no
-- login yet" from "invite pending", and only lets admins change the email before then (the login
-- is tied to it).
alter table public.profiles add column has_login boolean generated always as (auth_id is not null) stored;

-- An account with a login always keeps an email address.
alter table public.profiles add constraint profiles_login_has_email check (email is not null or auth_id is null);

-- A login is only linked to an account an admin has invited, not to any account whose email
-- matches: someone who knows a no-login client's email can't claim the account by signing up
-- themselves. The invite-user function sets this just before it creates the login; the app
-- can't (the guard below keeps it as it was).
alter table public.profiles add column login_invited boolean not null default false;
update public.profiles set login_invited = true where auth_id is not null or id = 'u-admin';

create or replace function public.link_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update profiles set auth_id = new.id
   where lower(email) = lower(new.email) and auth_id is null and (login_invited or id = 'u-admin');
  if not found then
    raise exception 'No Next Phase Maintenance invitation exists for %', new.email;
  end if;
  return new;
end;
$$;

-- Through the API: login_invited stays as it was, and the email can't change once there's a
-- login (it's what they sign in with). Changing the email before then needs a fresh invite.
create function public.guard_profile_login() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if public.is_api_user() then new.login_invited := false; end if;
    return new;
  end if;
  if public.is_api_user() then
    new.login_invited := old.login_invited;
    if old.auth_id is not null and new.email is distinct from old.email then
      raise exception 'The email can’t change once the account has a login.' using errcode = 'check_violation';
    end if;
  end if;
  if old.auth_id is null and new.email is distinct from old.email then
    new.login_invited := false;
  end if;
  return new;
end;
$$;

create trigger guard_profile_login before insert or update on public.profiles
  for each row execute function public.guard_profile_login();

revoke execute on function public.guard_profile_login() from public, anon, authenticated;
