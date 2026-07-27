# Technical Requirements Document (TRD)
### Working title: **SplitApp** · **Audience:** an AI coding assistant building the app
**Companion to:** PRD.md (read that first for scope). This doc defines **how**.

---

## 0. How to use this document + build order
Follow the **build order in Section 12**. Build the **backend first**: the database schema, security policies, and balance function in Section 6 are already written and **have been validated against a live PostgreSQL 16** (a member can read their group, a non-member is fully blocked, balances sum to zero). Treat that SQL as correct and final — **do not "improve," refactor, or regenerate it.** Paste it into Supabase as-is.

Anything in **Section 11 (Anti-architecture)** must not be built. If you think you need something there, stop and ask.

---

## 1. Tech stack (exact — do not substitute without asking)
- **Frontend:** Next.js (App Router, React) built as a **PWA** (installable web app; no app store).
- **Backend / DB / Auth:** **Supabase** (hosted PostgreSQL + Auth + auto-generated APIs). **There is no separate backend server.**
- **Hosting:** **Vercel** (frontend), free tier. Supabase hosts the database, free tier.
- **Language:** TypeScript.
- **Everything must run on free tiers.** No paid services in v1.

Rationale: this stack means we write screens + a little logic and lean on Supabase for the hard parts (auth, database, row-level security). It is also the stack AI tools generate most reliably.

## 2. Architecture (one picture in words)
Client PWA (Next.js) talks **directly** to Supabase using the Supabase client library. Supabase Postgres holds all data. **Security is enforced in the database via Row-Level Security (RLS), not in a middle-tier server** — because the client talks straight to the DB, the RLS policies ARE the security. There is no API gateway, no auth microservice, no message broker. Auth is Supabase email magic-link.

## 3. CRITICAL INVARIANTS (binding — never violate)
These are the things AI tools get subtly wrong. They are non-negotiable.

1. **Money is integer paise.** All amounts are `bigint` in the smallest unit (paise). **Never use floats/decimals for money.** 1 rupee = 100 paise. `amount_minor = 10000` means Rs.100.00.
2. **Primary keys are UUIDs**, generated with `gen_random_uuid()`.
3. **RLS is ON for every table**, with policies as written in Section 6. Never disable RLS. Never expose a table without a policy.
4. **Two function security modes, on purpose (do not unify them):**
   - Membership-check helpers are `SECURITY DEFINER` — this is what prevents infinite-recursion in the RLS policies. **If you make them `SECURITY INVOKER`, the policies will crash with infinite recursion.**
   - The balance function is `SECURITY INVOKER` — so RLS still applies and non-members get nothing. **If you make it `SECURITY DEFINER`, it will leak other groups' data.**
5. **Balances are computed live**, never stored in a table and never edited directly. Use the `group_balances()` function.
6. **Split shares MUST sum to exactly the expense amount.** Enforce this in app code when saving (see Section 7 rounding rule). If violated, balances drift.
7. **Balances of all members in a group MUST sum to 0.** This is your correctness canary — test it.
8. **Splits and settlements reference `group_members.id` (member_id), NOT `user_id`.** This is what lets placeholder members (people without accounts) owe and be owed money.
9. **Expenses use soft delete** (`is_deleted = true`), not hard delete. Keep history.
10. **The app never touches money.** Settlement is a UPI deep link only (Section 8). No payment gateway, no PA license, no holding funds.

## 4. Data model (concept)
- `profiles` — one per signed-up user (extends Supabase `auth.users`).
- `groups` — a flat/trip/event/other. Has a `group_type`.
- `group_members` — people in a group. `user_id` is **nullable**: NULL = placeholder (not signed up). Always has a `display_name` and optional `upi_id`.
- `expenses` — one row per shared cost. `paid_by` references a member. Amount in paise.
- `expense_splits` — how one expense is divided; one row per member's share; references member_id.
- `settlements` — a repayment from one member to another; `status` = pending|confirmed.

## 5. Auth requirements
- Supabase Auth, **email magic-link only** for v1. **No phone/SMS OTP** (SMS costs money).
- On first sign-in, create a `profiles` row for the user (via a DB trigger on `auth.users`, or on first app load if missing).
- A user's `profiles.id` **equals** their `auth.users.id`.

## 6. Database schema + RLS + balance function (VALIDATED — paste as-is)
This is the complete backend. It has been run and tested on PostgreSQL 16. See the file `splitapp.sql` (identical to below).

