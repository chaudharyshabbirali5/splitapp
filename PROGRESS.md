# SplitApp — Progress Snapshot
**Quick status of what's built.** Show this to a fresh Claude Code session (or a friend)
to explain where the project stands. For the "why" behind decisions and the to-do list,
see DECISIONS_AND_BACKLOG.md.

_Last updated: 2026-08-05 — after group archive / soft delete (commit 908d73d)_

---

## Stack (all on free tiers)
- **Frontend:** Next.js (App Router, TypeScript) as an installable **PWA**
- **Backend / DB / Auth:** **Supabase** (hosted Postgres + Auth), project region **Mumbai (ap-south-1)**
- **Hosting:** **Vercel** — live at https://splitapp-bice.vercel.app
- **Code:** private GitHub repo, auto-deploys to Vercel on push
- No custom server, no messaging infra, no queues — by design (see TRD Section 11)

## Backend health
- 6 tables, all money in `bigint` paise, all PKs uuid
- RLS enabled on all 6 tables, 21+ policies, none locked out
- Acceptance test: **51 checks passing** (run `npm run test:acceptance`)
- Data integrity verified: 0 orphans, all groups' balances sum to exactly 0
- Money path hardened: forged/edited settlements blocked at the database (A1 fix, 27 attack tests pass)

---

## Build steps — status

| Step | What | Status |
|------|------|--------|
| 1 | Database schema, RLS, balance engine | ✅ done & verified |
| 2 | Next.js skeleton + Vercel deploy pipeline | ✅ done |
| 3 | Email magic-link login (token-hash flow, works across browsers/devices) | ✅ done |
| 4 | Create groups, add real + placeholder members, self-join via invite link | ✅ done |
| 5 | Add/edit/soft-delete expenses, equal split with exact paise rounding | ✅ done |
| 6 | Balances screen: per-person nets + simplified "who pays whom" | ✅ done |
| 7 | **UPI settle-up** button + manual mark-paid / confirm flow | ✅ done — the core differentiator, works on real phone |
| 8 | Installable PWA (manifest, icons, safe service worker) | ✅ done |
| — | Security audit + A1 settlement-hardening fix | ✅ done |
| — | "Delete group" as a creator-only **archive** (soft delete) | ✅ done — commit 908d73d, 25 behaviour tests pass |

**v1 is feature-complete.** Create groups → add people (incl. those not on the app) →
split expenses → see who owes whom → settle over UPI → installed on a phone, with
account isolation holding down to the browser cache.

---

## What's NEXT (in order)
1. **Design pass** — brand colors, typography, consistent styling across all screens.
   (Currently functional but plain.) This is the immediate next task.
2. **Pre-launch gate: real email** — domain + Resend so people who aren't you can log in.
   Required before inviting any outside tester.
3. **Before public:** account-deletion strategy, privacy policy, backups, abuse controls
   (see DECISIONS_AND_BACKLOG.md section 4).
4. **Then:** put it in real hands (start with your own flat / friend group) and learn.

## Housekeeping notes
- 3 auth accounts exist, all yours (chaudharyshabbirali5@, chaudharyshabbirali88@,
  and mohammedmhediagharia@ = the Claude Code login). Confirmed, not strays.
- The duplicate empty "Goa trip" test group (`cebff798`) was **archived on 2026-08-05**
  using the new archive feature. 3 active groups remain; the real "Goa trip" (`6d4323da`,
  3 members, 1 expense) is untouched.
- **Archiving has no undo in the UI yet** — recovering an archived group needs manual SQL.
  Tracked in DECISIONS_AND_BACKLOG.md section 4.

## Working conventions (for any AI coding session)
- Never edit `splitapp.sql` or existing migrations — add NEW additive migrations.
- Keep `npm run test:acceptance` at 51/0 after any change.
- New RPCs: `search_path=public`, grant to `authenticated` only, revoke from public.
- `.env.local` stays gitignored and never committed. Secrets never pasted into chat.
- Work one step at a time; verify on the live URL before moving on.
