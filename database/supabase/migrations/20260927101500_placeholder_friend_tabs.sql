-- ============================================================================
-- Friends, M3: the placeholder-friend creation path.
--
-- M1 (20260914103000) added the kind discriminator and the two read functions.
-- M2 (20260915093000) added friendships, create_friend_tab() and the two-member
-- cap. Both only ever produce a tab between two REAL accounts.
--
-- This adds the other half: a friend tab with someone who is not on SplitApp.
-- It is the same placeholder model groups have used since the initial schema --
-- group_members.user_id IS NULL with a display_name on the member row -- applied
-- to a two-person tab.
--
-- ONE new function. Nothing existing is altered: no table changes, no RLS policy
-- modified, no function changes its DEFINER/INVOKER setting, no trigger touched,
-- and splitapp.sql plus every earlier migration are untouched.
-- ============================================================================


-- ---------- 1. CREATE A PLACEHOLDER FRIEND TAB ----------
-- A SEPARATE function from create_friend_tab(p_other uuid), not an overload and
-- not a nullable parameter on it. The two differ in their fundamental input: one
-- takes a profiles.id that must exist, the other takes a NAME for someone who by
-- definition has no profiles row. Folding them together would mean a function
-- whose central precondition ("that person is on SplitApp") is conditional on
-- which argument you passed, which is exactly the kind of thing that is hard to
-- audit. They also differ in dedup, see below.
--
-- SECURITY DEFINER, for the same reason create_friend_tab is. The caller must
-- insert a groups row and TWO group_members rows in one transaction, and the
-- placeholder row is written for someone who is not the caller and has no
-- account. members_insert permits it via is_group_creator(group_id) -- the group
-- was created one statement earlier in this same transaction -- so this
-- particular sequence would in fact pass under RLS. DEFINER is used anyway, for
-- consistency with create_friend_tab and because the guards below are then
-- unambiguously the security boundary rather than a mix of body checks and
-- policy. Being the FOURTH definer write function, after join_group_via_code,
-- record_cash_settlement and create_friend_tab, it follows an established
-- pattern rather than setting one.
--
-- NO FRIENDSHIPS ROW, deliberately (paper design section 4). friendships exists
-- to make one-tab-per-pair a database guarantee, and it cannot express this
-- pair: user_lo and user_hi are both NOT NULL with FKs to profiles, and
-- friendships_canonical_pair requires user_lo < user_hi. A placeholder has no
-- profiles id to put in either column.
--
-- That is not merely a schema limitation -- dedup is UNDEFINED here. Two real
-- accounts have one stable identity each, so "the same pair" is a fact. Two tabs
-- both naming a placeholder "Ravi" may be the same Ravi or two different people,
-- and the database has no way to know. Silently collapsing them would merge two
-- ledgers, which is a money-moving decision. So a placeholder tab is
-- deliberately NOT idempotent: calling this twice with the same name creates two
-- tabs, and that is the honest behaviour. The UI should warn on a duplicate
-- name; it must not be enforced here.
--
-- It does NOT call create_group_with_owner, for the same two reasons M2 gives:
-- that function rejects any group_type outside ('flat','trip','event','other')
-- and hard-requires a UPI ID on the creator's profile. Creation is deliberately
-- not gated on a UPI ID. create_group_with_owner is left exactly as it is.
--
-- THE CAP TRIGGER IS SATISFIED. enforce_friend_member_cap counts existing rows
-- BEFORE each insert and rejects at >= 2, so this function's two inserts see 0
-- then 1 and both pass; a third would see 2 and be refused. Verified by reading
-- the trigger body, and asserted by the acceptance suite.
--
-- ONE CONSEQUENCE WORTH NAMING: because the placeholder side has user_id NULL,
-- record_cash_settlement's both-parties-have-accounts guard does NOT fire on
-- these tabs. Cash settlement is therefore REACHABLE here, unlike on a
-- real-to-real friend tab where it is refused and UPI is the only path. That is
-- correct -- a person not on the app can never tap "Confirm received", so cash
-- recorded by the counterparty is the only way their debt can ever settle -- but
-- it is a real behavioural difference between the two kinds of friend tab.
create or replace function public.create_placeholder_friend_tab(
  p_name text,
  p_upi  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me       uuid := auth.uid();
  v_group_id uuid;
  v_my_name  text;
  v_my_upi   text;
  v_name     text;
  v_upi      text;
begin
  if v_me is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;

  -- btrim first, then test: a name of spaces is not a name. group_members.
  -- display_name is NOT NULL, and a blank string would satisfy that constraint
  -- while producing a member row nobody can identify on screen.
  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' then
    raise exception 'Give this person a name.' using errcode = '22023';
  end if;

  -- A blank UPI ID and no UPI ID are the same thing; store the absence as NULL
  -- rather than as an empty string so the settle screen's "has a UPI ID" test is
  -- a plain null check, matching how addPlaceholderMember already writes it.
  v_upi := nullif(btrim(coalesce(p_upi, '')), '');

  -- The caller's own name and UPI, for their member row. Under DEFINER there is
  -- no RLS, and display_name is NOT NULL on group_members, so this must resolve.
  select display_name, upi_id into v_my_name, v_my_upi
  from profiles where id = v_me;
  if not found then
    raise exception 'Complete your profile before starting a tab.' using errcode = 'P0002';
  end if;

  -- Sentinel name, never displayed: the Friends list renders the counterparty's
  -- display_name from my_friend_positions(), not groups.name. It carries the
  -- creator's id for traceability, a ':ph:' marker so a placeholder tab is
  -- recognisable in raw data, and a random tail because -- unlike the real-pair
  -- sentinel, which is a deterministic function of the two user ids -- there is
  -- no second identity to derive uniqueness from, and two tabs with the same
  -- placeholder name must not collide on this string.
  insert into groups (name, group_type, kind, created_by)
  values (
    'friend:' || left(v_me::text, 8) || ':ph:' || left(gen_random_uuid()::text, 8),
    'other',
    'friend',
    v_me
  )
  returning id into v_group_id;

  -- The real member: the caller, admin, mirroring every other creation path.
  insert into group_members (group_id, user_id, display_name, upi_id, role)
  values (v_group_id, v_me, v_my_name, v_my_upi, 'admin');

  -- The placeholder: user_id NULL is the ONLY thing that makes it one. Its name
  -- and UPI live on this row, which is why my_friend_positions() resolves the
  -- counterparty from group_members rather than joining profiles -- a join that
  -- would return nothing here.
  insert into group_members (group_id, user_id, display_name, upi_id, role)
  values (v_group_id, null, v_name, v_upi, 'member');

  -- No friendships row. See the header: the table cannot express this pair, and
  -- dedup has no defined meaning without a stable counterparty identity.

  return v_group_id;
end;
$$;


-- ---------- 2. GRANTS ----------
-- House rule: drop the implicit PUBLIC execute, grant only to authenticated.
-- Both the one-argument and two-argument forms are named explicitly: p_upi has a
-- DEFAULT, so Postgres exposes a single function with one identity
-- (text, text) -- naming that identity is what the revoke and grant apply to,
-- and a caller omitting p_upi resolves to the same function.
revoke all on function public.create_placeholder_friend_tab(text, text) from public;
grant execute on function public.create_placeholder_friend_tab(text, text) to authenticated;
