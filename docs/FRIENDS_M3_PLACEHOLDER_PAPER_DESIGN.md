# Friends M3 — Placeholder Friends (Paper Design)

**Status:** Paper design for review. No SQL written or pushed. Same gate as M1
and M2: nothing runs until this is reviewed and approved on paper, and the push
is a separate explicit authorization. **M3 waits until M2 is confirmed in
prod** (M-numbered migrations are ordered dependencies).

**In one line:** let a user record a friend tab against a person who is *not on
SplitApp* — a private, one-sided ledger — reusing the placeholder-member
machinery Groups already has.

---

## 1. What M3 is, and what it is NOT

**M3 delivers:** a second creation door that makes a `kind='friend'` group with
one real member (the creator) and one **placeholder** member (`user_id IS NULL`,
carrying a `display_name` and optional `upi_id`). Balances, counterparty
display, and cash settle-up all work through paths that already exist.

**M3 does NOT deliver claiming.** When the off-app person later signs up, they
do **not** inherit this tab — today they'd get a fresh, empty account and the
history stays on the unclaimable placeholder row. That is an existing app-wide
gap (Groups has it too), not something M3 introduces or fixes. The missing piece
is `claim_placeholder` (TRD §14) — a separate, deliberate, money-moving
workstream. **Until it exists, a placeholder friend is the creator's private
record only.** The UI must not promise a two-sided experience (see the
add-friend design note).

This scoping is the honest boundary: M3 is the ledger half, cheap and additive;
claiming is the growth-loop half, separate and heavier.

---

## 2. Why the read path needs no change (confirmed by investigation)

