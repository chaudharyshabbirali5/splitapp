# SplitApp — Decisions & Backlog
**The project's living memory.** Open this when you think "why did I do it this way?"
or "what was I supposed to fix before launch?" Keep it updated as things change.

_Snapshot as of: after Step 8 (PWA), the A1 security fix, group archive, the design pass, the teal/coral retheme and the monorepo restructure. Update the date whenever you edit._
_Last updated: 2026-08-31 (plus two decisions taken ahead of the gap-spec migrations)_

> New to this project, or a fresh AI session? Read **HANDOFF.md** first — it tells the
> whole story from step 1 and explains how we work. This file is the "why" and the
> to-do list; PROGRESS.md is the current status.

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

- **All colour is a token; no component holds a hex value.** The palette lives in CSS
  custom properties at the top of `frontend/app/globals.css` and reaches Tailwind through
  `@theme inline`. The nine screens share one set of component classes (`.ledger`,
  `.btn-*`, `.field`, `.chip-*`, `.figure`, `.khata-label`). This is why the whole app
  could be rethemed from navy to teal by editing ~25 lines. Keep it that way: if you find
  yourself writing `bg-teal-600` in a screen, add a token instead.

- **Green and red are RESERVED, and this is a real rule, not a style preference.**
  `--credit` means somebody gets money back; `--debit` means somebody owes. Neither is
  ever used for branding, and "delete" only turns red at the moment of confirmation. In
  a money app, a red button that doesn't mean "you owe" trains people to misread the one
  place it does. Brand colour is the teal `--brand`; the money-moving actions (settle up,
  pay with UPI) are the coral `--accent` and nothing else uses it.

- **Figures are monospace, everywhere.** Every rupee amount, UPI ID, email and invite URL
  is set in IBM Plex Mono with tabular figures, so columns of money line up. This is what
  makes the app read as a record rather than as an interface — and it is doing the same
  job as the exact-paise arithmetic underneath.

- **The monorepo split is organisational, not architectural.** `frontend/` and `database/`
  exist so two people can work without colliding. There is still **no backend runtime of
  our own** — `database/` holds SQL and tests, not a server, and TRD §11 still forbids
  adding one. If someone reads the folder name and reaches for Express, that is the
  mistake this note exists to prevent.

- **One copy of the credentials, in `frontend/.env.local`.** Next.js needs them there, so
  rather than keeping a second copy for the database tests, the test resolves that same
  file from its own location on disk. Two copies of a service-role key is two places to
  leak it from.

- **Dark mode is a user control, not a media query — and that was forced, not chosen.**
  The design-system stylesheet triggers dark from `[data-theme="dark"]` and ships **no**
  `prefers-color-scheme` block at all. Swapping the CSS without wiring a control would
  therefore have left dark mode with nothing to activate it, so the two had to land in
  the same commit (2a07c62). Three states — `light | dark | system` — persisted in
  `localStorage`, with `system` *resolved* to a concrete value in JS because the
  stylesheet cannot follow the OS by itself. The resolver lives in
  `frontend/lib/theme.ts` and is shared by the pre-paint inline script and the React
  provider **so the two cannot drift** — if you change one, change it there.
  The inline script must stay in `<head>` and stay dependency-free: it exists to set the
  attribute before first paint, and anything that delays it reintroduces the flash.

- **The tab bar renders from the root layout, not from each screen.** That is what let
  the shell land before any screen was redesigned — no `page.tsx` had to be touched. Its
  visibility rules are plain functions in `frontend/lib/nav.ts`, deliberately free of
  React imports so they can be tested directly; a tab bar that appears on the wrong
  screen is exactly the sort of bug that rots silently. Bottom padding is supplied by
  `TabBarSpacer` from the layout, because the scroll containers live inside each page.

- **No raw Supabase, PostgREST or RLS string ever reaches the screen.** An RLS refusal
  reads as "you can't see this", not as a policy name. Two real violations were fixed
  during the Stage 4 work: the login screen rendered Supabase's own send error, and the
  groups list rendered `error.message` verbatim. The login one also rendered
  `?error=` straight from the URL — attacker-controlled text on a sign-in page, which is
  a ready-made phishing lure even though React escapes it. Log the detail with
  `console.error`; show a human sentence.

