-- ============================================================================
-- Friends, M1: the read path.
--
-- A friend tab is a two-person group carrying kind='friend'. This migration
-- adds that discriminator, keeps friend tabs out of the groups read, and adds a
-- dedicated read for them. It is the READ half only -- the friendships table
-- and create_friend_tab() are M2 and are deliberately not here.
--
-- Additive only. splitapp.sql and every earlier migration are untouched. No
-- existing RLS policy is modified, no function changes its SECURITY mode, and
-- nothing is dropped.
-- ============================================================================


-- ---------- 1. THE DISCRIMINATOR ----------
-- A SEPARATE axis from group_type, not a fifth value in it. group_type answers
-- "what kind of shared spending is this" ('flat'|'trip'|'event'|'other') and is
-- validated inside create_group_with_owner. kind answers "is this a 1:1 tab or
-- a real group", which is orthogonal: a friend tab still carries a group_type,
-- it is simply never displayed. Overloading group_type with 'friend' would
-- conflate the two and force a change to create_group_with_owner, which this
-- migration explicitly does not touch.
--
-- NOT NULL DEFAULT with a CONSTANT default is metadata-only from PG11 onward --
-- no table rewrite, no long lock. (This project runs PG17; the paper design
-- said PG15, which is equally covered by that same guarantee.) Every existing
-- row therefore reads 'group' without being rewritten, which is exactly right:
-- every group that exists today IS a group.
alter table public.groups
  add column if not exists kind text not null default 'group';

-- Unlike group_type -- which documents its four values in a comment and relies
-- on create_group_with_owner to enforce them -- kind gets a real CHECK. The
-- column is written by a DEFINER function in M2 that bypasses
-- create_group_with_owner entirely, so a body-level check would not be a
-- boundary. This is also the first CHECK on groups; it constrains only the
-- column this migration introduces, so it cannot reject a pre-existing row.
alter table public.groups
  drop constraint if exists groups_kind_check;
alter table public.groups
  add constraint groups_kind_check check (kind in ('group', 'friend'));

comment on column public.groups.kind is
  'group = a normal multi-person group. friend = a two-person 1:1 tab, listed on Friends rather than Groups. Orthogonal to group_type.';


