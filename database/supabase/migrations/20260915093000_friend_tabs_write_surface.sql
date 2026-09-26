-- ============================================================================
-- Friends, M2: the write surface.
--
-- M1 (20260914103000) added the kind discriminator and the two read functions.
-- This adds the only sanctioned way to CREATE a friend tab, plus the two
-- constraints that make "one tab per pair, exactly two people" true in the
-- database rather than merely true in the app.
--
-- Additive only. splitapp.sql and every earlier migration are untouched. No
-- existing RLS policy is modified, no existing function changes its
-- DEFINER/INVOKER setting, and nothing is dropped.
-- ============================================================================


-- ---------- 1. THE PAIR TABLE ----------
-- Exists for exactly one reason: to make one-tab-per-pair a DATABASE guarantee.
-- The app could check "does a tab already exist" before inserting, but two taps
-- racing each other both pass that check and both create a tab, and from then
-- on the pair has two ledgers with money split across them. A unique constraint
-- is the only thing that cannot lose that race.
--
-- It is a separate table rather than a column on groups because the constraint
-- has to be on the PAIR, and a pair is two values. Expressed on groups it would
-- need two nullable columns plus a partial unique index, meaningless for every
-- kind='group' row.
create table if not exists public.friendships (
  -- Canonical order, enforced by the CHECK below. Storing (lo, hi) rather than
  -- (a, b) is what lets ONE unique constraint cover both directions: without it
  -- (A,B) and (B,A) are different rows and the guarantee is worthless.
  user_lo    uuid not null references public.profiles(id) on delete cascade,
  user_hi    uuid not null references public.profiles(id) on delete cascade,
  group_id   uuid not null references public.groups(id)   on delete cascade,
  created_at timestamptz not null default now(),

  -- Strictly less-than, so it also makes a self-pair impossible: (X, X) fails
  -- this check, which is a second line of defence behind the RPC's own
  -- self-friend guard.
  constraint friendships_canonical_pair check (user_lo < user_hi),

  -- THE one-tab-per-pair guarantee.
  constraint friendships_pair_unique unique (user_lo, user_hi),

  -- One friendship per backing group: a groups row cannot be claimed by two
  -- different pairs.
  constraint friendships_group_unique unique (group_id)
);

comment on table public.friendships is
  'One row per friend pair, in canonical (lo, hi) order. The unique constraint on (user_lo, user_hi) is what makes one-tab-per-pair race-safe; group_id points at the backing kind=friend group.';

alter table public.friendships enable row level security;

-- SELECT only, and deliberately nothing else. Creation goes through
-- create_friend_tab() (SECURITY DEFINER, which bypasses RLS), so authenticated
-- never needs INSERT/UPDATE/DELETE here. Adding a write policy would open a
-- path that writes a friendship row WITHOUT the group and members the RPC
-- creates alongside it -- a pair pointing at nothing.
create policy friendships_select on public.friendships
  for select using (user_lo = auth.uid() or user_hi = auth.uid());

-- REQUIRED, not belt-and-braces. This project carries default privileges
-- (pg_default_acl, grantor postgres, objtype 'r') granting authenticated
-- arwdDxtm on NEWLY CREATED tables, so friendships is born with full DML for
-- authenticated. Silence would NOT have left it locked down. RLS would still
-- refuse the writes -- there is no write policy -- but relying on that alone
-- means one future permissive policy is all that stands between a caller and a
-- hand-written friendship row. Revoke the privilege itself, then grant back
-- only the read the policy is there to scope.
--
-- anon is revoked too. splitapp.sql grants anon nothing on the original six
-- tables, and a table added later must not quietly become the first exception.
revoke all on public.friendships from authenticated, anon;
grant select on public.friendships to authenticated;