- **`uq_members_group_user` is load-bearing, not hygiene.** A partial unique index on
  `group_members (group_id, user_id) where user_id is not null`, added alongside
  `my_group_positions()`. That function anchors on "the caller's member row in this
  group" and collapses to one row per group; if a user could hold two member rows in one
  group it would emit that group twice and the home screen's client-side grand total
  would **double-count it** — a silently wrong money figure, no error, on the first
  screen anyone opens. The index turns one-row-per-group from a convention into a
  guarantee. It is **partial on purpose**: placeholders (`user_id is null`) sit outside
  it, so a group may still hold as many not-yet-joined members as it likes.

  Before adding it, all three insert paths were audited: `create_group_with_owner`
  inserts into a group created one statement earlier (nothing can pre-exist);
  `join_group_via_code` already pre-checks membership and returns early (the index now
  *enforces* that guard); `addPlaceholderMember` writes `user_id = null` explicitly and
  is outside the index. None can turn a rejection into a user-facing crash.

- **The uniqueness rule does NOT auto-merge placeholders, and that stays true.** When
  someone joins a group that already contains a placeholder standing for them, they get
  a **new member row**; the placeholder is untouched. That was a deliberate call in step
  4 and the index does not change it — it only forbids the same *account* appearing
  twice. Merging a placeholder into a real account moves money between ledger rows, so
  it has to be an explicit, auditable action, never a side effect of a constraint.

- **`my_group_positions()` replicates `group_balances()`'s arithmetic — it cannot share
  it.** One returns every member's net for one group; the other one member's net across
  many. Expressing the second in terms of the first reintroduces the N+1 it exists to
  remove. So the four components are copied verbatim (same signs, same
  `is_deleted = false` / `status = 'confirmed'` filters, same `::bigint`), and **the
  acceptance suite asserts the two agree to the paise for every seeded group** — drift
  fails a test instead of shipping. If you change one, change the other.

- **Cash settlements: the counterparty OR the group admin may record one — never any
  member.** Placeholders have no account, so nobody can sign in as them to confirm a
  payment; someone else has to record that cash changed hands. Two people are trusted to
  do that and no more: the **counterparty** (the other side of the payment, who knows
  whether they handed over or received the money) and the **group admin** (so a group
  does not deadlock when the counterparty is unreachable). Any member being able to
  assert that a payment happened would let a debtor clear their own debt unilaterally,
  which is the same hole the A1 fix closed for UPI settlements.

  **Enforced in the RPC, not left to RLS.** Today's `settle_insert` policy permits any
  member, and this rule is narrower than that. Widening the policy is the wrong move: the
  check is "you are one of these two specific people relative to THIS settlement", which
  is exactly the sort of relational condition an RPC states clearly and a policy states
  badly. The policy stays as the outer boundary; the RPC is where the rule lives.

  **`recorded_by` is always stored and always shown.** Not nullable, not optional, not
  hidden when it happens to equal the payer. A cash record is one person asserting
  something about another person's money, and the ledger has to say who asserted it. The
  feed distinguishes the two cases in its copy — "You paid ₹X in cash" when the payer
  records their own, and "Recorded by [admin] on behalf of [payer]" when the admin does
  it for them. Same row, different provenance, and the reader can tell which.

- **Over-allocation stays out of `--debit`. Red means owed money, and only that.** When a
  custom split allocates more than the expense total, the error is carried by the
  **`.ledger-total` double rule reddening** (the existing `.ledger-total-bad` treatment,
  already the on-screen home of the sum-to-zero canary) plus a `Notice` in its error
  tone. The invalid amount cell gets a **border** treatment, the same shape as `Field`'s
  error state — **never a reddened figure**.

  The reason is the reserved-colour rule doing real work rather than being decorative: if
  a red number can mean "this input is invalid", then a red number no longer reliably
  means "this person is owed money", and the one place the colour must be unambiguous is
  a column of money. Colour the container, never the digits.

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
  expenses refuses to delete. The `groups_delete` policy in database/splitapp.sql is therefore
  effectively dead code for real groups.

- **~~Light and dark are two different brands~~ — RESOLVED by the stylesheet swap
  (2a07c62).** The design-system `globals.css` ships a real designed dark palette
  (ground `#1a1815`, brand `#4fbfae`, accent `#f0705a`) keyed to `[data-theme="dark"]`,
  so the navy leftover is gone and `--accent` is defined in both themes. Kept here
  because the old note said dark was "the next task" and someone may still be carrying
  that expectation.

