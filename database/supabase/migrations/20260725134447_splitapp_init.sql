-- ============================================================
-- SplitApp v1 — schema, RLS policies, and balance function
-- Target: Supabase (Postgres 15+). Run top to bottom in the SQL editor.
-- ============================================================

-- ---------- 1. TABLES ----------
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  phone        text,
  upi_id       text,
  created_at   timestamptz not null default now()
);

create table if not exists groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  group_type text not null default 'other',          -- 'flat'|'trip'|'event'|'other'
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists group_members (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references groups(id) on delete cascade,
  user_id      uuid references profiles(id),          -- NULL = placeholder (not signed up yet)
  display_name text not null,
  upi_id       text,
  role         text not null default 'member',
  joined_at    timestamptz not null default now()
);

create table if not exists expenses (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references groups(id) on delete cascade,
  paid_by      uuid not null references group_members(id),
  amount_minor bigint not null check (amount_minor > 0),   -- paise, integer, never floats
  currency     text not null default 'INR',
  description  text,
  category     text,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  is_deleted   boolean not null default false
);

create table if not exists expense_splits (
  id          uuid primary key default gen_random_uuid(),
  expense_id  uuid not null references expenses(id) on delete cascade,
  member_id   uuid not null references group_members(id),   -- member, so placeholders can owe
  share_minor bigint not null check (share_minor >= 0),
  share_type  text not null default 'equal'                 -- 'equal'|'exact'|'percentage'
);

create table if not exists settlements (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references groups(id) on delete cascade,
  from_member  uuid not null references group_members(id),
  to_member    uuid not null references group_members(id),
  amount_minor bigint not null check (amount_minor > 0),
  currency     text not null default 'INR',
  upi_ref      text,
  status       text not null default 'pending',             -- 'pending' | 'confirmed'
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz
);

-- indexes for the lookups the app does constantly
create index if not exists idx_members_group  on group_members(group_id);
create index if not exists idx_members_user   on group_members(user_id);
create index if not exists idx_expenses_group on expenses(group_id);
create index if not exists idx_splits_expense on expense_splits(expense_id);
create index if not exists idx_splits_member  on expense_splits(member_id);
create index if not exists idx_settle_group   on settlements(group_id);


-- ---------- 2. HELPER FUNCTIONS (SECURITY DEFINER) ----------
-- These run as the function OWNER and bypass RLS on the tables they read.
-- That is what breaks the infinite-recursion trap: the group_members policy
-- needs to check group_members, which would otherwise re-trigger itself
-- forever. Reading it through a SECURITY DEFINER function sidesteps that.

create or replace function public.is_group_member(gid uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from group_members where group_id = gid and user_id = auth.uid()
  );
$$;

create or replace function public.is_group_creator(gid uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from groups where id = gid and created_by = auth.uid()
  );
$$;

create or replace function public.is_expense_member(eid uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from expenses e
    join group_members gm on gm.group_id = e.group_id
    where e.id = eid and gm.user_id = auth.uid()
  );
$$;


-- ---------- 3. ENABLE RLS (deny-all until a policy allows) ----------
alter table profiles       enable row level security;
alter table groups         enable row level security;
alter table group_members  enable row level security;
alter table expenses       enable row level security;
alter table expense_splits enable row level security;
alter table settlements    enable row level security;


-- ---------- 4. GRANTS (Supabase's authenticated role) ----------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;


-- ---------- 5. POLICIES ----------

-- profiles: you only ever touch your own row
create policy profiles_select_own on profiles
  for select using (id = auth.uid());
create policy profiles_insert_own on profiles
  for insert with check (id = auth.uid());
create policy profiles_update_own on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- groups (the OR created_by covers the moment you create a group but haven't
-- inserted your own membership row yet)
create policy groups_select on groups
  for select using (is_group_member(id) or created_by = auth.uid());
create policy groups_insert on groups
  for insert with check (created_by = auth.uid());
create policy groups_update on groups
  for update using (is_group_creator(id)) with check (is_group_creator(id));
create policy groups_delete on groups
  for delete using (is_group_creator(id));

-- group_members (creator OR existing member can add people -> handles the
-- chicken-and-egg of adding yourself right after creating the group)
create policy members_select on group_members
  for select using (is_group_member(group_id) or is_group_creator(group_id));
create policy members_insert on group_members
  for insert with check (is_group_member(group_id) or is_group_creator(group_id));
create policy members_update on group_members
  for update using (is_group_member(group_id)) with check (is_group_member(group_id));
create policy members_delete on group_members
  for delete using (is_group_creator(group_id));

-- expenses
create policy expenses_select on expenses
  for select using (is_group_member(group_id));
create policy expenses_insert on expenses
  for insert with check (is_group_member(group_id) and created_by = auth.uid());
create policy expenses_update on expenses
  for update using (is_group_member(group_id)) with check (is_group_member(group_id));

-- expense_splits (scoped through the parent expense's group)
create policy splits_select on expense_splits
  for select using (is_expense_member(expense_id));
create policy splits_insert on expense_splits
  for insert with check (is_expense_member(expense_id));
create policy splits_update on expense_splits
  for update using (is_expense_member(expense_id)) with check (is_expense_member(expense_id));
create policy splits_delete on expense_splits
  for delete using (is_expense_member(expense_id));

-- settlements
create policy settle_select on settlements
  for select using (is_group_member(group_id));
create policy settle_insert on settlements
  for insert with check (is_group_member(group_id));
create policy settle_update on settlements
  for update using (is_group_member(group_id)) with check (is_group_member(group_id));


-- ---------- 6. BALANCE FUNCTION (SECURITY INVOKER — the opposite on purpose) ----------
-- This one is SECURITY INVOKER (the default) so RLS STILL applies to the caller.
-- A non-member who calls it sees no group_members rows -> gets an empty result.
--
--   net_minor > 0  => the group owes this member  (creditor)
--   net_minor < 0  => this member owes the group  (debtor)
--
-- Each of the four components is its OWN subquery, so the one-to-many joins
-- never multiply each other (the classic double-counting bug).

create or replace function public.group_balances(gid uuid)
returns table (member_id uuid, display_name text, net_minor bigint)
language sql stable security invoker set search_path = public as $$
  select
    gm.id,
    gm.display_name,
    (
        coalesce((select sum(e.amount_minor) from expenses e
                  where e.group_id = gid and e.paid_by = gm.id and e.is_deleted = false), 0)
      - coalesce((select sum(s.share_minor) from expense_splits s
                  join expenses e on e.id = s.expense_id
                  where e.group_id = gid and s.member_id = gm.id and e.is_deleted = false), 0)
      + coalesce((select sum(st.amount_minor) from settlements st
                  where st.group_id = gid and st.from_member = gm.id and st.status = 'confirmed'), 0)
      - coalesce((select sum(st.amount_minor) from settlements st
                  where st.group_id = gid and st.to_member = gm.id and st.status = 'confirmed'), 0)
    )::bigint
  from group_members gm
  where gm.group_id = gid;
$$;
