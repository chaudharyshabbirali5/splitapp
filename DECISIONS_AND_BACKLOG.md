# SplitApp — Decisions & Backlog
**The project's living memory.** Open this when you think "why did I do it this way?"
or "what was I supposed to fix before launch?" Keep it updated as things change.

_Snapshot as of: after Step 8 (PWA), the A1 security fix, and group archive. Update the date whenever you edit._
_Last updated: 2026-08-05 (after group archive / soft delete, commit 908d73d)_

---

## 1. What this app is (the one-paragraph reminder)
A group money-splitting app, India-first, where the differentiator is **real UPI
settle-up** — you don't just see "you owe Rahul ₹400", you tap once, your UPI app opens
pre-filled, you pay, the debt clears. It is NOT a messenger and NOT a feature-for-feature
Splitwise clone. One sharp edge: settlement actually happens inside the app.

Full scope is in PRD.md and TRD.md (also in this folder). Those are the source of truth
for what to build and how; this file tracks decisions and what's left.

---

## 2. Key decisions and WHY (so you don't second-guess later)

- **UPI deep link, never a payment gateway.** The app never touches or holds money — it
  builds a `upi://pay?...` link and the user's own bank app moves the money directly.
  This keeps us out of payment-aggregator licensing / PCI scope entirely. Do NOT "improve"
  this into handling money ourselves without deliberate legal advice — it changes the
  regulatory category completely.

- **No automatic payment confirmation.** There is no reliable success callback for UPI
  P2P. So settlement is manual: payer taps "I paid" (creates a pending settlement),
  payee taps "Confirm received" (marks it confirmed). Only confirmed settlements move
  balances. This is by design, not a gap.

- **Money is always integer paise (bigint).** Never floats. `19.99 * 100` in JS is
  `1998.9999...` — a real bug we avoided. All money math is integer/bigint end to end.

- **Balances are computed, never stored.** `group_balances()` derives everything from
  expenses + splits + confirmed settlements. Invariant: a group's balances always sum to
  exactly 0. If they ever don't, something is corrupt — that's the canary.

- **Financial records are soft-deleted, never hard-deleted.** Expenses use an
  `is_deleted` flag. Consistent philosophy: we don't destroy money history.

- **India-first, high-frequency users first.** Optimize for flatmates / active friend
  groups (monthly use), even though the app also handles trips/events/one-offs with the
  same engine. Don't fork the data model per use case.

- **Security model = Row-Level Security in the database**, because the app talks straight
  to Supabase. RLS policies ARE the security. Never disable RLS; never expose a table
  without a policy. Membership-check helper functions are SECURITY DEFINER (to avoid
  RLS recursion); the balance function is SECURITY INVOKER (so RLS still applies).

---

## 3. Known consequences of recent fixes (don't get surprised)

- **Settlement confirmation is now ONE-WAY.** After the A1 security fix, a confirmed
  settlement cannot be un-confirmed through the app. This is intentional for a financial
  record. If you ever truly need "undo a confirmation", it must be a deliberate,
  auditable RPC — not a loosened policy.

- **`upi_ref` can't be added after insert.** Column-level permissions freeze most
  settlement fields after creation. If you later want to store the actual UPI transaction
  reference, write it at insert time, or explicitly add it to the column grant.

- **"Delete group" is an ARCHIVE — and a hard delete is genuinely impossible.** Built in
  commit 908d73d as a soft delete (`groups.archived_at`), creator-only. A true hard delete
  cannot work with this schema: `groups` cascades to BOTH `group_members` and `expenses`,
  but `expense_splits.member_id -> group_members` is ON DELETE NO ACTION, so Postgres
  removes the member rows while splits still reference them. Tested — any group with
  expenses refuses to delete. The `groups_delete` policy in splitapp.sql is therefore
  effectively dead code for real groups.

- **An archived group is frozen, including its invite link.** A database trigger rejects
  inserts/updates on `group_members`, `expenses` and `settlements` belonging to an archived
  group — so an invite link shared months ago stops working too, not just the UI. Nothing
  is destroyed: members, expenses, splits and settlements are all retained, and clearing
  `archived_at` brings the group back intact.

---

