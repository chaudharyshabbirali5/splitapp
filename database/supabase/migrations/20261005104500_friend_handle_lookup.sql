-- ============================================================================
-- Friends, M5: find a SplitApp user by their UPI handle (Path A lookup).
--
-- This makes the already-built "UPI ID" field on the Add-a-friend screen real.
-- The tab-creation half already exists: create_friend_tab(p_other uuid) from M2
-- is idempotent, so the client's job is lookup -> confirm -> create.
--
-- ONE new function. No table change, no RLS policy modified, no trigger, no
-- existing function altered. splitapp.sql and every earlier migration are
-- untouched.
--
-- THE FEATURE IS SMALL; THE GUARDRAILS ARE THE WORK.
-- A "find a user by identifier" function is, by default, also a "tell me who is
-- on SplitApp" function. In a UPI-first app a careless version is a name-and-UPI
-- harvester, which is raw material for UPI phishing. Three things keep this from
-- being that:
--
--   1. EXACT MATCH ONLY. No like, no %, no prefix, no substring, no
--      search-as-you-type, no results list. You can confirm a handle you already
--      know; you cannot fish for strangers.
--   2. THE RETURN SHAPE IS THE SECURITY BOUNDARY. Two columns, user_id and
--      display_name. Never upi_id, never email, never phone. A function that
--      returns more than this passes every behavioural test and still leaks --
--      so the column list is the thing to review, not just the WHERE clause.
--   3. EVERY NEGATIVE OUTCOME LOOKS IDENTICAL. Not found, ambiguous, blank input
--      and self-only all return zero rows. A caller cannot distinguish "nobody
--      has that handle" from "two people do", which would otherwise be an oracle
--      for probing the table.
-- ============================================================================


-- ---------- 1. THE LOOKUP ----------
-- SECURITY DEFINER, and this is required rather than convenient. profiles is
-- RLS-protected by profiles_select_own:
--
--   USING (id = auth.uid())
--
-- so an `authenticated` caller can read exactly one row: their own. A lookup by
-- somebody else's handle returns zero rows under RLS no matter how it is
-- written. DEFINER is the only way the comparison can see across the table.
--
-- Because DEFINER means RLS is NOT a backstop inside this function, every guard
-- in the body IS the security boundary -- the same posture as
-- create_friend_tab, record_cash_settlement and join_group_via_code.
--
-- STABLE, not VOLATILE: it writes nothing. Reads only.
--
-- NORMALIZATION IS APPLIED TO BOTH SIDES, deliberately.
-- profiles.upi_id is plain `text` -- citext is NOT installed in this project --
-- with no CHECK, no unique index, and NO trigger on the table. The only
-- normalization today happens in application code (the profile form trims, but
-- does not lowercase), so a value written through PostgREST directly could carry
-- mixed case or surrounding whitespace. Current rows happen to be clean, which
-- means comparing against the stored form would work today and silently fail the
-- first time somebody saves "Foo@OKAXIS". lower(btrim(...)) on both sides is
-- what makes that a non-event. UPI IDs are case-insensitive in practice.
--
-- A consequence worth naming: because the comparison wraps the column in
-- lower(btrim(...)), no index on upi_id can serve it. That is fine at this scale
-- and for this access pattern (one row, one exact handle, typed by hand). If it
-- ever matters, the fix is a functional index on lower(btrim(upi_id)) -- not
-- loosening the comparison.
create or replace function public.find_friend_by_handle(p_handle text)
returns table (user_id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_needle text;
begin
  -- Blank input is a non-question, not an error: the screen calls this as the
  -- user types or taps, and an empty field should produce an empty result rather
  -- than a red message.
  v_needle := lower(btrim(coalesce(p_handle, '')));
  if v_needle = '' then
    return;
  end if;

  -- AMBIGUITY IS RESOLVED INSIDE ONE QUERY, ON ONE SNAPSHOT.
  -- upi_id has no unique constraint, and prod currently holds two accounts
  -- sharing one real handle, so this is a live path and not a hypothetical. A
  -- `limit 1` would hand back an arbitrary one of them -- the wrong person to
  -- start a money tab with.
  --
  -- The count is a WINDOW over the match set rather than a separate SELECT:
  -- count(*) over () labels every matching row with how many matches there are,
  -- and the outer filter keeps the row only when that number is 1. Two separate
  -- statements would each see their own snapshot, and a concurrent commit landing
  -- between them could let a count of 1 be followed by a fetch of 2 -- returning
  -- a guessed row, which is the one thing this must never do. One query cannot
  -- straddle that gap.
  --
  -- Behaviour per case: 0 matches -> no rows; 2 matches -> both carry n = 2 and
  -- are filtered out; exactly 1 -> returned.
  --
  -- Self-exclusion is part of the same set: you cannot start a tab with
  -- yourself, create_friend_tab would reject it anyway, and leaving yourself in
  -- the set could turn a legitimate single match into a false "ambiguous" when
  -- you share a handle with one other person.
  --
  -- matches.display_name is qualified deliberately: unqualified, it would
  -- resolve to the OUT parameter of the same name rather than to the column.
  return query
  with matches as (
    select p.id, p.display_name, count(*) over () as n
    from profiles p
    where p.upi_id is not null
      and lower(btrim(p.upi_id)) = v_needle
      and p.id <> auth.uid()
  )
  select matches.id, matches.display_name
  from matches
  where matches.n = 1;
end;
$$;

comment on function public.find_friend_by_handle(text) is
  'Exact-match lookup of a SplitApp user by UPI handle, for the Add-a-friend screen. Returns user_id and display_name only. Zero rows for not-found, ambiguous, blank or self -- all indistinguishable by design.';


-- ---------- 2. GRANTS ----------
-- House rule: drop the implicit PUBLIC execute, grant only to authenticated.
-- An anonymous caller has a null auth.uid(), so self-exclusion would not filter
-- anything for them -- the grant, not the body, is what keeps them out.
revoke all on function public.find_friend_by_handle(text) from public;
grant execute on function public.find_friend_by_handle(text) to authenticated;
