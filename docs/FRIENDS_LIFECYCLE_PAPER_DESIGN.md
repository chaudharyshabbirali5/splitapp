# Friends — Tab Lifecycle Paper Design (hide / archive + placeholder delete)

**Status:** Paper design for review. No SQL written or pushed. `supabase db push`
is a production deployment against the single live-prod Supabase project; nothing
here runs until this design is approved on paper.

**Call it M4.** Independent of Path A (the lookup RPC) — neither depends on the
other, either can land first. Depends only on M1–M3, which are in prod.

**One-line scope:** let a person get a *settled* friend tab out of their Friends
list, reversibly, without affecting the other party — plus a true delete for the
private placeholder tabs where that's safe.

---

## 1. Decisions locked this session (carried in)

- **Net-zero gate on hide.** Hide is allowed **only when the caller's net on that
  tab is exactly zero.** Enforced in the function body, not just the UI — a tab you
  still owe ₹X on cannot be hidden. This is the core safety property: you can never
  bury a live debt out of your active list.
- **Per-person.** Hiding is one-sided. It removes the tab from *my* Friends list
  only; the other real user's list is untouched. This is what forces a new
  per-member flag rather than reusing the existing whole-tab group archive.
- **Sticky.** Hide is a durable "archived" state, not a one-time dismiss. A hidden
  tab stays hidden *every* time it returns to zero. It surfaces back into the list
  on its own the moment there's money to deal with again (a new expense pushes the
  balance off zero), and tucks itself away again once re-settled — with no repeated
  dismiss action. The flag only clears when the user explicitly un-archives.
- **Delete is placeholder-only.** A real+real tab is a shared ledger; one party
  destroying it would wipe the other party's financial history. So real tabs can
  only ever be hidden (hide-from-my-view), **never deleted, at any balance.**
  Placeholder tabs are private and one-sided, so a true delete is safe there and
  nowhere else.
- **Placeholder delete is NOT net-zero-gated.** It's allowed at *any* balance,
  behind a blunt UI confirm. A placeholder is your own private ledger; gating its
  deletion on net-zero would force you to mark money received that you never got —
  i.e. falsify the ledger just to delete it. The net-zero gate stays firm for hide
  and for everything touching a shared tab; this is the single, deliberate exception
  and it applies only to the private one-sided case.
- **Archived-friends view ships in v1.** Sticky hide needs an un-archive surface,
  and you must be able to re-open a settled placeholder to add a fresh expense.
  Mirrors the existing Profile → group archive zone.

## 2. The resulting rule, stated once

A friend tab is **shown in my list** unless **( I have archived it ) AND ( my net
on it is 0 )**.

Everything else falls out of that one predicate:

- Archive a settled tab → `hidden_at` set, net 0 → hidden.
- Friend adds an expense later → net ≠ 0 → shown again automatically, no action.
- We re-settle → net back to 0, `hidden_at` still set (sticky) → hidden again.
- I want it back for good → explicit un-archive clears `hidden_at` → shown even at 0.

No separate "re-hide after it came back" step exists, because the flag was never
cleared. That is the entire benefit of *sticky*.

---

## 3. Schema change — one nullable column

```sql
alter table public.group_members
  add column if not exists hidden_at timestamptz;
```

- Nullable, no default → **metadata-only**, no table rewrite, safe on live prod.
- `group_members` already has exactly one row per (person, tab) — enforced by
  `uq_members_group_user` — so this column *is* the per-person flag with no new
  table. `NULL` = visible, a timestamp = archived-by-this-person-at-that-time.
- It lives on *every* membership row, group rows included, but **only the friend
  read path consults it in v1.** It could later power per-member group hiding; we
  build nothing for that now.

**Prod-safety check before push (read-only, for Claude Code):** confirm there is no
`select('*')` on `group_members` anywhere in `frontend/` — every read must use an
explicit column list, or a new column could shift a positional read. M1 verified
this for `groups`; it must be re-verified for `group_members` because this is a
different table. If any `select('*')` exists, it's fixed first.

---

## 4. Read path — the filter, and the archive view

### 4.1 `my_friend_positions()` — add the exclusion, keep the shape

The list function gains one predicate: drop a tab when the caller's own member row
is archived **and** the caller's `net_minor` on it is 0.

- Because `net_minor` is already computed inside this function, the exclusion is a
  post-balance predicate (HAVING-style) on the existing aggregate — **reuse the net
  that's already there, do not compute a second one.**
- The archived flag read is the caller's own row (`hidden_at` on `my_member_id`),
  which the function already resolves. `SECURITY INVOKER` is preserved.
- **Return shape is unchanged** → clean `CREATE OR REPLACE`, no DROP, no grant loss
  — same discipline as the M1 change to `my_group_positions()`. Confirm in the diff
  that the column list is byte-identical.

### 4.2 `my_archived_friend_positions()` — new, dedicated (single-purpose)

Sticky hide needs somewhere to un-archive *from*: a tab hidden at zero is otherwise
invisible with no way back until activity happens to it, and you could never
re-open a settled placeholder tab to add a fresh expense. So there is an
**Archived friends** view, and it reads from a dedicated function — matching the
locked single-purpose-function principle rather than overloading the list RPC with
an `include_hidden` parameter (which would also force a signature change and lose
the shape-preserving guarantee above).

It returns the mirror set: tabs where the caller's row is archived **and** net is 0
(exactly the ones 4.1 now hides). Same columns as `my_friend_positions()` so the
client renders rows identically. `SECURITY INVOKER`, same grants/`search_path`.

