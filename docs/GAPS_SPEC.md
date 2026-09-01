# Gap screens — implementation spec

Follow-up to the khata mobile handoff. Five pieces the first pass left
undesigned. Visual reference: `MobileAppDesignGaps.html` (light),
`MobileAppDesignGapsDark.html` (`[data-theme='dark']`, same frames). Prototype
sources: `CustomSplitScreen.jsx`, `SettleCashScreen.jsx`,
`CreateGroupScreen.jsx`, `ExpenseDetailScreen.jsx`.

Everything below is built from existing tokens and components. **One new
primitive and three new icons**, listed first.

---

## New in this pass

### `AmountCell` — the only new class

`components/forms/AmountCell.jsx` (+ `.d.ts`, `.prompt.md`). An inline rupee
input sized for the right slot of a `LedgerRow` / `CheckRow`, so a column of
typed amounts aligns with a column of read-back `Figure`s.

| | |
| --- | --- |
| Face | `--font-mono`, `tabular-nums`, `--text-body`, `--tracking-figure`, right-aligned |
| Width | fixed `108px` (prop) — one value across an editor, or the column breaks |
| Rule | `1px dashed --rule-strong` while unset · `1px solid --rule-strong` once typed · `--brand` on focus · `--debit` when `invalid` |
| Chrome | none: transparent background, no border box, no padding box. A static `₹` in `--ink-faint` sits outside the input |
| Not for | a standalone labelled amount — that stays `<Field amount prefix="₹" />` |

CSS equivalent for the product, if you prefer a class over the component:

```css
.amount-cell{display:inline-flex;align-items:baseline;justify-content:flex-end;gap:4px;width:108px;flex:0 0 auto;padding:2px 0 3px;border-bottom:1px dashed var(--rule-strong)}
.amount-cell:has(input:not(:placeholder-shown)){border-bottom-style:solid}
.amount-cell:focus-within{border-bottom-color:var(--brand);border-bottom-style:solid}
.amount-cell[data-invalid]{border-bottom-color:var(--debit)}
.amount-cell > span{font-family:var(--font-mono);font-size:var(--text-sm);color:var(--ink-faint)}
.amount-cell > input{width:100%;min-width:0;border:0;background:none;outline:none;padding:0;text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:var(--text-body);letter-spacing:var(--tracking-figure);color:var(--ink)}
.amount-cell[data-invalid] > input{color:var(--debit)}
```

### New icons (Lucide, same 1.5px outline set)

`banknote` (cash settlement) · `pencil` (edit) · `trash-2` (delete). No other
additions; `indian-rupee` still marks the UPI action.

### Token additions

None. Nothing was recoloured and no new colour was introduced.

---

## 1 · Custom split (add-expense)

The rule the whole screen serves: **a custom split must equal the expense to the
paise, and SplitApp never spreads the remainder for you.** Equal split spreads
leftover paise to the top of the list; custom does not, because the user is
asserting exact figures.

### Structure (top to bottom, unchanged from add-expense until "Split")

```
ScreenHeader  back="Goa Trip"  title="Add expense"  subtitle="Rupees, up to two decimals."
Card tone="brand"           — the amount, --text-display, mono
Field label="Description"
SelectField label="Paid by" hint="Someone who hasn’t joined can still be the payer."
SectionLabel "Split" + Segment pill [Equally | Custom]      ← Custom selected

┌ row ───────────────────────────────────────────────┐
│ SectionLabel "Between 4 people"   Button sm quiet ×2 │   Fill equally · Clear
└────────────────────────────────────────────────────┘
Card pad="none"
  Ledger
    CheckRow  ×members
      leading = Avatar (placeholder ring if not joined)
      label   = name
      note    = Chip quiet "no share"        (only when share === 0)
      right   = AmountCell                   (checked)
              | SectionLabel "not splitting" (unchecked)
  LedgerTotal label="Allocated" value=Figure(sum) bad={sum > total}

status row  (marginTop --space-3, minHeight 28)
  Chip joined  "adds up to ₹2,480.00"          when diff === 0
  Chip pending "₹0.50 left to allocate"        when diff > 0   (+ Button sm quiet "Add it to You" when diff ≤ 100 paise)
  Chip debit   "₹220.00 over the total"        when diff < 0

Notice error   — only in the over case
hint paragraph — otherwise

Button block size="lg" disabled={diff !== 0}   "Save expense"
```

