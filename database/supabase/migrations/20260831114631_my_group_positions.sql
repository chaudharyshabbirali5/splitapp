-- ============================================================================
-- All-groups balance positions for the signed-in caller.
--
-- WHY THIS EXISTS
-- The home screen needs each group's net for the current user. group_balances()
-- takes a single group id, so calling it per group is N+1 — 22 round-trips at
-- 20 groups, on the first screen anyone opens. This returns every group in one
-- call: 1 round-trip, flat, at any group count.
--
-- ADDITIVE ONLY. splitapp.sql, group_balances() and every existing migration
-- are untouched. Nothing below alters an existing object.
-- ============================================================================


-- ---------- 1. LOAD-BEARING CONSTRAINT ----------
-- my_group_positions() anchors on "the caller's member row in this group" and
-- collapses to ONE row per group. If a user could ever hold two member rows in
-- the same group, the function would emit that group twice and the client-side
-- grand total would DOUBLE-COUNT it — a silently wrong money figure on the
-- home screen, with no error to notice. This index makes one-row-per-group a
-- guarantee rather than a convention.
--
-- PARTIAL, on purpose: placeholders (user_id is null) are excluded, so a group
-- may still hold as many not-yet-joined members as it likes. That is required
-- by the product, and NULLs would not collide in a plain unique index anyway —
-- being explicit is clearer than relying on that.
--
-- This does NOT auto-merge a joining user with an existing placeholder of the
-- same person. That remains deliberately out of scope (see step 4 of the build
-- plan): merging is a money-moving decision and must be explicit, never a
-- side effect of a uniqueness rule.
--
-- Safe against all three insert paths, audited before writing this:
--   create_group_with_owner  — inserts into a group created one statement
--                              earlier; nothing can pre-exist.
--   join_group_via_code      — already pre-checks membership and returns early;
--                              the index now enforces that guard.
--   addPlaceholderMember     — inserts user_id = null explicitly, outside this
--                              partial index entirely.
create unique index if not exists uq_members_group_user
  on public.group_members (group_id, user_id)
  where user_id is not null;


-- ---------- 2. THE FUNCTION ----------
-- SECURITY INVOKER, deliberately. The body runs as the caller, so members_select,
-- expenses_select, splits_select and settle_select all still apply. Nothing here
-- needs to escape RLS; DEFINER would disable all four policies for no benefit.
-- (DEFINER exists in this schema only to break RLS recursion in the membership
-- helpers, and to authorise a not-yet-member joining via an invite code. Neither
-- applies to reading balances for groups you are already in.)
--
-- THE ARITHMETIC IS REPLICATED FROM group_balances(), NOT SHARED.
-- It cannot be shared: group_balances() returns every member's net for ONE group;
-- this returns ONE member's net across MANY groups. Wrapping it would reintroduce
-- the N+1 this exists to remove. Same four components, same signs, same
-- is_deleted = false / status = 'confirmed' filters, same ::bigint cast.
-- A CHANGE TO ONE MUST BE MIRRORED IN THE OTHER — the acceptance suite asserts
-- the two agree to the paise, so drift fails a test rather than shipping.
--
-- Structure differs for a reason: group_balances() uses correlated subqueries per
-- member (fine for one group). Here each component is pre-aggregated once and
-- hash-joined, so there is no per-group loop hiding inside the "single" call.
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
    -- Guaranteed at most one row per group by uq_members_group_user above.
    select gm.id as member_id, gm.group_id
    from group_members gm
    where gm.user_id = auth.uid()
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


-- ---------- 3. GRANTS ----------
-- House rule: drop the implicit PUBLIC execute, grant only to authenticated.
-- An anonymous caller has a null auth.uid(), so the anchor would match nothing
-- anyway — but the grant is the boundary, not the arithmetic.
revoke all on function public.my_group_positions() from public;
grant execute on function public.my_group_positions() to authenticated;