This mirrors the existing **Profile → archive zone** for groups. UI is a thin list
with an un-archive action per row; no new visual language.

---

## 5. Write surface — three RPCs

All three: `SECURITY DEFINER`, `set search_path = public`, `revoke all from public`,
`grant execute to authenticated` — identical envelope to `create_friend_tab`.
DEFINER because each writes/deletes rows the caller has no direct DML grant on;
the authorization is enforced **in the body**, which is the locked pattern.

### 5.1 `hide_friend_tab(p_group_id uuid)`

1. Resolve the caller's own `group_members` row in `p_group_id`. If none → the
   caller isn't a member → raise (authorization in-body).
2. Confirm the group is `kind='friend'` (don't let this touch real groups).
3. **Net-zero gate:** compute the caller's net on this tab using the *same* balance
   logic as `my_friend_positions()` / `group_balances()`. If `net <> 0` → raise a
   clean, catchable error the UI turns into "Settle up first — you're not at zero."
4. Set `hidden_at = now()` on the caller's row. Idempotent (hiding an already-hidden
   tab is a no-op, not an error).

### 5.2 `unhide_friend_tab(p_group_id uuid)`

Same membership + kind check. Clears `hidden_at = null` on the caller's row. **No
net-zero gate** — un-archiving is always safe. Idempotent.

### 5.3 `delete_placeholder_friend_tab(p_group_id uuid)`

The only destructive one, and the most guarded:

1. Caller must be a member of `p_group_id`, which must be `kind='friend'`.
2. **Must be a placeholder tab:** the *other* member row has `user_id IS NULL`, and
   the caller is the real member (`user_id = auth.uid()`). If both members are real
   → raise: "This is a shared tab — you can hide it, not delete it." This is the
   hard line that makes real-tab history undeletable.
3. **No net-zero gate** (locked decision). The function deletes regardless of
   balance; the "you still owe/are owed ₹X — delete anyway?" warning is a **UI
   confirm**, not a DB check, because a private one-sided ledger shouldn't require
   ledger-falsification to discard. The function's only guards are membership +
   `kind='friend'` + placeholder (steps 1–2).
4. Delete the `groups` row; rely on `ON DELETE CASCADE` to clear `group_members`,
   expenses, and settlements. A placeholder tab has **no `friendships` row** (M3),
   so nothing to clean there.

**Prod-safety check before push (read-only, for Claude Code):** walk the FK chain
off `groups(id)` — `group_members`, `expenses`, `expense_splits`, `settlements`,
anything else — and confirm every one is `ON DELETE CASCADE`. If any is `RESTRICT`
/ `NO ACTION`, the delete will fail at runtime on a tab that has history, and the
function must delete children in dependency order instead. Report the actual chain
before writing the delete.

---

## 6. What we explicitly do NOT change

- `record_settlement`, `confirm_settlement`, `record_cash_settlement` — untouched.
- `create_friend_tab`, `create_placeholder_friend_tab` — untouched.
- `my_group_positions()` and the group archive zone — untouched. Group hiding stays
  whole-tab; friend hiding is the new per-person axis. The two don't interact.
- No new balance computation anywhere — all three RPCs and both reads use the
  existing net logic.

---

## 7. Remaining handoff (not a blocker)

- **Where "Archive" / "Delete" live on friend-detail** is a Claude Design handoff
  once this backend is approved — likely a small overflow/kebab menu (Archive for
  both kinds; Delete only when placeholder, with the blunt confirm from §5.3). The
  **Archived friends** list placement (Profile, near the group archive zone, is the
  natural home) is part of the same handoff. Flagging so it isn't forgotten; it
  doesn't gate the migration.

---

## 8. Prod-safety summary

- Single live-prod project; this migration is a production deploy.
- Column add is metadata-only (nullable, no default).
- `my_friend_positions()` change is shape-preserving `CREATE OR REPLACE` — verify
  byte-identical return columns in the diff.
- All three RPCs: DEFINER + `set search_path = public` (search-path injection guard
  — security-critical and invisible to tests, so eyeball the header), `revoke all
  from public`, `grant execute to authenticated`.
- Fully transactional DDL → a parse error rolls back clean, same as M1–M3.
- The two read-only checks in §3 and §5.3 (`select('*')` audit, FK cascade walk)
  happen and report **before** any SQL is written.

## 9. Tests to add before merge (against prod suite, seed → assert → teardown)

- Hide a settled real tab → it leaves `my_friend_positions()` for the archiver and
  **stays present for the other member** (the per-person proof).
- Hidden tab, then a new expense pushes net ≠ 0 → it **reappears** in
  `my_friend_positions()` without any unhide call (the sticky auto-resurface proof).
- Re-settle to 0 with `hidden_at` still set → it hides again (sticky persists).
- `unhide_friend_tab` → tab returns even at net 0.
- `hide_friend_tab` on a tab with net ≠ 0 → **rejected** (net-zero gate).
- `delete_placeholder_friend_tab` on a real+real tab → **rejected** (shared-tab
  guard), and the row still exists afterward.
- `delete_placeholder_friend_tab` on a settled placeholder → gone, and cascade
  removed its expenses/settlements (assert zero orphaned rows).
- `delete_placeholder_friend_tab` on a placeholder with a **non-zero** balance →
  **succeeds** (no net-zero gate on placeholder delete — the locked exception), and
  cascade still removes all children cleanly.
- `my_archived_friend_positions()` returns exactly the hidden-at-zero set and
  nothing else; non-members get zero rows (RLS/scoping).