### The one glance-test

The answer to "does this add up" is always in the same two places, stacked:
the **`LedgerTotal` double rule** (reddens via `bad` when over) and the **status
chip directly under it**. Three chip tones, no fourth state, no progress bar or
meter anywhere — a bar would be decoration and the figure is the fact.

### Boundaries

| Case | Behaviour | Copy |
| --- | --- | --- |
| **Initial / empty** | every cell dashed and blank (placeholder `0.00`, not a typed zero), `Allocated ₹0.00`, pending chip carries the full amount, Save dead, Clear dead | "Type what each person owes. A custom split has to add up to the exact total before you can save." |
| **Few paise short** (`0 < diff ≤ 100`) | pending chip names the shortfall; a `Button sm quiet` offers it to the first participant in one tap — the same "top of the list" rule as an equal split, offered rather than applied | "Add it to You" |
| **Short by more** (`diff > 100`) | same chip, no one-tap button (a rupee-scale gap is a typo, not a rounding artefact) | — |
| **Over-allocated** (`diff < 0`) | `LedgerTotal bad` (3px double `--debit`, `--debit-soft` fill), allocated `Figure tone="debit"`, offending cells `invalid`, debit chip, `Notice tone="error"`, Save dead | "The shares are ₹220.00 more than the expense. Reduce someone’s share, or raise the amount to ₹2,700.00." |
| **Participant at zero** | stays checked and stays on the expense with a `₹0.00` share; `Chip quiet "no share"` next to the name; cell in `tone="quiet"`. Unchecking is the different act — it removes them from the split entirely (`SectionLabel "not splitting"`) | "Set someone to ₹0.00 to keep them on the expense without a share." |
| **Switching Equally → Custom** | seed every cell with the equal share (including the paise remainder already placed), so Custom opens balanced and edits from there. Stores `share_type = 'exact'` — see "Backend work" | — |
| **Switching Custom → Equally** | discard typed values; confirm first if any cell differs from the equal share | — |

`--debit` on the over-allocation chip and cells is the same use as `Field`'s
existing `error` state: a rupee figure that is wrong, not decoration. If you
would rather keep red strictly to owed money, swap the chip to `pending` and
leave the `Notice tone="error"` to carry it — the double rule still reddens.

### Arithmetic

Integer paise throughout. `diff = total − Σ shares`, all `BigInt`. Parse each
cell as rupees with at most two decimals into paise on blur; never accumulate in
floats; never divide to fill (Fill equally uses `floor` + distribute the
remainder to the top of the list, matching the equal-split rule).

---

## 2 · Settling up with a placeholder member

**The problem.** Settlement is two-step by design: payer taps Pay, payee taps
Confirm received. A placeholder member has no account, so the second step can
never happen and the debt is unclearable.

**The resolution.** A settlement involving a placeholder is a **cash
settlement**, recorded in one step by the person on the other side of it — or by
the group admin — and it clears the balance immediately. The two-step rule is
untouched for real users; this is the off-app case only, and it is labelled as
such everywhere it appears.

Why one step is safe here: nothing is being asserted about another *account*.
The recorder is the counterparty, so they are confirming a fact about their own
money. The affirmation tick carries the weight the payee's Confirm normally
would.

### Entry point — "Who pays whom", the placeholder row

