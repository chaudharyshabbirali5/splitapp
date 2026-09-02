-- ============================================================================
-- Exact per-person shares for create_expense / update_expense.
--
-- ON THE FROZEN-SCHEMA RULE — read this before calling `create or replace` a
-- violation. create_expense and update_expense are NOT in splitapp.sql; they
-- were added by 20260731184252_expense_write_rpcs.sql, itself an additive
-- migration layered over the frozen base. This migration layers over THAT.
-- splitapp.sql is not touched (its hash stays 849118...FEFBB) and
-- 20260731184252 stays byte-identical. Migrations layer; the newest definition
-- of an object wins. That is what "additive" means here.
--
-- WHAT CHANGES
-- Both functions gain a trailing `p_shares bigint[] default null`. When it is
-- NULL — which is every existing caller, since none pass it — the equal-split
-- body below is the one that already ships, copied verbatim, storing
-- share_type = 'equal' exactly as now. When it is present, the shares are
-- stored as given with share_type = 'exact'.
--
-- ARRAY ALIGNMENT: p_shares[i] is the share for p_participants[i]. The two
-- arrays are correlated BY INDEX and nothing in the payload expresses that, so
-- a caller that reorders one without the other silently misassigns money. The
-- join below makes the dependency explicit in SQL rather than implied.
-- ============================================================================


create or replace function public.create_expense(
  p_group_id     uuid,
  p_paid_by      uuid,
  p_amount_minor bigint,
  p_description  text,
  p_participants uuid[],
  p_shares       bigint[] default null
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

  if p_shares is null then
    -- EQUAL SPLIT — unchanged, copied verbatim from 20260731184252.
    -- Every existing caller lands here. The +1-paise remainder goes to the
    -- first v_rem participants IN ARRAY ORDER, which the detail screen relies
    -- on when it lists shares in group-member order.
    v_base := p_amount_minor / v_n;
    v_rem  := p_amount_minor - v_base * v_n;

    insert into expense_splits (expense_id, member_id, share_minor, share_type)
    select v_expense_id,
           p.member_id,
           v_base + case when p.ord <= v_rem then 1 else 0 end,
           'equal'
    from unnest(p_participants) with ordinality as p(member_id, ord);
  else
    -- EXACT SHARES — new.
    -- Failure modes the equal path could not have, since it computed the shares
    -- itself and they were correct by construction.
    if array_length(p_shares, 1) is distinct from v_n then
      raise exception 'Each person in the split needs exactly one share.'
        using errcode = '22023';
    end if;

    -- bigint[] permits NULL elements even when the array itself is not null.
    -- Caught here so it reads as a sentence rather than a not-null violation.
    if exists (select 1 from unnest(p_shares) s where s is null) then
      raise exception 'Every share must have a value.' using errcode = '22023';
    end if;

    -- Redundant with the share_minor >= 0 check constraint, but that produces a
    -- raw Postgres error; this matches the voice of every other guard here.
    if exists (select 1 from unnest(p_shares) s where s < 0) then
      raise exception 'A share cannot be negative.' using errcode = '22023';
    end if;

    -- A zero share is legal and deliberate: someone kept on the expense who
    -- owes nothing on it. share_minor's constraint is >= 0, not > 0.
    insert into expense_splits (expense_id, member_id, share_minor, share_type)
    select v_expense_id, p.member_id, s.share, 'exact'
    from unnest(p_participants) with ordinality as p(member_id, ord)
    join unnest(p_shares)       with ordinality as s(share, ord) using (ord);
  end if;

  -- Shared by BOTH paths, and unchanged. Reads back from expense_splits rather
  -- than summing the input, so it validates what was actually stored. This is
  -- the server-side guarantee behind the sum-to-zero invariant; a mismatch
  -- rolls the whole thing back, expense row included.
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
  p_participants uuid[],
  p_shares       bigint[] default null
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

  if p_shares is null then
    -- EQUAL SPLIT — unchanged, copied verbatim from 20260731184252.
    v_base := p_amount_minor / v_n;
    v_rem  := p_amount_minor - v_base * v_n;

    insert into expense_splits (expense_id, member_id, share_minor, share_type)
    select p_expense_id,
           p.member_id,
           v_base + case when p.ord <= v_rem then 1 else 0 end,
           'equal'
    from unnest(p_participants) with ordinality as p(member_id, ord);
  else
    -- EXACT SHARES — new. Same three guards as create_expense.
    if array_length(p_shares, 1) is distinct from v_n then
      raise exception 'Each person in the split needs exactly one share.'
        using errcode = '22023';
    end if;

    if exists (select 1 from unnest(p_shares) s where s is null) then
      raise exception 'Every share must have a value.' using errcode = '22023';
    end if;

    if exists (select 1 from unnest(p_shares) s where s < 0) then
      raise exception 'A share cannot be negative.' using errcode = '22023';
    end if;

    insert into expense_splits (expense_id, member_id, share_minor, share_type)
    select p_expense_id, p.member_id, s.share, 'exact'
    from unnest(p_participants) with ordinality as p(member_id, ord)
    join unnest(p_shares)       with ordinality as s(share, ord) using (ord);
  end if;

  -- Shared by both paths, unchanged.
  select coalesce(sum(share_minor), 0) into v_sum
  from expense_splits where expense_id = p_expense_id;

  if v_sum <> p_amount_minor then
    raise exception 'Split does not add up: shares total % but the expense is %.',
      v_sum, p_amount_minor using errcode = '22023';
  end if;
end;
$$;


-- ---------- GRANTS ON THE NEW SIGNATURE ----------
-- Adding a parameter creates a NEW function identity. The grants issued in
-- 20260731184252 name the five-argument signature and do NOT carry over, and a
-- newly created function carries the default PUBLIC execute — so without these
-- two lines this would ship an RPC anonymous callers can execute.
revoke all on function public.create_expense(uuid, uuid, bigint, text, uuid[], bigint[]) from public;
revoke all on function public.update_expense(uuid, uuid, bigint, text, uuid[], bigint[]) from public;

grant execute on function public.create_expense(uuid, uuid, bigint, text, uuid[], bigint[]) to authenticated;
grant execute on function public.update_expense(uuid, uuid, bigint, text, uuid[], bigint[]) to authenticated;


-- ---------- DROP THE OLD FIVE-ARGUMENT SIGNATURE ----------
-- create or replace cannot change a signature, so the six-arg functions above
-- are ADDITIONS and the old five-arg ones still exist. Three reasons to drop:
-- one implementation rather than two that can drift; no stale definition for a
-- caller to pin; and PostgREST resolves overloads by the posted JSON keys, so
-- leaving both would make a five-key body genuinely ambiguous. After the drop a
-- five-key call resolves to the six-arg function with p_shares defaulting to
-- null — verified in the acceptance suite, not assumed.
drop function if exists public.create_expense(uuid, uuid, bigint, text, uuid[]);
drop function if exists public.update_expense(uuid, uuid, bigint, text, uuid[]);
