# SplitApp — Full Handoff

**Read this first.** It is the whole story of this project: what it is, how it was built,
every decision that matters and why it was made, the traps we hit, how we work, exactly
where things stand, and what happens next.

It exists because the chat history that held all of this context is gone. Everything a
new person — or a new AI session — needs to continue is in this repo, not in a
conversation.

_Written 2026-08-16, at commit `52fb194`._

---

## 0. The document set

| File | What it's for |
|------|---------------|
| **HANDOFF.md** (this file) | The whole story. Read once, start to finish. |
| **PROGRESS.md** | Current status at a glance. Updated every session. |
| **DECISIONS_AND_BACKLOG.md** | Why things are the way they are + the to-do list. |
| **PRD.md** | Product requirements. Source of truth for *what* to build. |
| **TRD.md** | Technical requirements. Source of truth for *how*. Section 12 is the build plan; Section 11 is the "never do this" list. |
| **splitapp.sql** | The original validated schema. **Frozen. Never edit.** |

PRD.md and TRD.md were written before any code. They are still authoritative — if
something in the app contradicts them, that is a bug or a decision that needs recording
here.

---

## 1. What SplitApp is

A group expense-splitting app, India-first, built as an installable PWA.

**The one differentiator: real UPI settle-up.** Splitwise and its clones show you "you
owe Rahul ₹400" and then abandon you — you leave the app, open your bank app, retype the
amount, and come back to mark it manually. SplitApp closes that loop. You tap once, your
UPI app opens **pre-filled** with the payee, the exact amount and a note, you pay, and
the debt clears.

Everything else — groups, expenses, equal splits, balances — is table stakes that exists
to make that one moment possible.

**What it deliberately is NOT:**
- Not a messenger. No chat, no comments, no activity feed.
- Not a feature-for-feature Splitwise clone.
- Not a payment handler. See the money-line rule below — this one is not negotiable.

**Who it's for:** flatmates and active friend groups in India who settle up monthly.
Trips and one-off events work on the same engine, but the data model is tuned for
recurring use. Do not fork the model per use case.

---

## 2. Where everything lives

| Thing | Where |
|-------|-------|
| Code | Private GitHub repo, `chaudharyshabbirali5/splitapp`, branch `main` |
| Hosting | Vercel — auto-deploys on every push to `main` |
| Live URL | https://splitapp-bice.vercel.app |
| Database + Auth | Supabase (hosted Postgres 17.6), region **Mumbai / ap-south-1** |
| Secrets | `.env.local` (gitignored, never committed) and Vercel env vars |

**On the Supabase project:** it was created three times. First in Seoul, then rebuilt in
Mumbai for latency, then rebuilt once more. Only the current Mumbai project matters; the
project ref and keys are in `.env.local`. If you ever need the connection string, note
that the **direct database host is IPv6-only** and this machine has no IPv6 egress —
you must use the **session pooler** host (`aws-1-ap-south-1.pooler.supabase.com:5432`).
That cost an hour the first time. Password special characters must be percent-encoded
in the URI (`@` → `%40`).

**On accounts:** three Supabase auth accounts exist, all belonging to the owner. None are
strays.

---

## 3. Architecture — how it actually works

### The shape of it

The browser talks **straight to Supabase**. There is no API server, no backend of our
own. This is deliberate (TRD Section 11 forbids a custom server, message queues,
microservices, Redis/Kafka, and a payment gateway).

That single choice drives everything else: **if the client talks directly to the
database, then Row-Level Security IS the security model.** There is no server-side
middleware to check permissions in. Every rule lives in Postgres.

### The 6 tables

`profiles` · `groups` · `group_members` · `expenses` · `expense_splits` · `settlements`

- All primary keys are `uuid`.
- **All money is `bigint` paise.** Never a float, never a decimal, anywhere.
- `group_members` is the important one: a member row can exist **with or without a
  `user_id`**. A row with `user_id = null` is a *placeholder* — someone in the group who
  isn't on the app. This is what lets you split with people who haven't signed up.

### Security: RLS + two function flavours

RLS is enabled on all 6 tables with 21 policies. **Never disable RLS. Never expose a
table without a policy.**

Two function types, and the distinction is load-bearing:

- **`SECURITY DEFINER`** — the membership helpers (`is_group_member`, `is_group_creator`,
  `is_expense_member`, `is_own_member`, `is_group_member_row`). They run with the
  definer's rights, which is how they escape **RLS recursion**: the policy on
  `group_members` needs to ask "is this user a member?", which would query
  `group_members`, which fires the policy again, forever. A DEFINER function breaks the
  loop.
- **`SECURITY INVOKER`** — `group_balances()` and all the write RPCs. They run as the
  caller, so **RLS still applies to them**. A non-member calling `group_balances()` gets
  an empty result, not somebody else's money.

**Never change the DEFINER/INVOKER setting on an existing function.** It is a security
decision, not a style one.

### Why the write RPCs exist

Creating an expense means inserting one `expenses` row and N `expense_splits` rows, and
they must **all succeed or all fail** — a half-written expense corrupts the ledger.
PostgREST can't do a multi-table transaction from the client.

So writes go through `SECURITY INVOKER` functions, which give atomicity **without**
privilege escalation:

| RPC | Does |
|-----|------|
| `create_group_with_owner` | Group + creator's member row, atomically |
| `join_group_via_code` | **DEFINER** — see below |
| `create_expense` / `update_expense` | Expense + all splits, with the rounding done in SQL |
| `record_settlement` | Payer marks "I paid" → a `pending` settlement |
| `confirm_settlement` | Payee confirms → `confirmed`, and only now does it move balances |
| `archive_group` | Creator-only soft delete |

`join_group_via_code` is the one **DEFINER** write, and for a good reason: a first-time
joiner is neither a member nor the creator, so the members-insert policy correctly
refuses them. Rather than loosening that policy (which would weaken it for everyone),
**holding a valid invite code is the authorisation**, and the DEFINER function is what
grants it.

### Money: the paise rule

`19.99 * 100` in JavaScript is `1998.9999999999998`. That is not a hypothetical — it is
the exact bug this rule exists to prevent.

- Rupee strings are parsed to integer paise with a regex, and the fractional part is
  parsed **as its own integer** (`lib/money.ts`).
- All arithmetic is integer or BigInt, end to end, database included.
- `lib/balances.ts`'s `toPaise()` **throws** rather than silently rounding if a value
  couldn't survive the JSON round-trip. A loud failure beats quiet corruption.

**Rounding an uneven split:** `base = amount / n`, remainder `rem = amount % n`, and the
**first `rem` participants get one extra paise each**. So ₹33.33 split two ways is
₹16.67 / ₹16.66 — never ₹16.665. The RPC asserts in SQL that the shares sum to the exact
total before committing, and the expense detail screen shows that sum on-screen so the
rounding is auditable by eye.

### Balances: computed, never stored

`group_balances()` derives everything from expenses + splits + **confirmed** settlements.

**The invariant: a group's balances always sum to exactly 0.** If they ever don't,
something is corrupt. That is the canary, and it is deliberately displayed in the UI
under a double rule rather than hidden — if it ever reads anything but ₹0.00, you want
to find out from the screen, not from a user.

"Who pays whom" uses greedy debt simplification (TRD §9): the shortest set of transfers
that clears everyone, instead of everybody paying everybody.

### Settlement: why it's manual

**There is no reliable success callback for UPI P2P payments.** So:

1. Payer taps "I paid" → `record_settlement` creates a `pending` row.
2. Payee taps "Confirm received" → `confirm_settlement` marks it `confirmed`.
3. **Only confirmed settlements move balances.** Pending ones are ignored by the maths.

This is by design, not a gap. Don't "fix" it with an automatic confirmation.

---

## 4. The frontend

Next.js 16.2 (App Router, Turbopack), React 19.2, TypeScript, Tailwind v4,
`@supabase/ssr`.

### Routes (16)

```
/                             → redirects to /groups
/login                        magic-link sign-in
/auth/callback                CLIENT page — completes sign-in (see below)
/auth/signout
/groups                       list
/groups/new
/groups/[id]                  members, expenses, invite, danger zone
/groups/[id]/balances         nets + who-pays-whom + settle up
/groups/[id]/expenses/new
/groups/[id]/expenses/[id]         detail — shows each person's exact share
/groups/[id]/expenses/[id]/edit
/join/[code]                  invite link
/profile
/manifest.webmanifest         generated by app/manifest.ts
/sw.js                        service worker, served from a route handler
```

### `lib/`

