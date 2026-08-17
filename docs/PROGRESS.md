# SplitApp — Progress Snapshot
**Quick status of what's built.** Show this to a fresh Claude Code session (or a friend)
to explain where the project stands. For the "why" behind decisions and the to-do list,
see DECISIONS_AND_BACKLOG.md.

_Last updated: 2026-08-16 — after the monorepo restructure_

> New to this project, or a fresh AI session? Read **HANDOFF.md** first — it tells the
> whole story from step 1, the decisions and why, and how we work.

## Repo layout (changed — read this if you have an older mental model)
```
frontend/   Next.js PWA — the only npm workspace, owns every JS/TS dependency
database/   splitapp.sql (frozen) · supabase/migrations/ · tests/ — see its README
docs/       these files
package.json  root: workspaces + scripts that proxy to the right folder, no deps
```
All commands still run from the repo root: `npm run dev`, `npm run build`,
`npm run test:acceptance`, `npm run db:push`. Nothing about the app changed — this was a
file move.

**⚠️ Vercel's Root Directory must be set to `frontend` in the dashboard** or deploys fail.
It cannot be set from `vercel.json`. See HANDOFF.md §2.

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
| 3 | Email magic-link login (works across browsers/devices — see HANDOFF.md §4) | ✅ done |
| 4 | Create groups, add real + placeholder members, self-join via invite link | ✅ done |
| 5 | Add/edit/soft-delete expenses, equal split with exact paise rounding | ✅ done |
| 6 | Balances screen: per-person nets + simplified "who pays whom" | ✅ done |
| 7 | **UPI settle-up** button + manual mark-paid / confirm flow | ✅ done — the core differentiator, works on real phone |
| 8 | Installable PWA (manifest, icons, safe service worker) | ✅ done |
| — | Security audit + A1 settlement-hardening fix | ✅ done |
| — | "Delete group" as a creator-only **archive** (soft delete) | ✅ done — commit 908d73d, 25 behaviour tests pass |
| — | **Design pass** — one token system, new type, new icon, all 9 screens | ✅ done — commit 9d89434 |
| — | Retheme to teal / coral / cream (light mode only) | ✅ done — commit 97b9fbe |
| — | WCAG contrast fix + teal icon, manifest and browser chrome | ✅ done — commit 52fb194 |
| — | Monorepo restructure: `frontend/` + `database/` + `docs/` | ✅ done — file move only, 51/0 held |

**v1 is feature-complete and themed.** Create groups → add people (incl. those not on
the app) → split expenses → see who owes whom → settle over UPI → installed on a phone,
with account isolation holding down to the browser cache.

## How the styling works now
All colour lives in CSS custom properties at the top of `frontend/app/globals.css`, exposed to
Tailwind via `@theme inline`. No component file contains a hex value or a `zinc-`/`red-`
utility. To change the look, change the tokens — not the screens.

- Light mode: teal brand `#0b7d73`, coral accent `#c9472f`, warm cream ground `#faf7f2`.
  Both fills clear WCAG AA against white button text (5.01:1 and 4.75:1) — keep it that
  way if you retune them.
- **Coral is only for settle / pay.** Everything else that is a primary action is teal.
- `--credit` (green) and `--debit` (red) are **reserved**: green means gets money back,
  red means owes. Never use them for branding or for "delete".
- Type: Instrument Sans for reading, IBM Plex Mono for every figure, UPI ID and label.
- **Dark mode is still the old navy.** Only the `:root` light block was rethemed.

---

## What's NEXT (in order)
1. **Finish the retheme in dark mode.** Light is teal/coral; dark is still the old navy.
   Small job, but the app currently has two different identities. See
   DECISIONS_AND_BACKLOG.md section 3.
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
- **Reinstall the PWA on your phone** after a theme change (uninstall first). The launcher
  icon and splash screen only refresh on a fresh install.
- **Display names are full usernames** (`chaudharyshabbirali88`), which truncate on every
  balance row. Shortening them in Profile improves the app more than any palette change.

## Working conventions (for any AI coding session)
- Never edit `database/splitapp.sql` or existing migrations — add NEW additive migrations.
- Keep `npm run test:acceptance` at 51/0 after any change (run it from the repo root).
- New RPCs: `search_path=public`, grant to `authenticated` only, revoke from public.
- `.env.local` stays gitignored and never committed. Secrets never pasted into chat.
- Work one step at a time; verify on the live URL before moving on.