```
LedgerRow align="start"
  leading = Avatar placeholder
  title   = "You pay Rohit"
  meta    = "Not on SplitApp · no UPI ID"
  right   = Figure + Chip pending "not joined"
  below   = Button variant="accent" block icon="banknote"  "Settle in cash"
            hint: "Rohit has not joined, so no UPI link and no confirmation from him. You record this one yourself."
```

Coral is correct here: cash still moves real money. The label and the
`banknote` icon are what separate it from `Settle up with UPI` — never the
colour.

**Permission.** Only the counterparty or the group admin sees a live button.
Everyone else gets `Button variant="dead"` plus: "Only the person paying Rohit
or the group admin can record this, because Rohit cannot confirm it himself."

### The sheet — `Sheet title="Settle in cash"`

```
Card surface       Avatar placeholder · "You pay Rohit" · Chip pending "not joined" · Figure lg
Notice tone="info" "Rohit is not on SplitApp, so he can never tap “Confirm received”.
                    You confirm this one on his behalf — only after the cash has actually changed hands."
Field amount       label="Amount paid in cash" prefix="₹" default=full amount
                   hint="Change this if you paid part of it."
CheckRow           "I have given Rohit ₹700.00 in cash"   ← gates the footer button
hint               "The group sees this as a cash settlement recorded by you, not as a UPI payment."

footer
  Button accent lg block icon="banknote"  "Record ₹700.00 paid in cash"   disabled until ticked
  hint (centred) "No UPI app opens. This clears the balance the moment you record it."
```

The tick is wrapped in a `1px solid --rule-strong` / `--radius` / `--surface`
box — the one place a `CheckRow` is boxed, because it is a gate rather than a
list item.

### After recording

- **No pending state.** The settlement is confirmed on creation, because no one
  is going to confirm it. `Chip tone="pending"` must not appear on it.
- Feed / who-pays-whom row: title "You paid Rohit in cash", meta "Recorded by
  you · 31 Aug", right `Figure tone="quiet"` + `Chip joined "settled"`.
- Balances row for Rohit returns to `SectionLabel "settled up"`.
- `Notice tone="info"`: "Settled in cash. Rohit's balance is clear. Delete the
  settlement from the group feed if you recorded it by mistake." Deletion is the
  undo — there is no dispute flow, since the other party cannot dispute.

### The reverse direction

A placeholder who is **owed** money is the same flow with the payer's language
inverted: the placeholder is the payee, the real user still records it. A
placeholder who **paid** and is owed by others settles per-debtor in the normal
two-step way — those debtors have accounts. The cash path is only for the leg
that touches the account-less member.

### When a placeholder later joins

Cash settlements already recorded stay as they are, attributed to the recorder.
Say so in the join confirmation if you show a history.

---

## 3 · Create group (`groups/new`)

Matches `create-group-form.tsx` exactly — same field, same four types, same
copy, same Cancel link.

```
ScreenHeader back="All groups" title="New group"
             subtitle="Name it, say what it is for, and you are the admin."

Field  label="Group name"  placeholder="Goa Trip"  maxLength={80}  autoFocus
       hint="Everyone in the group sees this. You can rename it later."

SectionLabel "Type"
Segment pill  [Trip | Flat | Event | Other]   default trip
hint "Only changes the label on the group. It does not change how splitting works."

Notice tone="pending"   — submitting only: "Creating the group. Do not close this screen."

Button block size="lg"  disabled={!name.trim() || submitting}
       label = submitting ? "Creating…" : "Create group"
a.link centred            "Cancel"
hint  "Add members after the group exists — invite them with a link, or add someone
       who is not on SplitApp as a placeholder."
```

- **Initial:** name empty, Create dead. The `required` rule is shown as a dead
  button, not as an error after the tap.
- **Submitting:** button dead with "Creating…", pending notice, fields
  read-only. The footer hint switches to "You can add members and the first
  expense on the next screen."
- **Error** (from `state.error`): `Field error` on the name if it is about the
  name, otherwise `Notice tone="error"` above the button. Never a raw Supabase
  string.