```sql
-- ---------- TABLES ----------
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

create index if not exists idx_members_group  on group_members(group_id);
create index if not exists idx_members_user   on group_members(user_id);
create index if not exists idx_expenses_group on expenses(group_id);
create index if not exists idx_splits_expense on expense_splits(expense_id);
create index if not exists idx_splits_member  on expense_splits(member_id);
create index if not exists idx_settle_group   on settlements(group_id);

-- ---------- HELPER FUNCTIONS (SECURITY DEFINER — breaks RLS recursion) ----------
create or replace function public.is_group_member(gid uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from group_members where group_id = gid and user_id = auth.uid());
$$;

create or replace function public.is_group_creator(gid uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from groups where id = gid and created_by = auth.uid());
$$;

create or replace function public.is_expense_member(eid uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from expenses e
    join group_members gm on gm.group_id = e.group_id
    where e.id = eid and gm.user_id = auth.uid()
  );
$$;

-- ---------- ENABLE RLS ----------
alter table profiles       enable row level security;
alter table groups         enable row level security;
alter table group_members  enable row level security;
alter table expenses       enable row level security;
alter table expense_splits enable row level security;
alter table settlements    enable row level security;

-- ---------- GRANTS ----------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- ---------- POLICIES ----------
create policy profiles_select_own on profiles for select using (id = auth.uid());
create policy profiles_insert_own on profiles for insert with check (id = auth.uid());
create policy profiles_update_own on profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy groups_select on groups for select using (is_group_member(id) or created_by = auth.uid());
create policy groups_insert on groups for insert with check (created_by = auth.uid());
create policy groups_update on groups for update using (is_group_creator(id)) with check (is_group_creator(id));
create policy groups_delete on groups for delete using (is_group_creator(id));

create policy members_select on group_members for select using (is_group_member(group_id) or is_group_creator(group_id));
create policy members_insert on group_members for insert with check (is_group_member(group_id) or is_group_creator(group_id));
create policy members_update on group_members for update using (is_group_member(group_id)) with check (is_group_member(group_id));
create policy members_delete on group_members for delete using (is_group_creator(group_id));

create policy expenses_select on expenses for select using (is_group_member(group_id));
create policy expenses_insert on expenses for insert with check (is_group_member(group_id) and created_by = auth.uid());
create policy expenses_update on expenses for update using (is_group_member(group_id)) with check (is_group_member(group_id));

create policy splits_select on expense_splits for select using (is_expense_member(expense_id));
create policy splits_insert on expense_splits for insert with check (is_expense_member(expense_id));
create policy splits_update on expense_splits for update using (is_expense_member(expense_id)) with check (is_expense_member(expense_id));
create policy splits_delete on expense_splits for delete using (is_expense_member(expense_id));

create policy settle_select on settlements for select using (is_group_member(group_id));
create policy settle_insert on settlements for insert with check (is_group_member(group_id));
create policy settle_update on settlements for update using (is_group_member(group_id)) with check (is_group_member(group_id));

-- ---------- BALANCE FUNCTION (SECURITY INVOKER — RLS applies) ----------
-- net_minor > 0  => group owes this member (creditor)
-- net_minor < 0  => this member owes the group (debtor)
-- Each component is its OWN subquery so the one-to-many joins never double-count.
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
```

## 7. Equal-split rounding rule (app code — MUST be exact)
When splitting `amount_minor` equally among `n` members, integer division loses paise (e.g. 10000 / 3). Distribute the remainder so shares sum EXACTLY to the amount:
```
base = floor(amount_minor / n)
rem  = amount_minor - base * n        // 0 <= rem < n
// every member gets `base`; the first `rem` members (deterministic order) get one extra paisa
shares = members.map((m, i) => base + (i < rem ? 1 : 0))
// sum(shares) === amount_minor  (guaranteed)
```
Always assert `sum(shares) === amount_minor` before saving. This is what keeps Invariant #6 and #7 true.

