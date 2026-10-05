# Friends — Path A Lookup Paper Design (find a SplitApp user by handle)

**Status:** Paper design for review. No SQL written or pushed. `supabase db push`
is a production deployment against the single live-prod project; nothing here runs
until approved on paper.

**Call it M5.** Independent of M4 (lifecycle) — either can land first. Depends on
M1–M3, in prod.

**One-line scope:** make the already-built "UPI ID or phone number" field on the
Add-a-friend screen real, so you can look up an existing SplitApp user by their
*exact* handle and open a tab with them. The tab-creation half (`create_friend_tab`)
already exists from M2 and is idempotent — **this feature is just the lookup RPC
plus wiring the stub screen to it.** Small backend, big privacy surface.

---

## 1. The problem this design is actually solving

A "find a user by identifier" function is, by default, also a "tell me who is on
SplitApp" function — and in a UPI-first app, a careless version is a name-and-UPI
harvester, which is raw material for UPI phishing. So the design is *mostly* about
what shape keeps it from being abusable. The feature is easy; the guardrails are
the work.

## 2. Decisions locked this session (carried in)

- **Exact match only.** No partial match, no prefix, no search-as-you-type, no
  results *list*. You get a single hit only if you type the person's **full** UPI
  ID (or full phone). You can confirm someone whose handle you already know; you
  cannot fish for strangers. This is the single biggest anti-abuse lever and it's
  locked.
- **Build fully now, Resend last.** The RPC is built and tested against the two
  existing accounts now; it simply won't find a stranger until Resend lets strangers
  sign up. Real work now, real-user payoff after Resend.
- **UPI-only — no phone.** `profiles` has no phone column (confirmed by product
  owner; Claude Code re-verifies against live schema as a formality). So v1 lookup
  is UPI-ID exact-match only, and the screen's **"UPI ID or phone number" label and
  the `98765 43210` placeholder are trimmed to UPI-only** — the copy must not
  promise a phone path the backend doesn't have. This copy change ships with M5.

## 3. Open design recommendations (confirm at review)

- **Return the minimum.** On a hit, return only what's needed to show "Found: Asha
  S." and create the tab: `user_id` (profiles id) + `display_name`. **Never** the
  UPI, email, or any other profile field — the caller already typed the only handle
  they get back. A function that returns more would still pass every test (it
  "works"), so this is verified by reading the signature, not by the suite. *Baked
  into the contract below.*
- **Discoverability opt-out is v2.** For v1, being findable by your exact handle
  *is* the feature, so default-on is correct. A "don't let people find me by my
  handle" profile toggle is the obvious later lever; noted, not built.
- **No rate-limit infra in v1.** Exact-match already defeats casual fishing. True
  automated probing (scripting a dictionary of handles) isn't stopped by exact
  match alone, but rate-limiting needs infra we don't have yet. *Recommendation:*
  accept this for v1 with eyes open, log it as a known v2 item. Flag if you'd rather
  gate the feature on it.

---

## 4. Step 0 — the read-only investigation that shapes the contract (Claude Code)

Phone is already settled: **no phone column exists** (product owner confirmed) →
v1 is UPI-only and the screen copy trims (§2). Claude Code confirms this against
live schema in passing, but it's not an open question.

The one real **pre-SQL check that shapes the contract:**

- **How is `upi_id` stored and normalized?** Case, whitespace, any existing
  constraint or uniqueness. UPI IDs are effectively case-insensitive, so matching
  needs a normalization (lower + trim) applied **identically** to the stored value
  and the input, or exact match silently fails on `Asha@Bank` vs `asha@bank`.
  Report whether `upi_id` is unique in `profiles` — if it isn't, "exact match"
  could return >1 row and the function must define what it does then (see §5, step
  4: ambiguous handle → treated as not-found, never a guess).

Report that, then the contract below is finalized against the real column rather
than an assumption about it.

---

## 5. The RPC

`find_friend_by_handle(p_handle text)` → at most one row `(user_id uuid,
display_name text)`; **empty result = not found** (never an error, so "no such
user" and "user exists" look identical to the caller beyond the single bit they
already typed).

Envelope: `SECURITY DEFINER`, `set search_path = public`, `revoke all from public`,
`grant execute to authenticated`. DEFINER is **required and is the sensitive part**:
`profiles` RLS stops a user reading other users' rows, so the lookup must run as
definer to see across the table — which is exactly why the body must be airtight
about returning *only* the two minimal columns and *only* on an exact normalized
match.

Body, in order:

1. Normalize `p_handle` (lower + trim), per the §4 finding.
2. Match against the normalized `upi_id`, **equality only** — no `like`, no `%`, no
   prefix. (No phone branch — it doesn't exist.)
3. **Exclude self:** if the only match is the caller, return empty (the Add-a-friend
   flow can't target yourself; `create_friend_tab` would reject it anyway).
4. If `upi_id` turns out non-unique (§4), return empty rather than an arbitrary
   row — ambiguous handle is treated as not-found, never a guess. (Flag at review
   if you'd rather it error; empty is the safer default.)
5. Return `user_id`, `display_name`. Nothing else — no UPI, no email, no phone.

**What the client does with it** (no new backend): on a hit, show "Found:
<display_name>" + a confirm button → call the existing `create_friend_tab(user_id)`.
Already-friends is handled for free — `create_friend_tab` is idempotent and returns
the existing tab's id, so confirming twice just lands you on the same tab.

---

## 6. What we explicitly do NOT change

- `create_friend_tab` — reused as-is; this feature adds a lookup in front of it.
- `profiles` table and its RLS — untouched; the DEFINER function reads across it in
  a tightly-scoped way instead of loosening any policy.
- No new columns anywhere (unless §4 surprises us — not expected).

---

## 7. Prod-safety summary

- Read-only, additive function; no table or policy change. Among the lowest-risk
  migrations in the project.
- DEFINER + `set search_path = public` is **security-critical here specifically** —
  eyeball the header at review; a missing `search_path` passes every test and is
  still a vulnerability.
- `revoke all from public`, `grant execute to authenticated`.
- The minimal-return rule is the thing that can't be caught by a passing test —
  a function that *works* and also leaks UPI would be green. Verify the `returns`
  columns are exactly `(user_id, display_name)` by reading the signature, not by
  trusting the tests.

## 8. Tests to add before merge (against prod suite, seed → assert → teardown)

- Exact UPI → returns the right `user_id` + `display_name`, and **no other field**
  (assert the row has exactly two columns / the UPI is absent).
- Case/whitespace variant of a real UPI → still matches (normalization works).
- Partial / prefix / substring of a real UPI → **zero rows** (exact-match proof —
  this is the anti-fishing guarantee, test it hard).
- A handle that matches no one → zero rows, **no error**.
- Caller's own handle → zero rows (self-exclusion).
- End-to-end: lookup hit → `create_friend_tab(user_id)` → tab appears in
  `my_friend_positions()` for both sides (proves the stub screen's real path works).
- The function has no phone branch, and the Add-a-friend screen copy reads UPI-only
  (no "or phone number", no phone placeholder) — backend and copy agree.