- `money.ts` — rupee ⇄ paise, formatting
- `balances.ts` — `toPaise`, `sumNets`, `simplifyDebts`, `applyPayments`
- `upi.ts` — builds the `upi://pay?...` deep link
- `safe-next.ts` — open-redirect guard on `?next=` (rejects anything not starting with a
  single `/`)
- `supabase/` — three clients: `createClient` (PKCE), `createCallbackClient`
  (`detectSessionInUrl: false`), `createMagicLinkClient` (implicit flow)

### The auth flow — the hardest thing in the project

The magic link failed when opened in a different browser from the one that requested it.
Cause: **PKCE**. The sign-in stores a `code_verifier` in the originating browser's
storage, and the emailed link is useless without it. But people open email on their
phone, in Gmail's in-app browser, on another device — that is the normal case, not the
edge case.

First fix: switch sign-in to the **implicit flow** (`createMagicLinkClient`).

Then a second discovery: Supabase's **magic-link email template is read-only unless you
configure custom SMTP.** So we could not change what the link points at. The default
template sends the user to Supabase's `/auth/v1/verify`, which verifies server-side and
redirects to our callback **with the tokens in the URL fragment**:

```
/auth/callback?next=/groups#access_token=...&refresh_token=...
```

**A fragment is never sent to the server.** No server route could ever read it. That is
why `/auth/callback` is a **client page** — it reads `window.location.hash`, calls
`setSession()`, and `@supabase/ssr` writes the cookies that middleware and Server
Components then see. It also handles token-hash and PKCE as fallbacks, so if custom SMTP
is added later nothing breaks.

**Do not "simplify" the callback into a server route handler.** It will silently fail.

### PWA

- Manifest via `app/manifest.ts`; icons in `public/`.
- The service worker is served from **a route handler, not a static file**, so it can
  embed the deploy's commit SHA. A static `sw.js` has identical bytes every deploy, so
  the browser never sees a change and never activates the new one.
- **App pages are network-only.** They render per-user balances; a cached page would be
  both stale and a **leak between accounts on a shared device**. Only fingerprinted
  static assets and a data-free `offline.html` are cached.
- On activate it deletes every previous build's cache, so old assets can't linger.

### The design system

The visual identity is **Khata** — a shopkeeper's ledger. Three rules carry it:

1. **Hairline rules do the work** that cards, shadows and rounded boxes usually do. A
   list of money is a ruled column, not a stack of panels.
2. **Every figure is monospace** (IBM Plex Mono, tabular figures) so columns of money
   line up. Instrument Sans for everything you read.
3. **Green and red are RESERVED.** `--credit` = gets money back, `--debit` = owes.
   Never used for branding; "delete" only turns red at the moment of confirmation. In a
   money app, a red button that doesn't mean "you owe" teaches people to misread the one
   place it does.

Totals are ruled off with a **3px double rule** — the accountant's "this figure is
final". It marks both on-screen invariants: balances summing to zero, and shares summing
to the exact expense.

**All colour is a token.** The palette lives in CSS custom properties at the top of
`app/globals.css` and reaches Tailwind through `@theme inline`. No component file
contains a hex value. That is why the whole app was rethemed from navy to teal by
editing ~25 lines. **If you find yourself typing `bg-teal-600` in a screen, stop and add
a token instead.**

Current light palette: teal `#0b7d73`, coral `#c9472f` (settle/pay **only**), cream
ground `#faf7f2`. Both fills clear WCAG AA against white text (5.01:1 and 4.75:1).

### Regenerating the icons

`public/icon.svg` is the **source of truth**. The five PNGs and `favicon.ico` are
generated from it — never hand-edited. The generator uses `sharp` (which ships
transitively with Next) and lives outside the repo; it:

- renders `icon-192`, `icon-512`, `apple-touch-icon` (180) from the SVG as-is;
- renders the **maskable** pair by wrapping the artwork in a `scale(0.7)` transform about
  the centre, because Android crops to a circle of ~80% width;
- writes `favicon.ico` by hand-assembling an ICO container (6-byte header + 16-byte
  directory entry + a 32×32 PNG payload).

If you change the palette, change the SVG and re-run it. Don't edit PNGs.

---

## 5. How this project was built, step by step

The build followed **TRD Section 12**, one step per working session, each verified before
moving on. In order:

1. **Database** — schema, RLS, balance engine, plus the acceptance test.
2. **Next.js skeleton** + private GitHub repo + Vercel pipeline.
3. **Magic-link auth** + profile bootstrap trigger + route protection.
4. **Groups** — create, members, placeholders, invite links.
5. **Expenses** — create/edit/soft-delete, equal split, exact paise rounding.
6. **Balances screen** — nets + simplified who-pays-whom. (Read-only step: no schema
   changes allowed.)
7. **UPI settle-up** — the differentiator.
8. **Installable PWA.**

Then, after v1 was feature-complete:

- **Read-only security audit** (changed nothing, findings labelled A1–A6).
- **A1 fix** — settlement hardening. See below.
- **Group archive** (soft delete).
- **Docs housekeeping** — DECISIONS_AND_BACKLOG.md and PROGRESS.md brought into the repo.
- **Design pass** — the Khata identity, one token system, new type, new icon, all 9
  screens (`9d89434`).
- **Retheme** to teal/coral/cream, light mode only (`97b9fbe`).
- **Contrast + icon fix** (`52fb194`).

### The A1 fix — the most important security work

The audit found that the *RPCs* enforced the settlement rules, but the *RLS policies*
didn't. Anyone who called PostgREST directly, bypassing our RPCs, could forge a
settlement — claim someone else had paid them, or confirm a payment they hadn't received.
The RPCs were a front door with a good lock next to an open window.

The fix moved the rules into the policies themselves, plus **column-level grants**:

```sql
revoke update on public.settlements from authenticated;
grant update (status, confirmed_at) on public.settlements to authenticated;
```

This is a technique worth remembering: **RLS `WITH CHECK` only sees the proposed row, so
it cannot express "this field must not change."** A column grant can. That is what
freezes the amount, the payer and the payee after insert.

27 attack tests pass against it. Two consequences to know about:

- **Confirmation is now one-way.** A confirmed settlement can't be un-confirmed through
  the app. Intentional for a financial record. If you ever genuinely need to undo one, it
  must be a deliberate, auditable RPC — not a loosened policy.
- **`upi_ref` can't be written after insert.** If you later want to store the real UPI
  transaction reference, write it at insert time or add it to the column grant.

### Why "delete group" became "archive"

The owner asked for a delete feature. It turned out a **hard delete is genuinely
impossible** with this schema: `groups` cascades to both `group_members` and `expenses`,
but `expense_splits.member_id → group_members` is `ON DELETE NO ACTION`. Postgres removes
the member rows while splits still reference them, so any group with expenses simply
refuses to delete. This was tested, not assumed.

So delete is a soft delete (`groups.archived_at`), creator-only. A database trigger
rejects writes to `group_members`, `expenses` and `settlements` in an archived group —
**which means an invite link shared months ago also stops working**, not just the UI.
Nothing is destroyed; clearing `archived_at` brings the group back intact.

The `groups_delete` policy in `splitapp.sql` is therefore effectively dead code.

---

## 6. How we work — the rituals

These were followed on every single session. They are the reason the project is in good
shape, and they should continue.

### The hard rules

1. **Never edit `splitapp.sql` or an existing migration.** Ever. Changes are always a
   **new additive migration**. The base schema was validated before any code was written
   and is treated as frozen.
2. **`npm run test:acceptance` must stay at 51 passed / 0 failed.** Run it after any
   change that touches the database. It is the regression net.
3. **New RPCs follow the house pattern:** `set search_path = public`, `grant execute` to
   `authenticated` **only**, `revoke` from `PUBLIC`.
4. **Never disable RLS. Never expose a table without a policy. Never change an existing
   function's DEFINER/INVOKER setting.**
5. **Nothing from TRD Section 11.** No custom server, no chat, no Redis/Kafka, no
   microservices, no payment gateway.
6. **Secrets never enter chat, screenshots or commits.** `.env.local` stays gitignored.
   Keys are never prefixed `NEXT_PUBLIC_`, never imported into a client component. The
   `.gitignore` is re-checked periodically to make sure nothing quietly changed.
7. **One step at a time.** Finish and verify a step before starting the next.

### The verification ritual

Every step ended the same way, and this is the part worth keeping:

- Run the build. Run the acceptance test. Run lint.
- **Verify against reality, not against intention.** Probe the live URL, query the actual
  database, decode the actual bytes. Several bugs were found only this way — the PWA
  wasn't installable because the middleware matcher was swallowing
  `/manifest.webmanifest`, `/sw.js` and `/offline.html` and returning the login page for
  all three. Nothing in the code looked wrong.
