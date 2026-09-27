# Friends — Migration Paper Design

**Status:** Paper design for review. No SQL has been written or pushed. This
document exists to be poked at before anything touches the single live-prod
Supabase project. `supabase db push` is a production deployment; nothing here
runs until this design is approved.

**Scope:** Backend only. UI handoff (screens, tokens, prototype) was reviewed
separately and its build is gated on the nav lock + the five review items.

---

## 1. Decisions already locked (carried in)

- **Model:** a friend is a two-person group with a `kind='friend'`
  discriminator. Real users only for v1. Settle-up is UPI-only.
- **Nav:** Groups | Friends | Profile, all labelled. Balances, Activity, and
  the Add FAB are cut. (Recorded in `DECISIONS_AND_BACKLOG.md`.)
- **Read path:** option **(c)** — a dedicated `my_friend_positions()`;
  `my_group_positions()` stays single-purpose.
- **Settlement:** friend settle-up reuses the existing `record_settlement` +
  `confirm_settlement` UPI path unchanged. Confirmed by code investigation
  (see §3).

---

## 2. Why the model is load-bearing, not just convenient

The settlement investigation pins the architecture harder than we assumed:

- `settlements.group_id` is **`NOT NULL`**, FK to `groups(id)`. A settlement
  cannot exist without a group row.
- `settlements.from_member` / `to_member` are **`group_members.id`**, not
  `profiles.id`. Settlements are keyed to membership rows.
- The table is frozen (column-level `UPDATE` grant restricted to
  `status, confirmed_at`) and every RLS policy resolves through `group_id` /
  `group_members`.

Consequence: a friend tab **must** be backed by a real 2-member group. The
container-less pairwise ("Splitwise") alternative would require nullable
`group_id` on a frozen table plus a rewrite of all six settlement policies.
Backing the tab with a real group inherits balances, settlement, RLS, and the
archive trigger for free. This is the cheap path by a wide margin — reaffirmed,
not merely chosen.

---

## 3. The closed dependency: settle-up reuses the UPI path unchanged

Findings from the `database/` investigation, relevant to friends:

- **No cardinality assumption anywhere.** `record_settlement`,
  `confirm_settlement`, `group_balances()`, `my_group_positions()` contain no
  member-count / admin / placeholder check. The payer-records / payee-confirms
  model is inherently pairwise; n=2 is the simplest case, not a special one.
- **A 2-person group is already tested.** GROUP_2 ("Lonavala Trip", Asha +
  Bhavi, no placeholder) asserts net ±2500 — 2-person balance math is covered
  by a passing test.
- **Cash is unreachable between two real accounts.** `record_cash_settlement`'s
  both-have-accounts guard fires, so a real+real friend tab is **UPI-only,
  enforced at the DB**. This is the desired behaviour, for free.
- **`create_group_with_owner` is the only group-shaped obstacle.** It rejects
  any `group_type` outside `('flat','trip','event','other')` and hard-requires
  a UPI ID on the creator. We sidestep it (see §5.2).

**Net:** friend settle-up writes to `settlements` via the existing
`record_settlement`, exactly as a group does. No new settlement function.

### 3.1 Settle-up is payer-only — the button must be direction-aware

`record_settlement`'s rule is "you can only say *I* paid about yourself" (caller
must be `from_member`). So on friend-detail:

| Balance direction | Who can record | Button behaviour |
| --- | --- | --- |
| **You owe them** | you (payer) | active — opens UPI, records `you → them` pending, they confirm |
| **They owe you** | only *they* can | **not** an active pay action — remind / passive; you cannot settle their debt |

An unconditional "Settle up" button (as the mockup drew it) would call
`record_settlement` in the wrong direction and hit `42501`. The button must
mirror however Groups already resolves this — reuse that pattern, do not
reinvent it. **UI item, not a schema item**, but it must be built correctly.

---

## 4. Two discriminator columns — keep them distinct

There is already a `groups.group_type` (`'flat'|'trip'|'event'|'other'`,
validated in `create_group_with_owner`, not by a column CHECK). The new `kind`
column is a **different axis** (is-this-a-1:1-tab vs a group). Do **not**
overload `group_type` with a `'friend'` literal — that would conflate two
orthogonal concepts and force a change to `create_group_with_owner`. A friend
tab carries `kind='friend'` and whatever `group_type` default applies
(`'other'`), never displayed.