-- ---------- 2. KEEP FRIEND TABS OUT OF THE GROUPS READ ----------
-- A friend tab is a real groups row with real group_members rows, so
-- my_group_positions() would return it and the home screen would show a group
-- named 'friend:ab12cd34:ef56ab78'. This filter is what stops that.
--
-- SHAPE-PRESERVING CREATE OR REPLACE, deliberately. The signature and the
-- returns-table list are byte-identical to 20260831114631, so this is a
-- replace, not a drop-and-recreate: the existing grants survive untouched and
-- SECURITY INVOKER is preserved. Postgres would REFUSE this statement outright
-- if the return shape had moved ("cannot change return type of existing
-- function"), so a silent shape change is not a failure mode available here --
-- the migration would error instead.
--
-- ARCHIVED GROUPS: no predicate, unchanged. This function has never filtered on
-- archived_at and still does not; the groups page does that filtering itself
-- with .is('archived_at', null). Adding one here would be a behaviour change
-- smuggled into a migration whose job is the friend filter.
--
-- The arithmetic below is UNCHANGED from 20260831114631 -- same four CTEs, same
-- signs, same is_deleted = false / status = 'confirmed' filters, same ::bigint
-- cast, same four left joins. It is reproduced in full because CREATE OR
-- REPLACE requires the whole body; the ONLY difference is the join to groups in
-- the `me` CTE and its `g.kind = 'group'` predicate.
create or replace function public.my_group_positions()
returns table (group_id uuid, my_member_id uuid, net_minor bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with me as (
    -- Anchor. A second gate beyond RLS: members_select also passes for a group's
    -- creator, and a creator with no member row has no "my net" to report.
    -- Guaranteed at most one row per group by uq_members_group_user.
    --
    -- The join to groups is the friend filter and the only change in this body.
    -- It cannot lose a row that the previous version returned: group_members.
    -- group_id is NOT NULL with an FK to groups(id), so every member row has
    -- exactly one groups row, and kind is NOT NULL DEFAULT 'group' so every
    -- pre-existing group satisfies the predicate. groups_select also passes for
    -- anyone already past the members anchor.
    select gm.id as member_id, gm.group_id
    from group_members gm
    join groups g on g.id = gm.group_id
    where gm.user_id = auth.uid()
      and g.kind = 'group'
  ),
  paid as (
    select e.group_id, e.paid_by as member_id, sum(e.amount_minor) as amt
    from expenses e
    where e.is_deleted = false
    group by e.group_id, e.paid_by
  ),
  owed as (
    select e.group_id, s.member_id, sum(s.share_minor) as amt
    from expense_splits s
    join expenses e on e.id = s.expense_id
    where e.is_deleted = false
    group by e.group_id, s.member_id
  ),
  paid_out as (
    select st.group_id, st.from_member as member_id, sum(st.amount_minor) as amt
    from settlements st
    where st.status = 'confirmed'
    group by st.group_id, st.from_member
  ),
  received as (
    select st.group_id, st.to_member as member_id, sum(st.amount_minor) as amt
    from settlements st
    where st.status = 'confirmed'
    group by st.group_id, st.to_member
  )
  select
    me.group_id,
    me.member_id,
    ( coalesce(paid.amt,     0)
    - coalesce(owed.amt,     0)
    + coalesce(paid_out.amt, 0)
    - coalesce(received.amt, 0)
    )::bigint
  from me
  left join paid     on paid.group_id     = me.group_id and paid.member_id     = me.member_id
  left join owed     on owed.group_id     = me.group_id and owed.member_id     = me.member_id
  left join paid_out on paid_out.group_id = me.group_id and paid_out.member_id = me.member_id
  left join received on received.group_id = me.group_id and received.member_id = me.member_id;
$$;

-- Re-asserted rather than assumed. CREATE OR REPLACE preserves grants, so these
-- are already in place from 20260831114631; restating them means the guarantee
-- does not depend on knowing that, and they are idempotent either way.
revoke all on function public.my_group_positions() from public;
grant execute on function public.my_group_positions() to authenticated;


-- ---------- 3. THE FRIEND READ ----------
-- A DEDICATED function rather than a kind parameter on my_group_positions().
-- The two differ in their projection, not just a filter: this one resolves a
-- counterparty, which is meaningless for an n-way group. Keeping them separate
-- also means the Groups screen's contract cannot move when the Friends screen's
-- needs change.
--
-- SECURITY INVOKER, matching my_group_positions() for the same reasons:
-- auth.uid() must resolve to the caller, and members_select / expenses_select /
-- splits_select / settle_select should all still apply. Nothing here needs to
-- escape RLS.
--
-- THE ARITHMETIC IS THE SAME AS group_balances() AND my_group_positions().
-- Same four components, same signs, same filters, same cast. It is replicated
-- for the same reason my_group_positions() replicates it -- those return every
-- member's net for one group, or one member's net across many groups; neither
-- shape can be wrapped to produce this one without reintroducing an N+1. A
-- CHANGE TO ONE MUST BE MIRRORED IN ALL THREE; the acceptance suite asserts
-- this function agrees with group_balances() to the paise, so drift fails a
-- test rather than shipping.
--
-- SIGN CONVENTION: net_minor is the CALLER's own net, identical to what
-- group_balances(group_id) returns for the caller's member row. Positive means
-- the caller is owed -- they paid more than their share -- so on a friend tab
-- the friend owes them. Negative means the caller owes. Zero is settled.
--
-- ARCHIVED GROUPS: no predicate, matching my_group_positions() exactly. If
-- archived tabs should ever be hidden, that decision belongs to both functions
-- at once, not to this one alone.
create or replace function public.my_friend_positions()
returns table (
  group_id               uuid,
  my_member_id           uuid,
  counterparty_member_id uuid,
  counterparty_user_id   uuid,
  name                   text,
  upi                    text,
  net_minor              bigint,
  last_entry_description text,
  last_entry_at          timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with me as (
    -- The caller's own member row in each friend tab. uq_members_group_user
    -- guarantees at most one per group, so this cannot fan out.
    select gm.id as member_id, gm.group_id
    from group_members gm
    join groups g on g.id = gm.group_id
    where gm.user_id = auth.uid()
      and g.kind = 'friend'
  ),
  other as (
    -- The counterparty: the member row in the same tab that is NOT the caller's.
    -- M2's cap trigger makes "the other member" singular; until it lands, a
    -- malformed three-member friend row would fan out here rather than pick an
    -- arbitrary winner. That is the honest failure -- a visibly wrong row count
    -- beats a silently chosen counterparty.
    select me.group_id, gm.id as member_id, gm.user_id, gm.display_name, gm.upi_id
    from me
    join group_members gm
      on gm.group_id = me.group_id
     and gm.id <> me.member_id
  ),
  paid as (
    select e.group_id, e.paid_by as member_id, sum(e.amount_minor) as amt
    from expenses e
    where e.is_deleted = false
    group by e.group_id, e.paid_by
  ),
  owed as (
    select e.group_id, s.member_id, sum(s.share_minor) as amt
    from expense_splits s
    join expenses e on e.id = s.expense_id
    where e.is_deleted = false
    group by e.group_id, s.member_id
  ),
  paid_out as (
    select st.group_id, st.from_member as member_id, sum(st.amount_minor) as amt
    from settlements st
    where st.status = 'confirmed'
    group by st.group_id, st.from_member
  ),
  received as (
    select st.group_id, st.to_member as member_id, sum(st.amount_minor) as amt
    from settlements st
    where st.status = 'confirmed'
    group by st.group_id, st.to_member
  ),
  last_entry as (
    -- The most recent non-deleted expense per tab, for the list row's meta line.
    -- distinct on is the cheap top-1-per-group; the order by must lead with the
    -- same expression distinct on uses. id breaks ties so the pick is stable
    -- when two expenses share a timestamp.
    select distinct on (e.group_id)
           e.group_id, e.description, e.created_at
    from expenses e
    where e.is_deleted = false
    order by e.group_id, e.created_at desc, e.id desc
  )
  select
    me.group_id,
    me.member_id,
    other.member_id,
    other.user_id,
    other.display_name,
    other.upi_id,
    ( coalesce(paid.amt,     0)
    - coalesce(owed.amt,     0)
    + coalesce(paid_out.amt, 0)
    - coalesce(received.amt, 0)
    )::bigint,
    last_entry.description,
    last_entry.created_at
  from me
  join      other      on other.group_id      = me.group_id
  left join paid       on paid.group_id       = me.group_id and paid.member_id     = me.member_id
  left join owed       on owed.group_id       = me.group_id and owed.member_id     = me.member_id
  left join paid_out   on paid_out.group_id   = me.group_id and paid_out.member_id = me.member_id
  left join received   on received.group_id   = me.group_id and received.member_id = me.member_id
  left join last_entry on last_entry.group_id = me.group_id;
$$;


-- ---------- 4. GRANTS ----------
-- House rule: drop the implicit PUBLIC execute, grant only to authenticated.
-- An anonymous caller has a null auth.uid(), so the anchor matches nothing
-- anyway -- but the grant is the boundary, not the arithmetic.
revoke all on function public.my_friend_positions() from public;
grant execute on function public.my_friend_positions() to authenticated;