- Check `git status` and confirm no `.env` file is staged **before** every commit.
- Commit with `git commit -F <file>` — **never** `-m` with a here-string. PowerShell
  mangles embedded quotes and splits the message.
- Push, then confirm the deploy went live.
- Offer to update PROGRESS.md and DECISIONS_AND_BACKLOG.md with what happened.

### The commit-message style

Long, explanatory commit messages. They say what changed, **why**, what was deliberately
not changed, and any consequence the change created. `git log` is part of the project's
memory, and several of these messages are the only record of a decision.

### The honesty rule

This one matters more than it sounds. Throughout the project, when something was wrong it
was said plainly and corrected:

- A "verification" that turned out to be reading garbage (PowerShell stripped quotes
  inside a `gh --jq` call) was **explicitly retracted** and re-run properly.
- A test assertion that was simply wrong (`100.5 * 100` is exactly representable, so it
  proved nothing) was corrected to `19.99`, which genuinely breaks.
- A step-5 report told the owner to verify per-person shares in the UI when that data was
  never displayed anywhere. That was acknowledged as a bad report, not quietly fixed.
- The teal retheme introduced a WCAG contrast regression. It was flagged in the same
  breath as delivering the work, with the numbers computed rather than eyeballed.

**Report what actually happened, including when it's your own mistake.** A handoff built
on optimistic reporting is worse than no handoff.

---

## 7. Traps already hit — don't pay for these twice

| Trap | What actually happens | Answer |
|------|----------------------|--------|
| Supabase direct DB host | IPv6-only; this machine has no IPv6 egress | Use the **session pooler** host |
| Password in connection URI | `@` breaks the URI | Percent-encode (`%40`) |
| `supabase link` | Needs a Personal Access Token | Use `supabase db push --db-url` |
| `service_role` in the acceptance test | It has no table grants, and it bypasses RLS anyway | Test with a **real authenticated member JWT** — stronger, and it exercises the policies |
| Magic link in another browser | PKCE verifier isn't there | Implicit flow + **client** callback page reading the fragment |
| Middleware matcher | Swallowed `/manifest.webmanifest`, `/sw.js`, `/offline.html` → PWA silently not installable | Exclude them in the matcher |
| Static `sw.js` | Identical bytes every deploy → never updates | Serve from a route handler with the commit SHA |
| `has_function_privilege` | Can't parse `pg_get_function_identity_arguments` (it includes parameter names) | Use the OID overload |
| `tsx` + `.ts` scratch scripts | Treated as CJS; top-level `await` fails | Name them `.mts` / `.mjs` |
| PowerShell here-strings for commit messages | Embedded quotes split the argument | `git commit -F <file>` |
| `git push` asking for a username | — | `gh auth setup-git` |
| Picking a mid-tone brand colour | "Looks fine" can be 3.3:1 | Compute the contrast ratio before shipping |

---

## 8. Where things stand right now

**v1 is feature-complete, secured, themed and deployed.** The full loop works on a real
phone: create a group → add people including those not on the app → split expenses → see
who owes whom → tap once to pay over UPI → confirm → balances clear.

- Latest commit: `52fb194`, pushed to `main`, live on Vercel. Working tree clean.
- Acceptance test: **51 passed, 0 failed.** Build clean. Lint clean.
- 6 tables, 21+ policies, 7 migrations, all applied and in sync.
- Data integrity verified: 0 orphans, every group's balances sum to exactly ₹0.00.
- Money path hardened at the database (A1), 27 attack tests passing.

**The one loose end from the retheme:** dark mode is still the old Khata navy. Only the
`:root` light block was rethemed, so the app is teal by day and navy by night. `--accent`
isn't redefined in the dark block either, so coral inherits dark mode's charcoal
`--on-fill` instead of white.

**Two owner-side items, unrelated to code:**
- Reinstall the PWA on the phone (uninstall first) — the launcher icon and splash only
  refresh on a fresh install.
- Display names are full usernames (`chaudharyshabbirali88`) and truncate on every
  balance row. Shortening them in Profile improves the app more than any palette change.

---

## 9. The plan forward

**In order.**

1. **Finish the dark-mode retheme.** One edit to `app/globals.css`, no component changes.
   Pick teal/coral equivalents for `--brand`, `--brand-hover`, `--brand-soft`, the
   grounds and the rules; redefine `--accent` for a dark ground. Check contrast **both
   ways** — dark mode's `--on-fill` is charcoal, not white.

