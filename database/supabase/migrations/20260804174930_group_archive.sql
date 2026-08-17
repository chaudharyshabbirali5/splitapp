-- ============================================================
-- Archive a group (soft delete)
--
-- Why soft, not hard:
--
--   1. A hard DELETE is not actually possible for any group that has expenses.
--      groups cascades to BOTH group_members and expenses, but
--      expense_splits.member_id -> group_members is ON DELETE NO ACTION, so the
--      member rows are removed while splits still reference them:
--        "update or delete on table group_members violates foreign key
--         constraint expense_splits_member_id_fkey on table expense_splits"
--      The existing groups_delete policy is effectively dead for real groups.
--   2. A group ledger is shared. The creator is not its sole owner - every other
--      member has a financial stake in those expenses and settlements, and one
--      person should not be able to erase everyone else's record of who paid
--      what.
--   3. It matches how expenses already work (is_deleted), so the whole ledger
--      stays append-only.
--
-- Additive only. splitapp.sql and earlier migrations are untouched, and no
-- existing policy is modified.
-- ============================================================


-- ---------- 1. COLUMN ----------
-- Nullable timestamp rather than a boolean: it is the flag AND the audit trail
-- of when it happened. NULL means active.

alter table public.groups
  add column if not exists archived_at timestamptz;


-- ---------- 2. ARCHIVE RPC ----------
-- SECURITY INVOKER: the groups_update policy already restricts UPDATE to
-- is_group_creator, so RLS is what actually enforces creator-only. The explicit
-- check exists to return a readable message instead of a silent zero-row update.

create or replace function public.archive_group(p_group_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;

  -- Runs under RLS, so a non-member sees nothing and gets the same answer as
  -- someone naming a group that does not exist.
  select true into v_exists from groups where id = p_group_id;
  if not found then
    raise exception 'That group no longer exists.' using errcode = 'P0002';
  end if;

  if not is_group_creator(p_group_id) then
    raise exception 'Only the person who created this group can archive it.'
      using errcode = '42501';
  end if;

  update groups
     set archived_at = now()
   where id = p_group_id
     and archived_at is null;
end;
$$;

revoke all on function public.archive_group(uuid) from public;
grant execute on function public.archive_group(uuid) to authenticated;


-- ---------- 3. FREEZE AN ARCHIVED GROUP ----------
-- The app hides archived groups, but an invite link lives outside the app and
-- can be opened months later, and a member could still POST to PostgREST
-- directly. A trigger closes every write path at once, without having to
-- re-declare the existing write RPCs and risk changing them by accident.
--
-- group_members covers joining via an old invite link and adding placeholders;
-- expenses and settlements cover new ledger entries and edits.

create or replace function public.reject_write_to_archived_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from groups
    where id = new.group_id and archived_at is not null
  ) then
    raise exception 'This group is archived, so it can no longer be changed.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists group_members_reject_archived on public.group_members;
create trigger group_members_reject_archived
  before insert on public.group_members
  for each row execute function public.reject_write_to_archived_group();

drop trigger if exists expenses_reject_archived on public.expenses;
create trigger expenses_reject_archived
  before insert or update on public.expenses
  for each row execute function public.reject_write_to_archived_group();

drop trigger if exists settlements_reject_archived on public.settlements;
create trigger settlements_reject_archived
  before insert or update on public.settlements
  for each row execute function public.reject_write_to_archived_group();
