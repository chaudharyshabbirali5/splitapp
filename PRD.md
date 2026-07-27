# Product Requirements Document (PRD)
### Working title: **SplitApp** (rename freely)
**Version:** 1.0 (MVP) · **Market:** India-first · **Audience of this doc:** an AI coding assistant building the app

---

## 0. How to use this document
This is the source of truth for **what** to build. The companion **TRD** defines **how**. Rules here are binding. When something is marked **OUT OF SCOPE**, do not build it, do not scaffold it, do not add "just in case" hooks for it. If a requirement seems to call for extra infrastructure, prefer the simplest thing that satisfies it. Ask before adding anything not listed here.

---

## 1. One-line vision
A group money-splitting app where the **settle-up actually happens inside the app** via UPI — not a tracker you leave to go pay someone elsewhere.

## 2. The problem
Groups constantly share costs — flatmates on rent and bills, friends on trips, one-off dinners and events. Existing apps (e.g. Splitwise) track *who owes whom* well, but stop there: you still leave the app to actually pay. In India, where UPI makes instant free person-to-person payment universal, that gap is the whole opportunity.

## 3. Target user (v1)
Indian users in **high-frequency sharing groups** — primarily **flatmates** (rent/utilities/groceries every month) and **active friend groups**. The app must *also* handle low-frequency cases (trips, events, one-offs) because they use the identical engine, but the **first users we optimize for and expect retention from are the high-frequency ones**. Do not build separate products per use case; build one general engine.

## 4. Positioning and the single differentiator
- The one thing this app is better at than anything else: **real UPI settle-up.** Tap to pay a group member; the amount and payee are pre-filled in their UPI app; the debt clears.
- This is **not** a messenger. There is **no chat.** Do not build messaging.
- This is **not** an attempt to out-feature Splitwise on every axis. One sharp edge (settlement), applied to every use case.

## 5. Product principles (binding)
1. **Survival MVP.** Goal is a working app the founder and a few real groups can use — not a polished public launch. Ship small.
2. **One general engine.** A flat, a trip, and an event are the same thing: a group + expenses + splits + settle-up. Never fork the data model by use case.
3. **Free to run.** Everything must sit on free tiers (see TRD). No paid infrastructure in v1.
4. **Don't preclude the future.** Tag groups by type and keep the schema general so recurring expenses, more use cases, and monetization can be added later without a rebuild — but **do not build those now.**

## 6. IN SCOPE — v1 features (build exactly these)
- **F1. Auth** — sign up / log in with **email (magic link)**. No phone-number OTP.
- **F2. Create & join a group** — a group has a name and a type (`flat` | `trip` | `event` | `other`). Join via a shareable invite code/link. No SMS.
- **F3. Members, including people without an account** — a member may be a **placeholder** (just a name + optional UPI ID) who has not signed up yet. Members store a UPI ID so they can be paid.
- **F4. Add an expense** — amount, who paid, description, and split. **v1 supports EQUAL split only** in the UI (schema allows exact/percentage for later; do not build those UIs yet).
- **F5. Balances** — show each member's net position and a simplified "who pays whom" list.
- **F6. Settle up** — a button that opens the payer's UPI app pre-filled with payee + amount; then the payer marks "I paid" and the receiver confirms.

## 7. OUT OF SCOPE — v1 (do NOT build)
Each of these is deliberately excluded. Do not scaffold them.
- Any **chat / messaging** feature.
- **Automatic recurring expenses** (users can re-add manually for now).
- **Exact / percentage / shares** split UIs (equal only for v1).
- **Multi-currency** (INR only).
- **Receipt scanning / OCR**, category dashboards, charts, CSV/PDF export.
- **Push notifications** (use in-app + shareable links only).
- **Native iOS/Android apps** (ship as a PWA — see TRD).
- **In-app payment processing / holding money / payment-gateway or PA integration** (settlement is a UPI deep link only; the app never touches funds).
- **Automated payment confirmation** from UPI (confirmation is manual — payer marks paid, receiver confirms).

## 8. Key user flows
1. **New group:** User creates a group -> picks a type -> adds members (some real, some placeholder names) -> shares an invite link.
2. **Log a shared cost:** Any member adds an expense (amount, payer, equal split across selected members) -> balances update.
3. **See what's owed:** Balances screen shows each person's net (owed to them / owed by them) and a minimal list of "A pays B Rs.X".
4. **Settle:** Debtor taps "Settle with B" -> UPI app opens pre-filled -> debtor pays -> taps "I paid" -> B confirms -> balance clears.
5. **Pull in a non-user (growth loop):** A placeholder member who owes money receives a shared link showing what they owe; opening/claiming it prompts them to sign up.

## 9. The growth loop (the most important product mechanic)
When an expense involves someone **not yet on the app**, that person can be sent a link showing what they owe. Seeing they owe money is the pull to sign up. **The placeholder-member model (F3) exists to enable this.** Track, later, "% of signups that came from an owe-money link" as the core growth metric. (Building analytics is out of scope for v1; just don't break the mechanic.)

## 10. Success criteria for v1
- The founder and at least 2-3 real groups (a flat and/or a trip) can run their actual shared expenses through it end-to-end, including at least one real UPI settle-up.
- Balances are always correct (see the sum-to-zero invariant in the TRD).
- No user can ever see or modify another group's data (see the security model in the TRD).

## 11. Monetization (context only — nothing to build in v1)
Future direction is **not** a fee on settlements (UPI P2P is zero-MDR in India — legally can't skim it) but adjacencies (e.g. travel/booking affiliate for trip groups) and possibly a small subscription for heavy/flatmate users. **Build none of this now.** Just don't design anything that forecloses it.

## 12. Non-goals (say no to these even if asked mid-build)
- Becoming a messenger or adding chat.
- Matching Splitwise feature-for-feature.
- Supporting currencies other than INR.
- Any server you have to run yourself, any message queue, any microservices (see TRD anti-architecture).
