-- Tighten who can call the helper functions directly through the API.
-- Signed-out visitors (anon) get nothing. Signed-in users keep the helpers that the
-- access rules, photo uploads and live updates evaluate on their behalf, plus the two
-- functions the app calls (activate_my_account, notify_admins).

revoke execute on function
  public.current_profile_id(),
  public.current_role_name(),
  public.is_admin(),
  public.has_perm(text),
  public.activate_my_account(),
  public.notify_admins(text, text, text, text),
  public.link_auth_user()
from public, anon;

-- Only ever fired by the sign-up trigger on auth.users, never called directly.
revoke execute on function public.link_auth_user() from authenticated;

-- Uses only current_user, so it needs no schema search path.
alter function public.is_api_user() set search_path = '';
