-- ============================================================
-- Expenses: atomic create/update with equal-split rounding (TRD 12.5)
--
-- Additive only. splitapp.sql and earlier migrations are untouched, and no
-- existing RLS policy is modified.
--
-- Both functions are SECURITY INVOKER on purpose, matching
-- create_group_with_owner. RLS keeps doing the authorisation:
--   expenses_insert  -> is_group_member(group_id) AND created_by = auth.uid()
--   splits_insert    -> is_expense_member(expense_id)
-- The functions add no privilege; they exist so the expense row and its splits
-- land in one transaction. Two PostgREST calls can leave an expense with no
-- splits, which would silently corrupt every future balance.
--
-- Rounding rule (TRD Section 7), applied here rather than in the client so the
-- shares can never disagree with the amount:
--   base = amount_minor / n          (integer division)
--   rem  = amount_minor - base * n
--   the first `rem` participants, in the order supplied, get one extra paise.
-- Each function then re-reads the stored splits and refuses to return unless
-- they sum to exactly amount_minor.
-- ============================================================


-- ---------- helper: validate participants against a group ----------
-- Kept as a plain check inside each function rather than a shared function, so
-- there is no extra grantable surface.


create or replace function public.create_expense(
  p_group_id     uuid,
  p_paid_by      uuid,
  p_amount_minor bigint,
  p_description  text,
  p_participants uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_expense_id uuid;
  v_n          int;
  v_base       bigint;
  v_rem        bigint;
  v_sum        bigint;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;

  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'Enter an amount greater than zero.' using errcode = '22023';
  end if;

  v_n := coalesce(array_length(p_participants, 1), 0);
  if v_n = 0 then
    raise exception 'Pick at least one person to split between.' using errcode = '22023';
  end if;

  if v_n <> (select count(distinct x) from unnest(p_participants) x) then
    raise exception 'The same person is listed twice.' using errcode = '22023';
  end if;

  -- The foreign keys only prove these are real group_members rows, not that they
  -- belong to THIS group. Without these two checks an expense could reference a
  -- member of a different group.
  if not exists (
    select 1 from group_members where id = p_paid_by and group_id = p_group_id
  ) then
    raise exception 'The payer is not a member of this group.' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(p_participants) x
    where not exists (
      select 1 from group_members gm where gm.id = x and gm.group_id = p_group_id
    )
  ) then
    raise exception 'Someone in the split is not a member of this group.' using errcode = '22023';
  end if;

  insert into expenses (group_id, paid_by, amount_minor, description, created_by)
  values (
    p_group_id,
    p_paid_by,
    p_amount_minor,
    nullif(btrim(coalesce(p_description, '')), ''),
    auth.uid()
  )
  returning id into v_expense_id;

  v_base := p_amount_minor / v_n;
  v_rem  := p_amount_minor - v_base * v_n;

  insert into expense_splits (expense_id, member_id, share_minor, share_type)
  select v_expense_id,
         p.member_id,
         v_base + case when p.ord <= v_rem then 1 else 0 end,
         'equal'
  from unnest(p_participants) with ordinality as p(member_id, ord);

  select coalesce(sum(share_minor), 0) into v_sum
  from expense_splits where expense_id = v_expense_id;

  if v_sum <> p_amount_minor then
    raise exception 'Split does not add up: shares total % but the expense is %.',
      v_sum, p_amount_minor using errcode = '22023';
  end if;

  return v_expense_id;
end;
$$;


create or replace function public.update_expense(
  p_expense_id   uuid,
  p_paid_by      uuid,
  p_amount_minor bigint,
  p_description  text,
  p_participants uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_group_id uuid;
  v_n        int;
  v_base     bigint;
  v_rem      bigint;
  v_sum      bigint;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;

  -- Runs under RLS: a non-member sees no row, so this is also the access check.
  select group_id into v_group_id
  from expenses
  where id = p_expense_id and is_deleted = false;

  if v_group_id is null then
    raise exception 'That expense no longer exists.' using errcode = 'P0002';
  end if;

  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'Enter an amount greater than zero.' using errcode = '22023';
  end if;

  v_n := coalesce(array_length(p_participants, 1), 0);
  if v_n = 0 then
    raise exception 'Pick at least one person to split between.' using errcode = '22023';
  end if;

  if v_n <> (select count(distinct x) from unnest(p_participants) x) then
    raise exception 'The same person is listed twice.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from group_members where id = p_paid_by and group_id = v_group_id
  ) then
    raise exception 'The payer is not a member of this group.' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(p_participants) x
    where not exists (
      select 1 from group_members gm where gm.id = x and gm.group_id = v_group_id
    )
  ) then
    raise exception 'Someone in the split is not a member of this group.' using errcode = '22023';
  end if;

  update expenses
     set paid_by      = p_paid_by,
         amount_minor = p_amount_minor,
         description  = nullif(btrim(coalesce(p_description, '')), '')
   where id = p_expense_id;

  -- Replace rather than reconcile: the participant set can change completely.
  delete from expense_splits where expense_id = p_expense_id;

  v_base := p_amount_minor / v_n;
  v_rem  := p_amount_minor - v_base * v_n;

  insert into expense_splits (expense_id, member_id, share_minor, share_type)
  select p_expense_id,
         p.member_id,
         v_base + case when p.ord <= v_rem then 1 else 0 end,
         'equal'
  from unnest(p_participants) with ordinality as p(member_id, ord);

  select coalesce(sum(share_minor), 0) into v_sum
  from expense_splits where expense_id = p_expense_id;

  if v_sum <> p_amount_minor then
    raise exception 'Split does not add up: shares total % but the expense is %.',
      v_sum, p_amount_minor using errcode = '22023';
  end if;
end;
$$;


-- ---------- GRANTS ----------
revoke all on function public.create_expense(uuid, uuid, bigint, text, uuid[]) from public;
revoke all on function public.update_expense(uuid, uuid, bigint, text, uuid[]) from public;

grant execute on function public.create_expense(uuid, uuid, bigint, text, uuid[]) to authenticated;
grant execute on function public.update_expense(uuid, uuid, bigint, text, uuid[]) to authenticated;
