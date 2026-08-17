-- ============================================================
-- Settle up: record a payment, and confirm receiving one (TRD 12.7)
--
-- Additive only. splitapp.sql and earlier migrations are untouched, and no
-- existing RLS policy is modified.
--
-- Both functions are SECURITY INVOKER, matching create_expense: RLS keeps doing
-- the group-boundary authorisation (settle_insert / settle_update both require
-- is_group_member), and these add the within-group rules that RLS cannot express
-- as written:
--
--   record_settlement  -> you may only record a payment YOU made
--   confirm_settlement -> only the person who was PAID may confirm it
--
-- Known limitation, deliberately not worked around here: settle_insert and
-- settle_update permit any group member, so a member who calls PostgREST
-- directly can still write a settlement these checks would refuse. Closing that
-- means replacing those two policies, which is a change to existing policy and
-- needs a decision first.
-- ============================================================


create or replace function public.record_settlement(
  p_group_id     uuid,
  p_from_member  uuid,
  p_to_member    uuid,
  p_amount_minor bigint
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_settlement_id uuid;
  v_from_user     uuid;
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

  select user_id into v_from_user
  from group_members
  where id = p_from_member and group_id = p_group_id;

  if not found then
    raise exception 'The payer is not a member of this group.' using errcode = '22023';
  end if;

  -- You can only say "I paid" about yourself.
  if v_from_user is distinct from auth.uid() then
    raise exception 'You can only record a payment you made yourself.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from group_members where id = p_to_member and group_id = p_group_id
  ) then
    raise exception 'The payee is not a member of this group.' using errcode = '22023';
  end if;

  -- Always 'pending'. Nothing affects balances until the payee confirms, because
  -- there is no reliable automatic confirmation for peer-to-peer UPI.
  insert into settlements (group_id, from_member, to_member, amount_minor, status)
  values (p_group_id, p_from_member, p_to_member, p_amount_minor, 'pending')
  returning id into v_settlement_id;

  return v_settlement_id;
end;
$$;


create or replace function public.confirm_settlement(p_settlement_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_to_user uuid;
  v_status  text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;

  -- Runs under RLS, so a non-member finds nothing and gets the same message as
  -- a stranger would for a settlement that does not exist.
  select s.status, gm.user_id
    into v_status, v_to_user
  from settlements s
  join group_members gm on gm.id = s.to_member
  where s.id = p_settlement_id;

  if not found then
    raise exception 'That settlement no longer exists.' using errcode = 'P0002';
  end if;

  -- A placeholder payee has user_id NULL, so this comparison also (correctly)
  -- refuses: nobody can confirm on behalf of someone with no account.
  if v_to_user is distinct from auth.uid() then
    raise exception 'Only the person who was paid can confirm this.' using errcode = '42501';
  end if;

  -- Idempotent: tapping Confirm twice should not error or move confirmed_at.
  if v_status = 'confirmed' then
    return;
  end if;

  update settlements
     set status = 'confirmed',
         confirmed_at = now()
   where id = p_settlement_id;
end;
$$;


-- ---------- GRANTS ----------
revoke all on function public.record_settlement(uuid, uuid, uuid, bigint) from public;
revoke all on function public.confirm_settlement(uuid)                    from public;

grant execute on function public.record_settlement(uuid, uuid, uuid, bigint) to authenticated;
grant execute on function public.confirm_settlement(uuid)                    to authenticated;