- **Button contrast was a real regression, and it is fixed.** The first retheme shipped
  `--brand: #0d9488` and `--accent: #e86552`, which gave white button text 3.7:1 and
  3.3:1 — under the 4.5:1 WCAG AA bar for 14px text. The navy it replaced was very dark,
  so this was introduced by the retheme, not inherited. Commit 52fb194 darkened them to
  `#0b7d73` (**5.01:1**) and `#c9472f` (**4.75:1**). Lesson worth keeping: when you pick
  a mid-tone brand colour, compute the ratio against `--on-fill` before shipping it —
  a colour that "looks fine" at 3.3:1 is not fine.

- **Vercel REQUIRES three dashboard settings. This entry supersedes the one below it.**
  Verified directly in Project → Settings → Build & Deployment, rather than inferred:

  | Setting | Value | Why |
  |---------|-------|-----|
  | Root Directory | `frontend` | Without it Vercel reads the root `package.json`, finds no `next` dependency, and fails with **"No Next.js version detected."** |
  | Include files outside the Root Directory in the Build Step | Enabled | `package-lock.json` exists **only** at the repo root — standard npm workspaces. Confirmed locally: `Test-Path package-lock.json, frontend/package-lock.json` → `True, False`. Scoped to `frontend/` without this, the install step has no lockfile. |
  | Skip deployments when there are no changes to the root directory | Enabled | Already done. `database/`- and `docs/`-only pushes skip the frontend rebuild. Not a future optimisation. |

  `rootDirectory` is still **not** a valid `vercel.json` key — Vercel fails the build on
  unknown properties — so that one detail of the original note was always correct and
  survives. This is dashboard-only configuration.

  **What went wrong, and it is worth understanding rather than just noting.** Commit
  `02b9430` shipped the correct warning. Then the restructure deployed successfully on the
  first push, and commit `b15b68a` retracted the warning on that basis — reasoning "the
  build succeeded, therefore no dashboard setting was needed."

  That inference is invalid. **The settings were already configured before the push.** The
  build succeeded *because of* them, not in spite of their absence. The unconfigured case
  was never tested, and the dashboard was never looked at. A green build tells you the
  settings currently in place are sufficient; it tells you nothing whatsoever about *which*
  settings are in place. Treating a successful outcome as evidence about an unobserved
  configuration is the error, and it is an easy one to repeat with any hosted platform
  whose state lives outside the repo.

  So: `02b9430`'s message carries the original warning and was right. `b15b68a` wrongly
  retracted it. This entry restores it with evidence. Git history is not rewritten — the
  wrong turn stays visible, which is the point of keeping the entry below.

- **[SUPERSEDED by the entry above — this reasoning was wrong. Kept for the trail.]**
  **Vercel needed no dashboard change — a prediction that turned out wrong.** The
  restructure was expected to break deploys until Root Directory was set to `frontend`,
  reasoning that the root `package.json` has no dependencies so Vercel would find no
  Next.js app. It deployed fine on the first try: Vercel detected the npm workspace and
  built `frontend/` unaided. Verified against the deployed commit SHA, not assumed —
  `/sw.js` embeds `VERCEL_GIT_COMMIT_SHA`, which makes it a genuinely useful
  deploy-identity probe worth remembering:
  `curl -s <site>/sw.js | head -1`.
  Recorded because the wrong version of this note briefly shipped in the docs, and
  because commit `02b9430`'s message still contains the incorrect "ACTION REQUIRED"
  warning — the commit message cannot be corrected after pushing, so this entry is the
  correction. Setting Root Directory remains a worthwhile **optimisation** (it would skip
  rebuilds on `database/`- or `docs/`-only pushes) but is not required. `rootDirectory` is
  still **not** a valid `vercel.json` key — Vercel fails the build on unknown properties —
  so that part stands.

- **Migrations sit at `database/supabase/migrations/`, one level deeper than you'd guess.**
  The Supabase CLI resolves them at `<workdir>/supabase/migrations` with no override, so
  flattening to `database/migrations/` would break `supabase db push`. Kept the CLI's
  layout and pass `--workdir database`. Don't "tidy" this.