-- ---------- 2. THE TWO-MEMBER CAP ----------
-- A friend tab means exactly two people. Nothing in group_members expresses
-- that: its rows are group-scoped and a count constraint spans rows, which a
-- CHECK cannot see. A trigger is the only way to say it in the database.
--
-- STRICT NO-OP FOR NORMAL GROUPS. The kind lookup runs first and returns
-- immediately for kind='group', so adding the fifth flatmate to a flat is
-- untouched by this. The existing multi-member seeds prove it.
--
-- SECURITY DEFINER, matching reject_write_to_archived_group() on this same
-- table: the trigger body must count members regardless of who is inserting,
-- and under RLS a caller could see fewer rows than exist and wrongly pass.
--
-- NAMING AND FIRE ORDER, chosen not inherited: BEFORE INSERT triggers on one
-- table fire in NAME order, and group_members already carries
-- group_members_reject_archived. 'group_members_cap_friend_members' sorts
-- BEFORE that name, so on an archived friend tab the caller is told about the
-- member cap rather than the archive. That ordering is deliberate and harmless
-- -- both reject the insert -- but it is a real behavioural choice, so it is
-- written down rather than left to alphabetical accident.
create or replace function public.enforce_friend_member_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind  text;
  v_count integer;
begin
  select kind into v_kind from groups where id = new.group_id;

  -- Not a friend tab (or the group is gone, which the FK will reject anyway):
  -- this trigger has nothing to say. Normal groups add members freely.
  if v_kind is distinct from 'friend' then
    return new;
  end if;

  select count(*) into v_count from group_members where group_id = new.group_id;

  -- 0 existing -> the RPC's first insert passes. 1 existing -> its second
  -- insert passes. 2 existing -> a third person is refused, which is the whole
  -- point. The comparison is >= rather than = so a tab that somehow already
  -- holds three cannot be grown further.
  if v_count >= 2 then
    raise exception 'A friend tab is between exactly two people.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists group_members_cap_friend_members on public.group_members;
create trigger group_members_cap_friend_members
  before insert on public.group_members
  for each row execute function public.enforce_friend_member_cap();