- Segmented picker is the existing `Segment pill`; four options fit 390px at
  `--text-sm`.

---

## 4 · Expense detail (`expenses/[expenseId]`)

Grounded against `expenses/[expenseId]/page.tsx` and the `expenses` /
`expense_splits` tables. The page reads stored shares — it recomputes nothing —
so the design is a read-back of `expense_splits.share_minor` in group-member
order, which is the order the +1-paise participants were computed in.

```
ScreenHeader back="Back to group" title={description || "Expense"}
             subtitle=mono "Priya paid · 14 Aug 2026"

Card tone="brand"     SectionLabel brand "Amount" + ₹ figure at --text-display

SectionLabel "Paid by"                                   ← ADDITION, see below
Card pad="none" > Ledger > LedgerRow
    leading = Avatar(payer)   title = payer   meta = mono upi id
    right   = Figure tone="credit" sign
hint "Priya is up ₹2,480.00 on this expense and gets it back through the split below."

SectionLabel "Split 4 ways, equally"   +   Chip quiet {share_type}
Card pad="none"
  Ledger > LedgerRow ×splits, in group-member order
    title = display_name  ("You · your share" for self)
           + quiet "not joined yet" when member.user_id is null
    right = Chip quiet "paid" on the payer's row  +  Figure
            (tone="debit" on your own row only)
  LedgerTotal label="Shares add up to" value=Figure  bad={Σ ≠ amount_minor}
hint "Shares always add up to the exact amount. Any leftover paise from an uneven
      split went to the people at the top of this list."     (only when >1 share)

Button quiet block icon="pencil"  "Edit expense"
```

**Corrected against the source after the first draft:**

- Subtitle is **"Priya paid · 14 Aug 2026"** (payer + `created_at`), not
  "added by Priya". `expenses.created_by` exists but the route does not surface
  it, and neither should the design — the payer is the fact that matters.
- Heading is **"Split N ways, equally"**; the mode chip reads
  `expense_splits.share_type`, whose vocabulary is **`equal` | `exact` |
  `percentage`** — not "custom". A custom split stores `exact`.
- The payer is marked **inside** the split list with `Chip quiet "paid"`, as the
  route does. Placeholders read "not joined yet".
- When the total disagrees, the route also appends **"(expected ₹2,480.00)"** to
  the figure. Keep that — it names the number the shares should have hit.
- **Delete is not on this screen.** The route's only action is Edit; delete lives
  on the edit screen. The first draft put both here — corrected.
- **No permission gating.** `expenses_update` is `is_group_member(group_id)`:
  any member of the group may edit or delete any expense. The earlier "Only
  Priya or the group admin can change this" hint was wrong and is removed. If you
  want creator-only editing it is a policy change, not a design one.

**The one addition:** the "Paid by" block. The route states the payer in the
subtitle only. On a phone the payer is worth a row of its own — it is the credit
side of the entry, and `Figure tone="credit" sign` is literal here, not
decorative. Drop the block if you would rather stay verbatim; the subtitle and
the "paid" chip already carry the fact.

`LedgerTotal bad` is kept even though the RPCs assert the sum server-side. Same
reasoning as the route: if stored data ever disagrees, the page says so.

---

## 5 · Edit expense (`expenses/[expenseId]/edit`)

**Confirmed: it is the same form. No separate design.** Verified against
`edit/page.tsx`, which renders the shared `ExpenseForm` with
`submitLabel="Save changes"` and `initial={{ amount, description, paidBy,
participantIds }}`, plus a delete block under a hairline.

| | Add | Edit |
| --- | --- | --- |
| `ScreenHeader back` | group name | "Back to expense" |
| `title` | "Add expense" | "Edit expense" |
| `subtitle` | "Rupees, up to two decimals." | "Changing an expense recalculates everyone’s balances." |
| fields | empty / defaults | pre-filled: amount, description, payer, participants (and per-person shares once `exact` splits exist) |
| primary | "Save expense" | "Save changes" |
| dirty state | — | Save dead until something changes |
| foot | — | hairline rule, then `Button danger block` "Delete expense" |