## 4. Backlog — deferred technical items (NOT urgent, don't forget)

Park these; none block the current work. Rough order to address them:

### Before real VOLUME (not before first users)
- **A2 — Add missing foreign-key indexes.** These columns lack covering indexes:
  `expenses(created_by)`, `expenses(paid_by)`, `groups(created_by)`,
  `settlements(from_member)`, `settlements(to_member)`. The two `settlements` ones matter
  most — `group_balances()` scans them on every render. Invisible at a few groups; slow at
  thousands. One additive migration when the time comes.
- **A3 — auth re-eval per row (linter INFO).** Mechanical perf tweak: change `auth.uid()`
  to `(select auth.uid())` in policies so Postgres evaluates once per query, not per row.
  Lowest severity. Bundle with A2.

### User-facing gaps (not blocking, but someone will hit these)
- **Build an "Archived groups" / un-archive screen.** Archiving works, but there is **no way
  back through the UI** — recovering an archived group currently needs a manual SQL
  statement (`update groups set archived_at = null where id = '...'`). The data is fully
  retained and restore is proven to work, so this is purely a missing screen. Flagged
  during the archive build (commit 908d73d) and deliberately left out of scope. Not a
  launch blocker, but a real user will eventually archive the wrong group — and asking
  them to wait for you to run SQL is not a real answer. Needs: a list of archived groups
  (creator-only) and an `unarchive_group` RPC following the usual conventions.

### Hygiene (low priority, verified harmless)
- **A4 — Helper functions carry default PUBLIC execute grant.** Tested: anonymous callers
  get nothing (null auth.uid() → false, or permission denied on tables). Not a hole;
  tighten as cleanliness eventually.

### Before PUBLIC launch (real obligations)
- **A5 — Account deletion / "delete my data".** Currently blocked: profiles are referenced
  with ON DELETE NO ACTION, so a user with group data can't be deleted. Before public
  launch this is a legal (GDPR-style) obligation. Recommended approach: ANONYMIZE the
  person (blank name/email/UPI) but KEEP their ledger rows, so everyone else's balances
  stay correct — rather than truly deleting them.
- **Real email delivery (HARD GATE before inviting anyone who isn't you).** Supabase's
  built-in email only reliably reaches your own address and is rate-limited (~2-3/hour).
  To let real testers log in you must set up a proper sender (Resend) with a VERIFIED
  DOMAIN. Resend's free/test mode without a domain only emails your own address. So:
  buy a cheap domain → verify it in Resend → connect Resend to Supabase SMTP. Login flow
  itself already works (magic link via token-hash, works across browsers/devices).
- **Privacy policy + basic terms.** Even simple ones, before public launch.
- **Backups / recovery plan.** Know Supabase's backup retention on your plan before real
  users' financial history exists. Losing expense history would be trust-fatal.
- **Abuse / signup controls.** Currently anyone can sign up with any email (fine for
  friends). Before public: rate-limiting / invite-gating / spam-signup protection.

---

## 5. Owner responsibilities (the ongoing, non-code stuff)

- **Secrets discipline (forever).** service_role key and DB password live ONLY in
  `.env.local` (gitignored) and Vercel env vars. Never in chat, screenshots, or commits.
  If leaked, rotate immediately (or recreate the project while it's small).
- **Scope discipline (the biggest risk).** The main threat to this project is not a bug —
  it's endlessly polishing/adding features and never shipping to real users. Get a
  usable v1 into real hands and learn. "Slightly rough but used by 5 real flatmates"
  beats "perfect but used by nobody."
- **Free-tier ceilings.** Supabase (pauses on inactivity; row/storage/bandwidth caps) and
  Vercel (bandwidth) free tiers are fine at your size — just know when they'll bite so
  growth doesn't surprise you.
- **Stay on the right side of the money line.** The app is a deep link, not a money
  handler. The day you consider holding/routing funds yourself → regulated territory →
  get real advice first.

---

## 6. How to keep this file useful
- Update the "Last updated" line whenever you edit.
- When you finish a work session, tick off / add backlog items here and add a line to
  PROGRESS.md.
- When Claude Code makes a notable decision or finds a consequence, record it in section
  3 or 4 so it isn't lost to a chat transcript.