---

## 5. Schema changes

Split into two migrations to keep blast radius small on live prod.

### M1 — read path (low-risk, additive read)

**5.1.1 `kind` column on `groups`**

```sql
alter table public.groups
  add column if not exists kind text not null default 'group';
alter table public.groups
  add constraint groups_kind_check check (kind in ('group','friend'));
```

- `NOT NULL DEFAULT 'group'` with a constant default → metadata-only, no table
  rewrite (the fast-default optimisation holds PG11+; this project is on PG17).
  Existing rows read as `'group'`.
- `text + CHECK`, not an enum — easier to evolve.

**5.1.2 `my_group_positions()` — add a filter, keep the shape**

Because we chose (c), this function's **return shape does not change** — we only
add a predicate excluding friend tabs:

```sql
-- inside the existing body, on the groups scan:
--   ... where <existing predicates> and g.kind = 'group'
```

Return shape unchanged ⇒ a clean `CREATE OR REPLACE` (no DROP, no grant loss,
`SECURITY INVOKER` preserved). This keeps friend tabs out of anything driven by
the RPC (balances, and any RPC-sourced list).

**Necessary but not sufficient — companion client filter required.** The Groups
home screen does **not** get its rows from `my_group_positions()`; it reads
`.from('groups')` directly and uses the RPC only for balances
(`groups/page.tsx`, and two group reads in `profile/page.tsx`). So the RPC
filter removes a friend tab's *balance*, not its *row* — the row would still
render on the Groups screen. To actually keep friend tabs off the Groups and
Profile surfaces, add `.eq('kind','group')` to those direct `groups` queries.
That is a frontend change (out of the migration's scope) but part of the **M1
phase**, and it must be in place before M2 lets any friend tab exist. It is a
no-op today (all rows are `kind='group'`), so it carries zero risk landing now.

**5.1.3 `my_friend_positions()` — new (option c)**

`SECURITY INVOKER` so `auth.uid()` resolves to the caller, underlying RLS
applies, and "counterparty from my point of view" is computed correctly.
Balance math is the same aggregate as groups; only the projection differs.

Return contract (must be rich enough to drive add-expense **and** settle-up
without a second round-trip):

| Column | Why |
| --- | --- |
| `group_id` | the backing group |
| `my_member_id` | `group_members.id` for the caller — needed as `from_member` |
| `counterparty_member_id` | `group_members.id` for the friend — needed as `to_member` |
| `counterparty_user_id` | the friend's `profiles.id` |
| `name` | counterparty `display_name` — the client derives the avatar from this (`tintFor(name)` + initials), as it does everywhere else. There is no `avatar` column to select. |
| `upi` | counterparty `upi_id` — UPI deep-link target |
| `net_minor` | signed from caller's POV: `>0` friend owes you, `<0` you owe, `0` settled |
| `last_entry_description`, `last_entry_at` | list row meta line — split into a `text` and a `timestamptz` rather than one concatenated column, so the client doesn't re-parse a date out of text |

**Archived handling: match `my_group_positions()` exactly — which means *no*
archived predicate.** The group function has no `archived_at` filter today and
returns archived groups; `my_friend_positions()` mirrors that. Hiding archived
tabs would be a new behaviour and, if ever wanted, must be applied to *both*
functions together — not introduced on the friend side alone.

Grant `execute` to `authenticated`; `revoke all from public`;
`set search_path = public`.

### M2 — write surface (`friendships` + creation RPC)

**5.2.1 `friendships` table**

Exists purely to enforce one-tab-per-pair at the DB level (app-level dedup
races on live prod — same reasoning as the settlement guards).

| Column | Notes |
| --- | --- |
| `user_lo uuid` | FK → profiles, ON DELETE CASCADE |
| `user_hi uuid` | FK → profiles, ON DELETE CASCADE |
| `group_id uuid` | FK → groups, ON DELETE CASCADE; `UNIQUE` |
| `created_at timestamptz` | default `now()` |

Constraints:
- `CHECK (user_lo < user_hi)` — canonicalises the pair (uuid supports `<`), so
  (A,B) and (B,A) collapse to one row and self-pairs are impossible.
- `UNIQUE (user_lo, user_hi)` — the one-tab-per-pair guarantee.

RLS select: `user_lo = auth.uid() OR user_hi = auth.uid()`.

**5.2.2 `create_friend_tab(p_other uuid) returns uuid`**

`SECURITY DEFINER`, `set search_path = public`, `revoke all from public`,
`grant execute to authenticated`. Inserts the group **directly** — it does not
call `create_group_with_owner`, which sidesteps that function's `group_type`
validation and lets us set `kind='friend'`.

Body, in order:
1. **Authorise / validate:** reject `p_other = auth.uid()` (no self-friend);
   confirm `p_other` exists in `profiles`. The caller is inherently a party
   (they're creating their own tab).
2. **Canonicalise:** `lo := least(auth.uid(), p_other)`,
   `hi := greatest(...)`.
3. **Idempotency (fast path):** if a `friendships` row exists for `(lo,hi)`,
   return its `group_id`.
4. **Create:** insert `groups` row (`kind='friend'`, `group_type='other'`,
   `name := 'friend:' || left(lo::text,8) || ':' || left(hi::text,8)`,
   `created_by := auth.uid()`); insert two `group_members` rows — creator
   `admin`, other `member` (inert, mirrors normal creation); insert the
   `friendships` row.
5. **Race recovery:** wrap the friendship insert to catch the `UNIQUE`
   violation → on conflict, return the existing `group_id`. This is what makes
   concurrent create safe without app-level locking.

**5.2.3 Two-member cap trigger (decided: include)**

A `BEFORE INSERT` trigger on `group_members` rejecting a third member when
`groups.kind='friend'`. Belt-and-suspenders, consistent with the
enforce-at-DB philosophy. There is no UI to over-add in v1, so this is cheap
insurance, not a fix for a live hole.

---

## 6. What we explicitly do NOT change

The value of the model is how much stays untouched:

- `record_settlement`, `confirm_settlement`, `record_cash_settlement` — no
  change. Friend settle-up reuses the UPI two-step as-is.
- `settlements` table, all six RLS policies, the archive trigger — no change.
- `create_group_with_owner` — no change (bypassed by `create_friend_tab`).
- `my_group_positions()` — predicate added, **shape unchanged**.
- `group_balances()` — no change; correct at n=2.

---

## 7. Resolved decisions (of record)

All five resolved — recommendations accepted.

1. **UPI-ID gate at friend-tab creation → not gated.** Creation does not require
   a UPI ID. The missing-UPI state is surfaced at settle-time, where it's
   actionable (settle-up can't deep-link without the payee's UPI ID anyway).
2. **Two-member cap trigger → included.** See §5.2.3.
3. **`groups.name` sentinel → deterministic.**
   `friend:<lo8>:<hi8>`, never displayed. See §5.2.2 step 4.
4. **Member roles → creator `admin`, other `member`.** Inert (cash is
   unreachable, so the admin branch never matters); mirrors normal creation.
5. **Provenance line on friend-detail → not built.** All UPI rows have
   `recorded_by IS NULL`; friends never have cash rows, so it would always be
   blank.

---

## 8. Prod-safety notes

- Single live-prod project, no staging. Each migration is a production deploy.
- M1 column add is metadata-only (constant default, PG15). M1 function change
  is `CREATE OR REPLACE` (shape unchanged) → no DROP, no grant loss.
- M2 is the write surface; land it after M1 is verified in prod.
- Every new/changed function: `set search_path = public`,
  `revoke all from public`, explicit `grant execute to authenticated`, correct
  `SECURITY` mode (INVOKER for reads, DEFINER for `create_friend_tab`).

---

## 9. Tests to add before merge

- `my_group_positions()` **excludes** `kind='friend'` rows (regression guard —
  the whole point of the filter).
- `my_friend_positions()` returns correct signed `net_minor` at n=2, both
  directions and settled, with correct counterparty resolution from each side's
  POV.
- `create_friend_tab` is idempotent (second call returns the same `group_id`)
  and race-safe (concurrent calls converge to one tab).
- Friend settle-up via `record_settlement` + `confirm_settlement` end-to-end on
  a `kind='friend'` group (proves the reuse claim).
- Cash is refused on a real+real friend tab (proves UPI-only is enforced, not
  just UI-hidden).
- If the cap trigger is included: a third member insert on a friend group is
  rejected.
