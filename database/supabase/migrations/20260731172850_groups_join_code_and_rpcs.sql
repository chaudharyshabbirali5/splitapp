-- ============================================================
-- Groups: invite codes, atomic creation, and self-join (TRD Section 12.4)
--
-- Additive only. splitapp.sql and earlier migrations are untouched, and no
-- existing RLS policy is modified.
-- ============================================================


-- ---------- 1. INVITE CODE ----------
-- A random uuid per group rather than a separate invites table: nothing in this
-- step needs multiple codes, expiry or revocation, and the code lives inside a
-- row already covered by groups_select, so a non-member cannot read it.
-- gen_random_uuid() is 122 bits of entropy, so the code is not guessable.

alter table public.groups
  add column if not exists join_code uuid not null default gen_random_uuid();

create unique index if not exists idx_groups_join_code on public.groups(join_code);


-- ---------- 2. CREATE GROUP + OWNER MEMBERSHIP (SECURITY INVOKER) ----------
-- Deliberately INVOKER: RLS still applies exactly as before, so this function
-- grants no privilege the caller did not already have. Its only job is to make
-- the two inserts atomic. Doing them as two PostgREST calls can leave a group
-- with no members if the second one fails.

create or replace function public.create_group_with_owner(p_name text, p_group_type text)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_group_id     uuid;
  v_display_name text;
  v_upi_id       text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to create a group.' using errcode = '28000';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Give the group a name.' using errcode = '22023';
  end if;

  -- The schema documents these four values in a comment but has no constraint,
  -- so validate here rather than letting anything through.
  if p_group_type not in ('flat', 'trip', 'event', 'other') then
    raise exception 'Unknown group type: %', p_group_type using errcode = '22023';
  end if;

  select display_name, upi_id into v_display_name, v_upi_id
  from profiles
  where id = auth.uid();

  -- The profile gate is enforced in the UI too; repeated here so the rule holds
  -- even if the RPC is called directly.
  if coalesce(btrim(v_display_name), '') = '' then
    raise exception 'Complete your profile before creating a group.' using errcode = 'P0002';
  end if;
  if coalesce(btrim(v_upi_id), '') = '' then
    raise exception 'Add a UPI ID to your profile before creating a group.' using errcode = 'P0002';
  end if;

  insert into groups (name, group_type, created_by)
  values (btrim(p_name), p_group_type, auth.uid())
  returning id into v_group_id;

  -- Permitted by members_insert via is_group_creator(): the group row above is
  -- already visible inside this transaction.
  insert into group_members (group_id, user_id, display_name, upi_id, role)
  values (v_group_id, auth.uid(), v_display_name, v_upi_id, 'admin');

  return v_group_id;
end;
$$;


-- ---------- 3. JOIN VIA INVITE CODE (SECURITY DEFINER) ----------
-- This one MUST be DEFINER. Someone opening an invite link is neither a member
-- nor the creator, so members_insert correctly refuses their INSERT. Rather than
-- weakening that policy, joining goes through this function, which is the only
-- sanctioned way to add yourself to a group you were invited to.
--
-- Holding a valid invite code is the authorisation check.
--
-- Note: this never merges the joiner into an existing placeholder member of the
-- same name. Placeholder claiming is deferred to v1.1 (TRD Section 14); joining
-- always creates a fresh row.

create or replace function public.join_group_via_code(p_code uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id     uuid;
  v_display_name text;
  v_upi_id       text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to join a group.' using errcode = '28000';
  end if;

  select id into v_group_id
  from groups
  where join_code = p_code;

  if v_group_id is null then
    raise exception 'That invite link is not valid.' using errcode = 'P0002';
  end if;

  -- Idempotent: re-opening an invite link you have already used is a normal
  -- thing to do, so return the group instead of failing.
  if exists (
    select 1 from group_members
    where group_id = v_group_id and user_id = auth.uid()
  ) then
    return v_group_id;
  end if;

  select display_name, upi_id into v_display_name, v_upi_id
  from profiles
  where id = auth.uid();

  if coalesce(btrim(v_display_name), '') = '' then
    raise exception 'Complete your profile before joining a group.' using errcode = 'P0002';
  end if;

  insert into group_members (group_id, user_id, display_name, upi_id, role)
  values (v_group_id, auth.uid(), v_display_name, v_upi_id, 'member');

  return v_group_id;
end;
$$;


-- ---------- 4. GRANTS ----------
-- Both functions are useless (and join_group_via_code would be dangerous) to an
-- unauthenticated caller, so drop the implicit PUBLIC execute and grant only to
-- the authenticated role.

revoke all on function public.create_group_with_owner(text, text) from public;
revoke all on function public.join_group_via_code(uuid)          from public;

grant execute on function public.create_group_with_owner(text, text) to authenticated;
grant execute on function public.join_group_via_code(uuid)           to authenticated;