Two notes on fidelity: the product's edit page has a bare `page-title` with no
back link and no subtitle — the back link and the recalculation line are design
additions, and the back link is worth keeping on mobile. And `initial` prefills
**participants only**, not shares, because the form is equal-split today; per-share
prefill arrives with the `exact` work in §1.

### Delete — two steps, and a soft delete

`delete-expense.tsx` is a two-step inline confirm; this design keeps the two
steps and moves the second into a `Sheet`, which is how every other confirmation
on mobile behaves.

```
Sheet title="Delete expense"
  Card sunken   the entry restated: Avatar · description ·
                mono "Priya paid · split 4 ways · 14 Aug 2026" · Figure lg
  Notice error  "This removes ₹2,480.00 from the group and from all balances.
                 An admin can restore it later."
  footer
    Button dangerSolid lg block  "Yes, delete this expense"   ("Deleting…" while pending)
    Button quiet block           "Keep it"
```

**Corrected:** the first draft said "This cannot be undone." It can —
`softDeleteExpense` flips `expenses.is_deleted`, the row stays, and the
product's own copy says an admin can restore it. The copy above is the product's
sentence plus the amount. `dangerSolid` appears here and nowhere else.

---

## Backend work these designs imply

Not design decisions, but the designs are unbuildable without them. Both were
confirmed by reading the RPCs and RLS.

**1 · Custom split needs a server-side path.** `create_expense` and
`update_expense` take `p_participants uuid[]` only, divide the amount
themselves (`v_base` + remainder to the first participants) and hardcode
`share_type = 'equal'`. Nothing writes `exact`. To ship §1 they need an
optional `p_shares bigint[]` parallel to `p_participants`: when present, insert
those values with `share_type = 'exact'` and keep the existing
"Split does not add up" assertion, which is exactly the invariant the editor's
status chip mirrors on the client. `expense_splits.share_minor` already allows
`>= 0`, so a zero share stores fine.

**2 · Cash settlements need two columns.** `settlements` has `from_member`,
`to_member`, `amount_minor`, `upi_ref`, `status` ('pending'|'confirmed'),
`confirmed_at` — no way to say "this was cash" or "this was recorded by someone
other than the payer". Suggested: `method text not null default 'upi'`
('upi'|'cash') and `recorded_by uuid references profiles(id)`. A cash settlement
is inserted with `status = 'confirmed'`, `confirmed_at = now()`,
`method = 'cash'`, `recorded_by = auth.uid()` — which is what lets the UI show
"Recorded by you" and refuse to show a pending chip.

Also note `settle_insert` / `settle_update` are `is_group_member(group_id)`:
RLS lets **any** member record or confirm a settlement. The
counterparty-or-admin rule in §2 has to be enforced in an RPC (or added to the
policy), not assumed from the schema.

## Dark mode

Nothing theme-specific was written. Every frame above is token-built, so
`[data-theme='dark']` flips it — see `MobileAppDesignGapsDark.html`. Two things
to look at when signing off the dark values: the dashed `AmountCell` rule on
`--surface` (`--rule-strong` at `#474137`), and `--debit-soft` behind the
reddened `LedgerTotal`.

## Still open

1. Dark palette values (carried from the first handoff — unchanged, still
   proposed).
2. `--debit` on the over-allocation chip / cells — accept, or keep red strictly
   to owed money and let the notice carry it (see §1).
3. Whether the group admin, as well as the counterparty, may record a cash
   settlement. The design assumes yes, and RLS currently permits any member —
   see "Backend work" above.
4. Icon set — `banknote` / `pencil` / `trash-2` are Lucide, the same substitution
   flagged in the original handoff.
