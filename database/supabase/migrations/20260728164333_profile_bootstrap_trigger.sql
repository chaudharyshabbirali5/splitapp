-- ============================================================
-- Profile bootstrap (TRD Section 5)
--
-- Every signed-up user needs a profiles row, with profiles.id === auth.users.id.
-- Doing this in the database rather than the client means the row exists before
-- the app ever runs a query, and it cannot be skipped by a client that crashes
-- mid-signup.
--
-- SECURITY DEFINER + search_path = public, matching the helper-function style in
-- the initial migration: the function runs as its owner so it can write to
-- public.profiles regardless of the RLS policies on that table.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    -- display_name is NOT NULL. At signup all we know is the email, so use the
    -- part before the "@". The user can change it on the profile screen.
    -- nullif(...,'') guards against a pathological address like "@example.com".
    coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'New user')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Fires once per newly created auth user. `after insert` so the auth.users row is
-- already committed to the transaction before the profile references it.
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
