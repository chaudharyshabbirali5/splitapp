-- ============================================================
-- Harden settlement RLS (audit finding A1)
--
-- Before this migration, settle_insert and settle_update were both a bare
-- is_group_member(group_id). The payer-only and payee-only rules lived solely
-- inside record_settlement() and confirm_settlement(), so any group member who
-- called PostgREST directly could:
--
--   * insert a settlement claiming SOMEONE ELSE paid, or
--   * insert one already marked 'confirmed', or
--   * confirm a settlement addressed to somebody else,
--
-- each of which silently moves balances, because group_balances() counts every
-- confirmed settlement.
--
-- This migration moves those rules into RLS so they hold no matter how the row
-- is written. splitapp.sql and every earlier migration are untouched; the two
-- policies are replaced here.
--
-- Note on scope: the table owner (postgres) still bypasses RLS, which is what
-- lets the acceptance test seed data directly. The threat model here is the
-- `authenticated` role, which is the only role the app ever uses.
-- ============================================================


-- ---------- 1. HELPERS ----------
-- SECURITY DEFINER for the same reason as is_group_member: a policy on
-- settlements that reads group_members would otherwise re-enter RLS on
-- group_members, whose own policy calls back into these helpers. Running the
-- lookup as the owner breaks that recursion. search_path is pinned so the
-- elevated body cannot be redirected to another schema's tables.

/** True when p_member_id is a member row of p_group_id that belongs to the caller. */
create or replace function public.is_own_member(p_member_id uuid, p_group_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from group_members
    where id = p_member_id
      and group_id = p_group_id
      and user_id = auth.uid()
  );
$$;

/** True when p_member_id belongs to p_group_id, whether or not it has an account. */
create or replace function public.is_group_member_row(p_member_id uuid, p_group_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from group_members
    where id = p_member_id and group_id = p_group_id
  );
$$;

revoke all on function public.is_own_member(uuid, uuid)       from public;
revoke all on function public.is_group_member_row(uuid, uuid) from public;

grant execute on function public.is_own_member(uuid, uuid)       to authenticated;
grant execute on function public.is_group_member_row(uuid, uuid) to authenticated;


-- ---------- 2. INSERT: you may only record a payment YOU made ----------
-- is_own_member(from_member, group_id) already implies the caller is a member of
-- the group, so a separate is_group_member() term would be redundant.

drop policy if exists settle_insert on public.settlements;

create policy settle_insert on public.settlements
  for insert
  with check (
    -- the payer must be the caller's own member row, in this group
    is_own_member(from_member, group_id)
    -- the payee must belong to the same group (placeholders allowed)
    and is_group_member_row(to_member, group_id)
    and from_member <> to_member
    -- a member cannot self-insert an already-settled row
    and status = 'pending'
    and confirmed_at is null
  );


-- ---------- 3. UPDATE: only the payee, only pending -> confirmed ----------
-- USING sees the existing row, WITH CHECK sees the proposed row, so together
-- they pin the transition to exactly one direction. USING requiring 'pending'
-- also makes confirmation one-way: a confirmed row can never be un-confirmed.

drop policy if exists settle_update on public.settlements;

create policy settle_update on public.settlements
  for update
  using (
    status = 'pending'
    and is_own_member(to_member, group_id)
  )
  with check (
    status = 'confirmed'
    and confirmed_at is not null
    and is_own_member(to_member, group_id)
  );


-- ---------- 4. COLUMN-LEVEL UPDATE ----------
-- RLS compares whole rows; WITH CHECK cannot say "and the amount did not
-- change". Column privileges can. Restricting UPDATE to just these two columns
-- means a payee confirming a settlement cannot also rewrite its amount, its
-- group, or who it was from and to.
--
-- INSERT, SELECT and DELETE grants from splitapp.sql are left as they were.

revoke update on public.settlements from authenticated;
grant update (status, confirmed_at) on public.settlements to authenticated;