- **The groups home screen shows no balances, and that is deliberate — for now.** The
  design calls for an overall-position card, balance bubbles, per-row credit/debit
  figures and member avatar stacks. None of it shipped in 84fb85b, because the screen
  loads **no balance data at all** — its query is
  `groups(id, name, group_type, created_at)` and always was. Rendering the design would
  have meant new reads, which was out of scope for a markup pass. The screen is correct
  and complete for the data it has; it is not the finished design.

  **RESOLVED — `my_group_positions()` now exists** (migration
  `20260831114631_my_group_positions.sql`). The screen still has to be wired to it; that
  is a separate turn. The reasoning that led here: `group_balances(gid uuid)` takes a single group id and there is no
  all-groups variant, so the obvious implementation is N+1 RPC calls on the home
  screen — 23 round-trips at 20 groups, on the screen people open first. Preferred
  approach is one small additive migration returning every group's net for the caller in
  a single call (`security invoker`, so RLS still applies; `search_path=public`, granted
  to `authenticated`, revoked from PUBLIC, per the house rules). That makes the screen
  three queries flat at any group count.

  The bubble geometry is recorded so it need not be rediscovered: diameters
  `0.42 / 0.26 / 0.30 / 0.24 / 0.20` at x `0.32 / 0.02 / 0.04 / 0.66 / 0.38`,
  y `0.00 / 0.04 / 0.32 / 0.40 / 0.44`, container height = width × `0.64`. Every value
  is a fraction of container **width** — that is what stops the discs intersecting at
  any column size. `.bubble` in `globals.css` documents the same numbers.

- **The theme toggle exists but is not mounted anywhere.** `ThemeToggle` is built,
  wired and working; it simply has no home yet, because its place is the Profile screen
  and Profile is still to be restructured. Until then the theme follows the OS and can
  only be changed by writing `localStorage['splitapp-theme']` by hand. Mounting it is a
  one-line drop-in when Profile lands — do not rebuild it.

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

### Design debt (one item left)
- **Retheme the dark block.** Pick the teal/coral equivalents for `--brand`,
  `--brand-hover`, `--brand-soft`, the grounds and the rules, and redefine `--accent` so
  coral works on a dark ground (dark mode's `--on-fill` is charcoal, not white, so check
  the ratio both ways). One edit to `frontend/app/globals.css`, no component changes.
- ~~Fix button text contrast~~ — done, commit 52fb194. See section 3.
- ~~Icon and manifest still carry the navy~~ — done, commit 52fb194. `frontend/public/icon.svg`,
  all five PNGs, `favicon.ico`, `manifest.ts` and the viewport `themeColor` are teal.
  **The icon is regenerated from the SVG by a script, not by hand** — see HANDOFF.md
  "Regenerating the icons". One thing was left deliberately: the double rule in the icon
  is still `--credit` green `#1f6b4a`, which against navy was a clear signal but against
  teal is a near neighbour. The mark reads a bit monochrome now. Changing it means either
  spending the reserved green or adding a fourth colour, so it is a brand call, not a bug.

### Gap-spec migrations — DEFERRED, and paper-first before any SQL
Two database changes are known to be needed and are deliberately not written yet. Both go
through **RPC design on paper, reviewed, before a line of SQL exists** — the same order
that caught the missing `group_members` uniqueness constraint before `my_group_positions()`
was built on top of it. Designing first is what turns "the assumption was wrong" into a
question instead of a bug.

- **§1 — exact-shares RPC.** Custom (non-equal) splits need a write path that takes
  explicit per-member shares. The rounding rule that makes equal splits exact does not
  apply, so the RPC must assert the shares sum to the expense total itself. Same house
  conventions as every other RPC: `search_path=public`, `authenticated` only, revoked
  from PUBLIC, and INVOKER unless there is a stated reason otherwise.
- **§2 — `settlements` gains `method` and `recorded_by`.** Additive columns to support
  cash settlements alongside UPI. Note the existing constraint this runs into: after the
  A1 fix, column-level grants freeze most settlement fields after insert, so both columns
  must be written **at insert time** or explicitly added to the grant — the same trap
  already recorded for `upi_ref` in section 3. The counterparty-or-admin rule and the
  always-stored `recorded_by` are settled decisions; see section 2.

### UI work still open (Stage 4 and beyond)
- **Finish the designed screens**, one route per commit: group detail (the archive /
  danger zone **moves to Profile** — relocate it, don't just restyle it), add expense,
  balances plus the settle sheet, and profile. Login (abdccb0) and groups home
  (84fb85b, partial) are done.
- **Wire the groups-home balance UI** — see section 3 for the deferred scope and the
  all-groups-RPC decision. This is the one item with a database dependency.
- **Mount the theme toggle on Profile.** Already built; see section 3.
- **Custom split** on the add-expense screen is explicitly Stage 7, not Stage 4.

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
  itself already works across browsers and devices (see HANDOFF.md §4 for how, and why
  the callback must stay a client page).
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