`my_friend_positions()` (M1) resolves the counterparty from `group_members`
columns — `display_name`, `upi_id`, `user_id` — with **no join to `profiles`**.
So a placeholder counterparty resolves correctly: name and UPI come from the
member row, which a placeholder has. The only field that goes NULL is
`counterparty_user_id`, and that NULL **is** the signal the UI branches on for
"this person has no account" — the same branch cash-settlement already uses
elsewhere. The `me` anchor matches `gm.user_id = auth.uid()`, so the caller must
be real, which is correct (a placeholder can't sign in to call anything).

**No change to M1.** The read path was already placeholder-ready.

---

## 3. The one new object: `create_placeholder_friend_tab`

```
create_placeholder_friend_tab(p_name text, p_upi text default null) returns uuid
```

`SECURITY DEFINER`, `set search_path = public`, `revoke all from public`,
`grant execute to authenticated` — the same hardened shape as
`create_friend_tab`. (`SECURITY DEFINER` = runs with elevated rights because it
writes group/member rows the caller can't write directly; `set search_path`
locks the schema list so those rights can't be hijacked.)

Body, in order:
1. `v_me := auth.uid()`; raise if null (no anonymous caller).
2. Validate `p_name` is non-empty (trim; reject blank). Normalise `p_upi` to
   `null` if blank.
3. Insert the `groups` row: `kind='friend'`, `group_type='other'`,
   `created_by := v_me`, and a sentinel `name` (never displayed — see open
   decisions for the exact format).
4. Insert the **real** member: `(group_id, v_me, <my display_name>, <my upi>,
   'admin')`.
5. Insert the **placeholder** member: `(group_id, null, p_name, p_upi,
   'member')`.
6. Return `group_id`.

Notes:
- It inserts the group **directly** (does not call `create_group_with_owner`),
  same as `create_friend_tab`, to set `kind='friend'` and skip that function's
  group-type validation and UPI-ID requirement.
- The M2 **two-member cap trigger is satisfied**: the two inserts are member
  0→1 and 1→2, both allowed; only a third would be rejected. No conflict.
- It writes **nothing** to `friendships` — see §4.

---

## 4. Dedup is skipped for placeholder friends — and that is correct, not lazy

The M2 `friendships` table (the one-tab-per-pair guarantee) has `user_lo` /
`user_hi` as **NOT NULL FKs to `profiles`**, with `CHECK (user_lo < user_hi)`
and `UNIQUE (user_lo, user_hi)`. A pair where one side has no profile **cannot
be expressed** in that table as built.

More fundamentally: dedup requires a **stable identity** for the counterparty.
A placeholder has none — two placeholders both named "Rahul" are genuinely
different rows with different `group_members.id`s, and nothing ties them to the
same real-world person. So "one tab per placeholder pair" isn't just hard to
store, it's **not well-defined**. There is nothing meaningful to dedup on.

**Decision:** placeholder friend tabs get no dedup. A user *can* create two tabs
for the same off-app name; that's their private ledger to manage, and the app
shouldn't guess that two same-named placeholders are one person. `friendships`
is untouched and keeps guaranteeing one-tab-per-pair for **real** friends, where
identity is stable.

---

## 5. Settle-up: reuses `record_cash_settlement`, cash-only — no new SQL

A placeholder friend tab makes `record_cash_settlement` **reachable**: its
"both sides have accounts → refuse" guard only fires when both members are real,
which is no longer the case. So:

- **Placeholder friend → cash settle.** The creator (admin **and** a party to
  the debt) records a cash settlement in either direction; it's written straight
  as `confirmed` (there's no second account to confirm it). This is exactly how
  placeholder members settle in Groups today.
- **Real friend → UPI settle** (unchanged from M2). The UPI two-step
  (`record_settlement` → `confirm_settlement`) can't be used with a placeholder —
  a pending row would strand forever with no one to confirm it.

**No new settlement code.** M3 adds a **UI routing rule**, not SQL: friend
detail routes to cash settle when `counterparty_user_id IS NULL`, UPI settle
otherwise. The backend already enforces the boundary (UPI can't complete against
a placeholder; cash can't be used between two real accounts).

---

## 6. What M3 explicitly does NOT change

- `my_friend_positions()` (M1) — already placeholder-ready, untouched.
- `create_friend_tab`, the `friendships` table, the cap trigger (M2) — all
  untouched; real friends behave exactly as before.
- `record_cash_settlement` / `record_settlement` / `confirm_settlement` — no
  change; cash path simply becomes reachable for placeholder tabs.
- The client `.eq('kind','group')` filters — already keep *all* friend tabs
  (real or placeholder) off the Groups/Profile surfaces. No change.
- RLS — the placeholder member row sits under the existing `group_members`
  policies; the creator is a member and sees the tab. No new policy.

M3 is, in effect, **one new function + tests.** That small footprint is the
direct payoff of the read path already being placeholder-ready.

---

## 7. Open decisions

1. **Dedup for placeholders → skip (recommended).** Confirm: no dedup, per §4.
   It isn't well-defined without stable counterparty identity.
2. **Store the placeholder's UPI ID? → yes, allow it (recommended).** The member
   row has the column; capturing a known UPI is cheap and becomes useful *if*
   claiming is ever built. It does **not** enable UPI settle now (still no
   account to confirm) — cash-only stands regardless.
3. **Sentinel `name` format for placeholder tabs.** Never displayed. Proposed:
   `friend:<me8>:ph:<8 hex>` (creator prefix + random suffix), since there's no
   second user UUID to use as in the real-friend sentinel. Any non-null,
   debuggable value works.
4. **Collision with a real user (you add a placeholder "Priya" who is actually
   on the app) → no backend enforcement (recommended).** It's the user's ledger;
   the app can't know they mean the same person. The add-friend UI's lookup step
   naturally nudges toward "this person is on SplitApp — add them as a real
   friend?" — a UI nicety, not a backend rule.

---

## 8. The claiming gap — named, so it isn't forgotten

`claim_placeholder(member_id)` — a `SECURITY DEFINER` RPC that links a
signing-up user to an existing placeholder row so they inherit its history —
is the unlock for the growth loop your PRD §9 calls the most important product
mechanic. It is **out of scope for M3**, is **app-wide** (fixes Groups and
Friends together), and must be built carefully because it moves money. It should
be recorded in `DECISIONS_AND_BACKLOG.md` as the named next step for the loop,
and sequenced near the Resend work (join-at-scale needs the mailer anyway).

Until then: **placeholder friends are a private ledger. The UI promises nothing
two-sided.**

---

## 9. Migration ordering & prod-safety

- **M3 waits for M2 confirmed in prod.**
- M3 is additive: one new function, no table change, no change to existing
  functions. Fully transactional (a parse/exec error rolls back clean).
- The new function's body is late-bound (plpgsql), so — as with M2 — the
  **acceptance suite is the real proof it works**, not a successful apply.
- Standard hardening on the new function: `set search_path = public`,
  `revoke all from public`, `grant execute to authenticated`, `SECURITY
  DEFINER`.

---

## 10. Tests to add before merge

Call through PostgREST with a real user JWT (the RPC reads `auth.uid()`; a
service-role connection sees a null uid and raises).

1. `create_placeholder_friend_tab` creates a `kind='friend'` group with exactly
   two members — one real (`user_id = caller`, `admin`) and one placeholder
   (`user_id IS NULL`, `display_name = p_name`, `role = 'member'`).
2. The placeholder tab appears in `my_friend_positions()` with the placeholder's
   name/UPI resolved and **`counterparty_user_id IS NULL`** (the cash-settle
   signal).
3. Signed `net_minor` is correct on a placeholder tab after an expense (same
   balance math as any friend tab).
4. **Cash settle works** on a placeholder tab (`record_cash_settlement`
   succeeds, both directions, written as `confirmed`).
5. **UPI settle is unusable** on a placeholder tab (a `record_settlement`
   pending row can't be confirmed — assert it strands, proving the UI must route
   to cash).
6. The **cap trigger** still holds: a third member insert into a placeholder
   friend tab is rejected.
7. Blank/whitespace `p_name` is rejected; anon caller is rejected.
8. No `friendships` row is created for a placeholder tab (dedup-skip is real);
   real-friend dedup via `create_friend_tab` still works unchanged.
