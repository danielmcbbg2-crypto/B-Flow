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
