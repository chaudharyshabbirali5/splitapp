'use client';

import { Banknote, Bell, Smartphone } from 'lucide-react';
import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { paiseToAmountString } from '@/lib/money';

import { recordFriendCashSettlement, type FriendSettleState } from './settle-actions';

function RecordButton({ amount, enabled }: { amount: string; enabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || !enabled}
      className="btn btn-accent btn-lg btn-block"
    >
      <Banknote size={16} strokeWidth={1.5} aria-hidden="true" />
      {pending ? 'Recording…' : `Record ₹${amount} in cash`}
    </button>
  );
}

/**
 * The settle affordance for a friend tab.
 *
 * WHICH CONTROL APPEARS IS DECIDED BY WHAT THE BACKEND CAN ACTUALLY DO. Three
 * cases, and only the first is fully live:
 *
 *   placeholder tab   Cash, both directions. record_cash_settlement accepts it
 *                     because one party has user_id NULL, and this is the ONLY
 *                     way such a debt can ever clear — the other person has no
 *                     account and can never tap "Confirm received".
 *
 *   real tab, you owe UPI settle-up exists as a backend path
 *                     (record_settlement -> confirm_settlement) but has no UI
 *                     outside the group balances screen, and building a second
 *                     one is commit (c)'s stated non-goal. Shown dead, with the
 *                     reason, rather than routed somewhere that cannot complete.
 *
 *   real tab, they owe No pay button at all — record_settlement's rule is "you
 *                     can only say I paid about yourself", so a button here
 *                     would call it in the wrong direction and hit 42501.
 *                     A Remind affordance stands in its place, and Remind has no
 *                     delivery mechanism (no mailer, no push — the notifications
 *                     decision), so it is dead too and says so.
 *
 * A control that cannot do anything is never shown as if it can.
 */
export function FriendSettle({
  groupId,
  myMemberId,
  counterpartyMemberId,
  counterpartyName,
  isPlaceholder,
  netMinor,
}: {
  groupId: string;
  myMemberId: string;
  counterpartyMemberId: string;
  counterpartyName: string;
  isPlaceholder: boolean;
  netMinor: string; // serialised bigint — Server Components cannot pass bigint
}) {
  const net = BigInt(netMinor);
  const iOwe = net < 0n;
  const amountMinor = net < 0n ? -net : net;
  const amount = paiseToAmountString(amountMinor);

  // The payer is whoever is down. record_cash_settlement checks both parties
  // belong to the group and that one is a placeholder; it does not care which
  // direction, so both are offered.
  const fromMemberId = iOwe ? myMemberId : counterpartyMemberId;
  const toMemberId = iOwe ? counterpartyMemberId : myMemberId;

  const [open, setOpen] = useState(false);
  const [affirmed, setAffirmed] = useState(false);
  const [state, formAction] = useActionState<FriendSettleState, FormData>(
    recordFriendCashSettlement.bind(null, groupId, fromMemberId, toMemberId),
    {},
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  // ---- real tab, they owe you: no pay button, a Remind that cannot deliver ----
  if (!isPlaceholder && !iOwe) {
    return (
      <div className="flex flex-col gap-2">
        <button type="button" disabled className="btn btn-dead btn-block">
          <Bell size={16} strokeWidth={1.5} aria-hidden="true" />
          Remind {counterpartyName}
        </button>
        <p className="hint">
          Only {counterpartyName} can record this payment, so there is nothing for you
          to settle here. Reminders aren&rsquo;t built yet &mdash; for now, ask them
          the usual way.
        </p>
      </div>
    );
  }

  // ---- real tab, you owe: UPI is the right path, but has no screen here yet ----
  if (!isPlaceholder && iOwe) {
    return (
      <div className="flex flex-col gap-2">
        <button type="button" disabled className="btn btn-dead btn-block">
          <Smartphone size={16} strokeWidth={1.5} aria-hidden="true" />
          Settle up with UPI
        </button>
        <p className="hint">
          Paying {counterpartyName} through UPI isn&rsquo;t wired into this screen yet.
          Cash settle-up is only for people who aren&rsquo;t on SplitApp, because they
          can&rsquo;t confirm a payment themselves.
        </p>
      </div>
    );
  }

  // ---- placeholder tab: cash, both directions, fully live ----
  const payerLabel = iOwe ? 'You pay' : `${counterpartyName} pays`;
  const payeeLabel = iOwe ? counterpartyName : 'you';

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => setOpen(true)} className="btn btn-accent btn-block">
        <Banknote size={16} strokeWidth={1.5} aria-hidden="true" />
        Mark settled (cash)
      </button>
      <p className="hint">
        {counterpartyName} isn&rsquo;t on SplitApp, so there&rsquo;s no UPI link and no
        confirmation from them. You record this one yourself.
      </p>

      {open && (
        <>
          <div
            className="sheet-scrim"
            data-open="true"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            className="sheet"
            data-open="true"
            role="dialog"
            aria-modal="true"
            aria-labelledby="friend-cash-title"
          >
            <div className="sheet-grip" />
            <h2 id="friend-cash-title" className="khata-label">
              Mark settled in cash
            </h2>

            {/* The debt restated, so what is being cleared is on screen at the
                moment of recording. */}
            <div className="card mt-3 flex items-center gap-3">
              <span className="avatar avatar-placeholder size-9 shrink-0 text-sm" aria-hidden="true">
                {counterpartyName.trim().charAt(0).toUpperCase() || '?'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {payerLabel} {payeeLabel}
                </span>
                <span className="chip chip-pending mt-1 inline-flex">not joined</span>
              </span>
              <span className="figure shrink-0 text-lg font-semibold">₹{amount}</span>
            </div>

            {/* Brand-tinted, deliberately not the error tone: nothing is wrong
                here, and red stays reserved for owed money. */}
            <p className="card card-brand mt-3 text-sm">
              {counterpartyName} is not on SplitApp and can never tap &ldquo;Confirm
              received&rdquo;. You record this on their behalf &mdash; only after the cash
              has actually changed hands.
            </p>

            <form action={formAction} className="mt-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="friend-cash-amount" className="field-label">
                  Amount paid in cash
                </label>
                <div className="flex items-center gap-2">
                  <span className="figure text-sm text-ink-faint">₹</span>
                  <input
                    id="friend-cash-amount"
                    name="amount"
                    inputMode="decimal"
                    required
                    defaultValue={amount}
                    className="field field-amount"
                  />
                </div>
                <p className="hint">Change this if only part of it was paid.</p>
              </div>

              {/* A gate, not a list item: this tick carries the weight the other
                  person's Confirm normally would. */}
              <label className="flex cursor-pointer items-start gap-3 border border-rule-strong bg-surface p-3">
                <input
                  type="checkbox"
                  name="affirm"
                  checked={affirmed}
                  onChange={(e) => setAffirmed(e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-brand"
                />
                <span className="text-sm">
                  {iOwe
                    ? `I have given ${counterpartyName} ₹${amount} in cash`
                    : `${counterpartyName} has given me ₹${amount} in cash`}
                </span>
              </label>

              {state.error && (
                <p className="notice-error" role="alert">
                  {state.error}
                </p>
              )}

              <RecordButton amount={amount} enabled={affirmed} />

              <p className="hint text-center">
                No UPI app opens. This clears the tab the moment you record it.
              </p>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="link-back w-full text-center"
              >
                Cancel
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