-- ---------- 3. CREATE A FRIEND TAB ----------
-- SECURITY DEFINER, and this is the THIRD definer write function in the schema,
-- after join_group_via_code and record_cash_settlement. It is not a
-- convenience. The caller must, in one transaction:
--
--   * insert a groups row with kind='friend'
--   * insert a group_members row for THEMSELVES  (groups_insert / members_insert
--     would allow this much)
--   * insert a group_members row for THE OTHER PERSON, who at that instant is
--     not yet a member of the group -- members_insert requires
--     is_group_member(group_id) or is_group_creator(group_id), and the creator
--     branch does cover it, so this specific insert would pass
--   * insert a friendships row -- and there is NO insert policy on friendships,
--     by design, so this is refused outright under RLS
--
-- The friendship insert is the one that cannot be done as the caller, and it is
-- the row carrying the uniqueness guarantee, so it cannot be dropped. DEFINER
-- is therefore the mechanism, and every guard below IS the security boundary:
-- RLS is not a backstop inside this function.
--
-- It does NOT call create_group_with_owner. That function rejects any
-- group_type outside ('flat','trip','event','other') and hard-requires a UPI ID
-- on the creator's profile. A friend tab needs neither: it carries
-- group_type='other' with kind='friend', and creation is deliberately NOT gated
-- on a UPI ID (resolved decision -- the missing-UPI state is surfaced at
-- settle-time, where it is actionable, because settle-up cannot deep-link
-- without the payee's UPI ID anyway). create_group_with_owner is left exactly
-- as it is.
create or replace function public.create_friend_tab(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me         uuid := auth.uid();
  v_lo         uuid;
  v_hi         uuid;
  v_group_id   uuid;
  v_my_name    text;
  v_my_upi     text;
  v_their_name text;
  v_their_upi  text;
begin
  if v_me is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;

  if p_other is null then
    raise exception 'Pick someone to start a tab with.' using errcode = '22023';
  end if;

  if p_other = v_me then
    raise exception 'You cannot start a tab with yourself.' using errcode = '22023';
  end if;

  -- Under DEFINER there is no RLS to fall back on, and profiles_select_own
  -- would hide the other person's row from the caller anyway. Read both
  -- profiles here: their existence is a real precondition, and the display
  -- names are NOT NULL on group_members so they must be populated.
  select display_name, upi_id into v_my_name, v_my_upi
  from profiles where id = v_me;
  if not found then
    raise exception 'Complete your profile before starting a tab.' using errcode = 'P0002';
  end if;

  select display_name, upi_id into v_their_name, v_their_upi
  from profiles where id = p_other;
  if not found then
    raise exception 'That person is not on SplitApp.' using errcode = 'P0002';
  end if;

  -- Deliberately NO UPI-ID check on either side. Creation is not gated on it.

  -- Canonical order, matching friendships_canonical_pair. Doing this before the
  -- lookup is what makes the fast path direction-independent: A->B and B->A
  -- produce the same (lo, hi) and therefore find the same row.
  v_lo := least(v_me, p_other);
  v_hi := greatest(v_me, p_other);

  -- Fast path: the tab already exists. Re-opening it is a normal thing to do,
  -- so return it rather than failing -- the same idempotence join_group_via_code
  -- gives a re-used invite link.
  select group_id into v_group_id
  from friendships
  where user_lo = v_lo and user_hi = v_hi;

  if v_group_id is not null then
    return v_group_id;
  end if;

  -- ---- the create sequence, as ONE subtransaction ----
  -- A plpgsql block with an EXCEPTION handler is implicitly a subtransaction:
  -- Postgres opens an internal savepoint on entry and rolls back TO it when the
  -- handler fires. That is what makes this race-safe rather than merely
  -- race-detecting.
  --
  -- The race: two concurrent calls both miss the fast path above, both insert a
  -- group and two members, and both then try the friendship insert. One
  -- commits; the other violates friendships_pair_unique. Without this block the
  -- loser's group and member rows would survive as an ORPHANED friend tab with
  -- no friendship row -- invisible to my_friend_positions()' pair lookup, but a
  -- real row pair sitting in the ledger.
  --
  -- Because all four inserts are INSIDE the block, the rollback to savepoint
  -- undoes every one of them, and the handler then returns the winner's tab.
  -- The friendship insert is deliberately LAST so that the constraint carrying
  -- the guarantee is the thing that detects the collision.
  begin
    insert into groups (name, group_type, kind, created_by)
    values (
      'friend:' || left(v_lo::text, 8) || ':' || left(v_hi::text, 8),
      'other',
      'friend',
      v_me
    )
    returning id into v_group_id;

    -- Both real users: user_id is set on both rows, so neither is a
    -- placeholder. That is what keeps cash settlement unreachable on a friend
    -- tab (record_cash_settlement refuses when both parties have accounts) and
    -- leaves the two-step UPI flow as the only way to settle -- the enforced
    -- UPI-only behaviour the design wants, for free.
    --
    -- Roles mirror normal creation: the creator is admin, the other a member.
    -- Inert here -- cash is unreachable, so record_cash_settlement's admin
    -- branch never matters on a friend tab -- but consistent with every other
    -- group in the schema.
    insert into group_members (group_id, user_id, display_name, upi_id, role)
    values (v_group_id, v_me,    v_my_name,  v_my_upi,    'admin');

    insert into group_members (group_id, user_id, display_name, upi_id, role)
    values (v_group_id, p_other, v_their_name, v_their_upi, 'member');

    insert into friendships (user_lo, user_hi, group_id)
    values (v_lo, v_hi, v_group_id);

  exception
    when unique_violation then
      -- Someone won the race between our fast-path read and our insert. Every
      -- row above has just been rolled back to the savepoint, so there is no
      -- orphan to clean up. Re-read and hand back the tab that did commit.
      select group_id into v_group_id
      from friendships
      where user_lo = v_lo and user_hi = v_hi;

      -- If it is still missing, the violation was NOT the pair collision we are
      -- handling (uq_members_group_user, say). Re-raise rather than return a
      -- null group id and let the caller discover it downstream.
      if v_group_id is null then
        raise;
      end if;

      return v_group_id;
  end;

  return v_group_id;
end;
$$;


-- ---------- 4. GRANTS ----------
-- House rule: drop the implicit PUBLIC execute, grant only to authenticated.
revoke all on function public.create_friend_tab(uuid) from public;
grant execute on function public.create_friend_tab(uuid) to authenticated;
