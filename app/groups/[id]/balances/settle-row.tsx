'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { paiseToAmountString } from '@/lib/money';
import { buildUpiLink, settleNote } from '@/lib/upi';

import { recordSettlement, type SettleState } from './settle-actions';

function MarkPaidButton({ amount }: { amount: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn btn-quiet btn-block"
    >
      {pending ? 'Recording…' : `I've paid ₹${amount}`}
    </button>
  );
}

/**
 * The settle-up control for one "you pay X" row. Rendered only when the current
 * user is the payer — you cannot pay off, or claim to have paid, someone else's
 * debt.
 */
export function SettleRow({
  groupId,
  groupName,
  fromMemberId,
  toMemberId,
  payeeName,
  payeeUpiId,
  amountMinor,
}: {
  groupId: string;
  groupName: string;
  fromMemberId: string;
  toMemberId: string;
  payeeName: string;
  payeeUpiId: string | null;
  amountMinor: string; // serialised bigint — Server Components cannot pass bigint
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<SettleState, FormData>(
    recordSettlement.bind(null, groupId, fromMemberId, toMemberId),
    {},
  );

  const amount = paiseToAmountString(BigInt(amountMinor));

  const upiHref = payeeUpiId
    ? buildUpiLink({
        payeeVpa: payeeUpiId,
        payeeName,
        amountMinor: BigInt(amountMinor),
        note: settleNote(groupName),
      })
    : null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-primary btn-block"
      >
        Settle up
      </button>
    );
  }

  return (
    <div className="space-y-3 border-l-2 border-brand pl-3">
      {upiHref ? (
        <>
          <a href={upiHref} className="btn btn-primary btn-block">
            Pay ₹{amount} with UPI
          </a>
          <p className="hint">
            Opens your UPI app. Only works on a phone with a UPI app installed — on a
            computer nothing will happen.
          </p>
        </>
      ) : (
        <>
          <button type="button" disabled className="btn btn-dead btn-block">
            No UPI ID for {payeeName}
          </button>
          <p className="hint">
            Ask {payeeName} to add a UPI ID to their profile, or pay them another way and
            still record it below.
          </p>
        </>
      )}

      <form action={formAction} className="space-y-2 border-t border-rule pt-3">
        <label htmlFor={`amt-${toMemberId}`} className="khata-label block">
          Amount actually paid
        </label>
        <div className="flex items-center gap-2">
          <span className="figure text-sm text-ink-faint">₹</span>
          <input
            id={`amt-${toMemberId}`}
            name="amount"
            inputMode="decimal"
            required
            defaultValue={amount}
            className="field field-amount"
          />
        </div>
        <p className="hint">
          Change this if you paid less. {payeeName} has to confirm before it counts.
        </p>

        {state.error && <p className="text-sm text-debit">{state.error}</p>}

        <MarkPaidButton amount={amount} />
      </form>

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="link-back w-full text-center"
      >
        Cancel
      </button>
    </div>
  );
}
