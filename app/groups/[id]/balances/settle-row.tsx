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
      className="w-full rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
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
        className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        Settle up
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      {upiHref ? (
        <>
          <a
            href={upiHref}
            className="block w-full rounded-md bg-zinc-900 px-4 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Pay ₹{amount} with UPI
          </a>
          <p className="text-xs text-zinc-500">
            Opens your UPI app. Only works on a phone with a UPI app installed — on a
            computer nothing will happen.
          </p>
        </>
      ) : (
        <>
          <button
            type="button"
            disabled
            className="w-full cursor-not-allowed rounded-md bg-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-500 dark:bg-zinc-800"
          >
            No UPI ID for {payeeName}
          </button>
          <p className="text-xs text-zinc-500">
            Ask {payeeName} to add a UPI ID to their profile, or pay them another way and
            still record it below.
          </p>
        </>
      )}

      <form action={formAction} className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <label htmlFor={`amt-${toMemberId}`} className="block text-xs font-medium">
          Amount actually paid
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-500">₹</span>
          <input
            id={`amt-${toMemberId}`}
            name="amount"
            inputMode="decimal"
            required
            defaultValue={amount}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100"
          />
        </div>
        <p className="text-xs text-zinc-500">
          Change this if you paid less. {payeeName} has to confirm before it counts.
        </p>

        {state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}

        <MarkPaidButton amount={amount} />
      </form>

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="w-full text-center text-xs underline underline-offset-4 text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-white"
      >
        Cancel
      </button>
    </div>
  );
}