## 8. UPI settle-up spec (the differentiator — get this right)
- Build a UPI deep link and open it; the OS shows the user's installed UPI apps.
- **Format:** `upi://pay?pa={payeeVPA}&pn={payeeName}&am={amountRupees}&cu=INR&tn={note}`
  - `pa` = payee UPI ID (from the member's `upi_id`).
  - `pn` = payee display name (URL-encoded).
  - `am` = amount in **rupees as a 2-decimal string**, converted from paise: `(amount_minor / 100).toFixed(2)` -> e.g. `10000` becomes `"100.00"`.
  - `tn` = short note, URL-encoded (e.g. "Goa Trip settle").
- On Android web, navigating to the `upi://` URL opens the UPI app chooser. If no UPI app is installed it will fail gracefully — that is acceptable for v1.
- **There is NO reliable automatic success callback for P2P UPI.** Do not try to auto-detect payment. Flow: debtor taps Settle -> UPI link opens -> debtor pays in their bank app -> returns -> taps **"I paid"** (creates a `settlements` row, status `pending`) -> creditor taps **"Confirm received"** (status -> `confirmed`, sets `confirmed_at`). Only `confirmed` settlements affect balances (already handled in `group_balances`).

## 9. "Who pays whom" (app code, runs on balance rows)
The database returns net balances; the app turns them into a minimal payment list (greedy: biggest debtor pays biggest creditor).
```js
// balances = rows from group_balances(): [{ member_id, display_name, upi_id, net_minor }]
function whoPaysWhom(balances) {
  const creditors = balances.filter(b => b.net_minor > 0).map(b => ({ ...b }));
  const debtors   = balances.filter(b => b.net_minor < 0).map(b => ({ ...b, net_minor: -b.net_minor }));
  creditors.sort((a, b) => b.net_minor - a.net_minor);
  debtors.sort((a, b) => b.net_minor - a.net_minor);
  const payments = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].net_minor, creditors[j].net_minor);
    payments.push({ from: debtors[i], to: creditors[j], amount_minor: pay });
    debtors[i].net_minor -= pay;
    creditors[j].net_minor -= pay;
    if (debtors[i].net_minor === 0) i++;
    if (creditors[j].net_minor === 0) j++;
  }
  return payments; // feed from.upi_id, to.upi_id, amount_minor into the UPI link
}
```

## 10. Frontend requirements
- **PWA:** include a web app manifest (name, icons, `display: standalone`) and a minimal service worker so it is installable to the home screen. Optimize for **Android + mobile web first**.
- **Screens (v1, minimal):** (1) Login (email magic link) · (2) Groups list · (3) Create/edit group + members · (4) Group detail = expenses list + balances + "who pays whom" · (5) Add expense (amount, payer, equal split across selected members) · (6) Settle-up sheet (UPI link + mark paid / confirm).
- **Expense entry should tolerate offline**: let the user type an expense; sync when back online (basic — do not build a complex offline engine).
- Keep formatting of money: store/compute in paise, **display** as `Rs. (amount_minor/100).toFixed(2)`.

## 11. ANTI-ARCHITECTURE (do NOT build any of this in v1)
- No custom backend server (Node/Express/etc.) — Supabase is the backend.
- No **chat/messaging** system, no WebSockets, no Matrix, no message tables.
- No **Kafka / Redis / RabbitMQ / event bus**.
- No **microservices** — no service split of any kind.
- No **sharding, Citus, read replicas, CQRS, materialized balance tables**. A single Supabase Postgres is correct for v1 and for a long time after.
- No **wide-column store** (Cassandra/Scylla/DynamoDB).
- No **payment gateway / aggregator / wallet / escrow**. Settlement is a UPI deep link only.
- No **native mobile apps**.
- No **multi-currency, OCR, push notifications, analytics pipelines**.

## 12. Build order (do backend first)
1. **Backend:** create a Supabase project. Run `splitapp.sql` (Section 6) top-to-bottom in the SQL editor. Run the acceptance test in Section 13 and confirm it passes. **Do not proceed until it passes.**
2. **Deploy skeleton:** create the Next.js app, deploy an empty page to Vercel **on day one** (so deployment is never a surprise).
3. **Auth:** wire Supabase email magic-link login; auto-create `profiles` row.
4. **Groups + members:** create/join group, add real and placeholder members.
5. **Expenses + splits:** add-expense form with the equal-split rounding rule (Section 7); write expense + its splits together.
6. **Balances:** call `group_balances()`, render nets + `whoPaysWhom()`.
7. **Settle-up:** UPI deep link + mark-paid/confirm flow (Section 8).
8. **PWA polish:** manifest + service worker so it installs to the home screen.
9. Test on real phones with a real group; do one real Rs.1 UPI settle-up early (during step 7, not at the end).

## 13. Acceptance test (run after Section 6 loads)
Seed one group: Asha paid Rs.300 split 3 ways (Asha, Bhavi, Chin-placeholder); Bhavi paid Rs.90 split 3 ways; Bhavi settled Rs.70 to Asha (confirmed). Expected `group_balances()`:
- Asha `net_minor = +10000` (Rs.100 owed to her)
- Bhavi `net_minor = +3000` (Rs.30 owed to her)
- Chin `net_minor = -13000` (owes Rs.130)
- **Sum of all three = 0** (must hold).
Also verify: a logged-in member sees exactly their group's rows; a non-member sees **0** rows in every table and **0** rows from `group_balances()`, and cannot insert into the group.

## 14. Deferred to v1.1+ (note, don't build now)
- `claim_placeholder(member_id)` as a `SECURITY DEFINER` RPC — links a signing-up user to an existing placeholder member (needed because at claim time they are not yet a member, so a normal update is blocked).
- A `save_expense_with_splits()` server-side function that re-checks Invariant #6 in the database.
- `recurring_templates` table + a scheduled job that stamps out a normal expense each cycle (recurring expenses). Because a generated recurring expense is just an ordinary expense, nothing else changes.
