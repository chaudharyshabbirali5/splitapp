'use client';

import { Banknote } from 'lucide-react';
import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { paiseToAmountString } from '@/lib/money';

import { recordCashSettlement, type SettleState } from './settle-actions';

function RecordButton({ amount, enabled }: { amount: string; enabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || !enabled}
      className="btn btn-accent btn-lg btn-block"
    >
      <Banknote size={16} strokeWidth={1.5} aria-hidden="true" />
      {pending ? 'Recording…' : `Record ₹${amount} paid in cash`}
    </button>
  );
}

/**
 * The cash path, for a debt whose counterparty is a placeholder.
 *
 * A placeholder has no account, so the two-step flow's second step can never
 * happen and the debt would be unclearable. This records it in ONE step,
 * confirmed on creation.
 *
 * `canRecord` must mirror record_cash_settlement exactly: the RPC accepts only
 * the counterparty or the group admin, and only when a party is a placeholder.
 * Offering a live button to anyone else would produce a server error on tap;
 * hiding it from someone the RPC accepts would block a legitimate action.
 */
export function CashSettleRow({
  groupId,
  fromMemberId,
  toMemberId,
  payerName,
  payeeName,
  amountMinor,
  canRecord,
  viewerIsPayer,
}: {
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  payerName: string;
  payeeName: string;
  amountMinor: string; // serialised bigint — Server Components cannot pass bigint
  canRecord: boolean;
  viewerIsPayer: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [affirmed, setAffirmed] = useState(false);
  const [state, formAction] = useActionState<SettleState, FormData>(
    recordCashSettlement.bind(null, groupId, fromMemberId, toMemberId),
    {},
  );

  const amount = paiseToAmountString(BigInt(amountMinor));

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

  // 2d: the row still shows the control, but dead, so a bystander can see WHY
  // this debt is stuck rather than finding no affordance at all.
  if (!canRecord) {
    return (
      <div className="mt-3 flex flex-col gap-2">
        <button type="button" disabled className="btn btn-dead btn-block">
          <Banknote size={16} strokeWidth={1.5} aria-hidden="true" />
          Settle in cash
        </button>
        <p className="hint">
          Only the person paying {payeeName} or the group admin can record this, because{' '}
          {payeeName} cannot confirm it himself.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-accent btn-block"
      >
        <Banknote size={16} strokeWidth={1.5} aria-hidden="true" />
        Settle in cash
      </button>
      <p className="hint">
        {payeeName} has not joined, so no UPI link and no confirmation from{' '}
        {payeeName}. You record this one yourself.
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
            aria-labelledby="cash-settle-title"
          >
            <div className="sheet-grip" />
            <h2 id="cash-settle-title" className="khata-label">
              Settle in cash
            </h2>

            {/* The debt restated, so what is being cleared is on screen at the
                moment of recording. */}
            <div className="card mt-3 flex items-center gap-3">
              <span
                title={payeeName}
                className="avatar avatar-placeholder size-9 text-sm"
              >
                {payeeName.trim().charAt(0).toUpperCase() || '?'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {viewerIsPayer ? 'You pay' : `${payerName} pays`} {payeeName}
                </span>
                <span className="chip chip-pending mt-1 inline-flex">not joined</span>
              </span>
              <span className="figure shrink-0 text-lg font-semibold">₹{amount}</span>
            </div>

            {/* Brand-tinted, deliberately NOT the error tone: nothing is wrong
                here. .notice-info does not exist in globals.css and this commit
                adds no CSS, so the shipped brand surface carries it. Red stays
                reserved for owed money. */}
            <p className="card card-brand mt-3 text-sm">
              {payeeName} is not on SplitApp, so {payeeName} can never tap
              &ldquo;Confirm received&rdquo;. You confirm this one on their behalf — only
              after the cash has actually changed hands.
            </p>

            <form action={formAction} className="mt-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cash-amount" className="field-label">
                  Amount paid in cash
                </label>
                <div className="flex items-center gap-2">
                  <span className="figure text-sm text-ink-faint">₹</span>
                  <input
                    id="cash-amount"
                    name="amount"
                    inputMode="decimal"
                    required
                    defaultValue={amount}
                    className="field field-amount"
                  />
                </div>
                <p className="hint">Change this if you paid part of it.</p>
              </div>

              {/* Boxed on purpose: this tick is a gate, not a list item. It
                  carries the weight the payee's Confirm normally would. */}
              <label className="flex cursor-pointer items-start gap-3 border border-rule-strong bg-surface p-3">
                <input
                  type="checkbox"
                  name="affirm"
                  checked={affirmed}
                  onChange={(e) => setAffirmed(e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-brand"
                />
                <span className="text-sm">
                  I have given {payeeName} ₹{amount} in cash
                </span>
              </label>

              <p className="hint">
                The group sees this as a cash settlement recorded by you, not as a UPI
                payment.
              </p>

              {state.error && (
                <p className="notice-error" role="alert">
                  {state.error}
                </p>
              )}

              <RecordButton amount={amount} enabled={affirmed} />

              <p className="hint text-center">
                No UPI app opens. This clears the balance the moment you record it.
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
