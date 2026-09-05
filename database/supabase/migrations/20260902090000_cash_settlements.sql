-- ============================================================================
-- Cash settlements for placeholder members.
--
-- THE PROBLEM
-- A placeholder member has no account, so nobody can sign in as them to tap
-- "Confirm received". confirm_settlement() says so in its own comment, and it
-- is correct to refuse. But cash genuinely changes hands with people who are
-- not on the app, and the ledger has to be able to record that.
--
-- ON THE FROZEN-SCHEMA RULE
-- settlements IS defined in splitapp.sql, unlike the expense RPCs. This adds
-- two columns to it. That is the same additive precedent as groups.join_code
-- (20260731172850) and groups.archived_at (20260804174930) -- the fourth time,
-- not a new one. splitapp.sql is NOT edited and its hash stays
-- 849118...FEFBB; nothing is removed, no type or nullability changes, and every
-- existing row stays valid. Dropping a column or changing a type on a frozen
-- table would cross the line. Adding nullable/defaulted columns does not.
-- ============================================================================


-- ---------- 1. SCHEMA ----------
-- method: the default backfills the 3 existing rows CORRECTLY rather than with
-- a filler. Every settlement to date really was a UPI deep-link settlement, so
-- 'upi' is true of them, which is what makes `not null` safe here.
--
-- recorded_by: who asserted this payment happened. FK to group_members, not
-- auth.users, because every other actor column here is a member id, a member id
-- is already group-scoped, and the feed needs the display name that lives on
-- group_members.
--
-- NULLABLE, and legacy rows deliberately stay NULL. Backfilling them with
-- from_member would be inventing an audit fact: nobody "recorded" those rows
-- under this scheme. NULL is the honest encoding of "created before provenance
-- was tracked". New rows get it from the RPC, which is where the requirement is
-- enforced -- a NOT NULL column would have rejected the historical rows.
alter table public.settlements
  add column if not exists method      text not null default 'upi',
  add column if not exists recorded_by uuid references group_members(id);

-- Constrains ONLY the column this migration introduces, so it cannot reject any
-- pre-existing row. Added deliberately rather than left as a comment:
-- expense_splits.share_type is already in the backlog for exactly this gap, and
-- knowingly repeating it would be a choice, not an oversight.
alter table public.settlements
  drop constraint if exists settlements_method_check;
alter table public.settlements
  add constraint settlements_method_check check (method in ('upi', 'cash'));

comment on column public.settlements.method is
  'upi = the two-step deep-link flow. cash = recorded by a counterparty or admin because the other party is a placeholder and cannot confirm.';
comment on column public.settlements.recorded_by is
  'group_members.id of whoever asserted this payment. NULL only on rows predating this column.';


-- ---------- 2. THE RPC ----------
-- A SEPARATE function, not a p_method flag on record_settlement(). That
-- function's central rule is "you can only say I paid about yourself", which
-- this deliberately inverts; the two also differ in resulting status and in
-- security setting. One function whose parameter silently switches which
-- security model applies would be much harder to audit.
--
-- SECURITY DEFINER -- and this is the SECOND definer WRITE function in the
-- schema, after join_group_via_code. It is not a convenience:
--
--   settle_insert requires  is_own_member(from_member, group_id)
--                     AND   status = 'pending'
--                     AND   confirmed_at is null
--
-- A cash settlement recorded by the PAYEE has from_member belonging to someone
-- else, and must be 'confirmed' with confirmed_at set. It violates that policy
-- on three counts at once. The alternatives were to loosen settle_insert --
-- which would widen the insert surface for EVERY caller and drag a
-- per-settlement relational rule into a policy that expresses it badly -- or
-- this. settle_insert is deliberately left exactly as it is and still refuses
-- everything it refused before; this function is the single sanctioned
-- exception, exactly as join_group_via_code is for joining.
--
-- Because DEFINER means RLS is NOT a backstop here, every guard below is the
-- real security boundary. They all raise before the insert.
create or replace function public.record_cash_settlement(
  p_group_id     uuid,
  p_from_member  uuid,
  p_to_member    uuid,
  p_amount_minor bigint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settlement_id uuid;
  v_actor_member  uuid;
  v_actor_role    text;
  v_from_user     uuid;
  v_to_user       uuid;
  v_is_party      boolean;
  v_is_admin      boolean;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;

  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'Enter an amount greater than zero.' using errcode = '22023';
  end if;

  if p_from_member = p_to_member then
    raise exception 'You cannot settle up with yourself.' using errcode = '22023';
  end if;

  -- Resolve the caller INSIDE this group. Under DEFINER there is no RLS to fall
  -- back on, so a caller who is not a member must be stopped right here.
  select id, role into v_actor_member, v_actor_role
  from group_members
  where group_id = p_group_id and user_id = auth.uid();

  if v_actor_member is null then
    raise exception 'You are not a member of this group.' using errcode = '42501';
  end if;

  -- Both parties must belong to THIS group. The foreign keys only prove the
  -- rows exist, not which group they are in.
  select user_id into v_from_user
  from group_members where id = p_from_member and group_id = p_group_id;
  if not found then
    raise exception 'The payer is not a member of this group.' using errcode = '22023';
  end if;

  select user_id into v_to_user
  from group_members where id = p_to_member and group_id = p_group_id;
  if not found then
    raise exception 'The payee is not a member of this group.' using errcode = '22023';
  end if;

  -- (a) a party to THIS payment, or (b) the group's admin or creator.
  v_is_party := v_actor_member in (p_from_member, p_to_member);
  v_is_admin := (v_actor_role = 'admin')
                or exists (select 1 from groups
                           where id = p_group_id and created_by = auth.uid());

  if not (v_is_party or v_is_admin) then
    raise exception
      'Only the other person in this payment, or a group admin, can record a cash settlement.'
      using errcode = '42501';
  end if;

  -- At least one side must be a placeholder. Without this, the function would be
  -- a way for one account-holder to mark a payment to another as confirmed
  -- WITHOUT the payee ever agreeing -- a strictly worse hole than the one this
  -- closes. Cash between two real accounts uses the two-step UPI flow, where the
  -- payee actually confirms.
  if v_from_user is not null and v_to_user is not null then
    raise exception
      'Both people have accounts — use Settle up so the person paid can confirm it.'
      using errcode = '42501';
  end if;

  -- Confirmed at insert, in ONE statement, so the row is never momentarily
  -- inconsistent. There is no second step by design: the placeholder has no
  -- account and can never confirm.
  insert into settlements
    (group_id, from_member, to_member, amount_minor,
     method, status, confirmed_at, recorded_by)
  values
    (p_group_id, p_from_member, p_to_member, p_amount_minor,
     'cash', 'confirmed', now(), v_actor_member)
  returning id into v_settlement_id;

  return v_settlement_id;
end;
$$;


-- ---------- 3. GRANTS ----------
-- No COLUMN grants are needed for method or recorded_by, and that is the
-- correct outcome rather than an omission. authenticated holds TABLE-level
-- INSERT on settlements, which covers columns added later; only UPDATE is
-- column-narrowed, to (status, confirmed_at) by the A1 fix. Both new columns
-- are written at insert and never updated, so they inherit that freeze for
-- free -- the same trap upi_ref fell into, working in our favour this time.
revoke all on function public.record_cash_settlement(uuid, uuid, uuid, bigint) from public;
grant execute on function public.record_cash_settlement(uuid, uuid, uuid, bigint) to authenticated;