2. **Real email delivery — this is a HARD GATE.** Supabase's built-in email only reliably
   reaches the owner's own address and is rate-limited to roughly 2–3/hour. **Nobody else
   can log in until this is fixed.** The path: buy a cheap domain → verify it in Resend →
   connect Resend as Supabase's SMTP sender. Resend's free tier without a verified domain
   only emails your own address, so the domain is not optional. The login flow itself
   already works.

3. **Put it in real hands.** The owner's own flat or friend group. Learn from it.

4. **Before a public launch** (all tracked in DECISIONS_AND_BACKLOG.md §4):
   - **A5 — account deletion.** Currently blocked by `ON DELETE NO ACTION` on profile
     references. Recommended approach: **anonymise** the person (blank name/email/UPI)
     but **keep their ledger rows**, so everyone else's balances stay correct.
   - Privacy policy + basic terms.
   - Backups / recovery plan — know Supabase's retention before real financial history
     exists. Losing expense history would be trust-fatal.
   - Abuse and signup controls (rate-limiting or invite-gating).

5. **Before real volume, not before first users:**
   - **A2 — missing FK indexes** on `expenses(created_by)`, `expenses(paid_by)`,
     `groups(created_by)`, `settlements(from_member)`, `settlements(to_member)`. The two
     `settlements` ones matter most: `group_balances()` scans them on every render.
   - **A3 — `auth_rls_initplan`.** Change `auth.uid()` to `(select auth.uid())` in
     policies so Postgres evaluates once per query rather than per row. Bundle with A2.

6. **Nice to have, will eventually bite:** an "Archived groups" / un-archive screen.
   Archiving works but there is no way back through the UI — recovery currently needs
   manual SQL. Needs a creator-only list plus an `unarchive_group` RPC.

7. **Hygiene:** A4 — helper functions carry the default PUBLIC execute grant. Verified
   harmless (anonymous callers get nothing), tighten eventually.

### The biggest risk

It is not a bug. **It is polishing forever and never shipping to real users.** "Slightly
rough but used by 5 real flatmates" beats "perfect but used by nobody." Item 2 above is
the only thing standing between this app and its first real user.

### The money line

The app builds a deep link. It never touches, holds or routes funds. That keeps it
entirely outside payment-aggregator licensing and PCI scope. **The day anyone suggests
handling money directly, that is a regulatory change, not a feature** — get real advice
before writing a line of it.

---

## 10. Starting a fresh AI session

Paste this at the start of a new session:

> This is SplitApp — an India-first group expense-splitting PWA. Read `HANDOFF.md`,
> then `PROGRESS.md` and `DECISIONS_AND_BACKLOG.md` in the repo root before doing
> anything.
>
> Hard rules: never edit `splitapp.sql` or any existing migration — changes are always a
> new additive migration. `npm run test:acceptance` must stay at 51 passed / 0 failed.
> New RPCs get `search_path=public`, execute granted to `authenticated` only, revoked
> from PUBLIC. Never disable RLS, never expose a table without a policy, never change a
> function's SECURITY DEFINER/INVOKER setting. Nothing from TRD Section 11. All money is
> integer paise, never floats. Colour goes in a token in `app/globals.css`, never a hex
> in a component. `.env.local` stays gitignored and secrets never appear in chat.
>
> Work one step at a time. Verify against reality — build, test, and probe the live URL
> or the actual database rather than assuming. Check `git status` for staged `.env` files
> before every commit, and commit with `git commit -F <file>` (PowerShell mangles `-m`).
> At the end of a session, offer to update `PROGRESS.md` and `DECISIONS_AND_BACKLOG.md`.
>
> Current state and what's next are in `HANDOFF.md` sections 8 and 9.

---

## 11. Keeping these documents alive

- Update the "Last updated" line whenever you edit one.
- At the end of every working session: tick off or add backlog items in
  DECISIONS_AND_BACKLOG.md, add a line to PROGRESS.md.
- When a notable decision gets made or a consequence gets discovered, write it down in
  DECISIONS_AND_BACKLOG.md §2 or §3 **at that moment**. Chat transcripts disappear —
  that is exactly why this file exists.
- HANDOFF.md itself only needs revisiting when something structural changes: a new major
  feature, a change to how we work, or a shift in the plan.
