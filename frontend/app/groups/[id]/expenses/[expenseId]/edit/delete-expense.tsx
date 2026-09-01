'use client';

import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

/** Stable per-person tint, hashed from the name. Mirrors the design's tintFor(). */
const TINTS = [
  'bg-tint-teal',
  'bg-tint-coral',
  'bg-tint-sand',
  'bg-tint-olive',
  'bg-tint-slate',
  'bg-tint-mauve',
] as const;

function tintFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
  return TINTS[h % TINTS.length];
}

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-danger-solid btn-lg btn-block">
      {pending ? 'Deleting…' : 'Yes, delete this expense'}
    </button>
  );
}

export type DeleteSummary = {
  description: string;
  payerName: string;
  payerIsPlaceholder: boolean;
  ways: number;
  dateLabel: string;
  amountLabel: string;
};

/**
 * Two steps, so a stray tap cannot remove an expense — the second step now lives
 * in a bottom sheet, which is how every other confirmation on mobile behaves.
 *
 * The delete itself is a SOFT delete: softDeleteExpense flips expenses.is_deleted,
 * the row stays, and an admin can restore it. The copy says exactly that and must
 * never claim this cannot be undone.
 */
export function DeleteExpense({
  action,
  summary,
}: {
  action: () => Promise<void>;
  summary: DeleteSummary;
}) {
  const [open, setOpen] = useState(false);

  // Escape closes the sheet, and the page behind it must not scroll while it is
  // up — both are things a real sheet does and a inline confirm did not need.
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-danger btn-block"
      >
        <Trash2 size={16} strokeWidth={1.5} aria-hidden="true" />
        Delete expense
      </button>

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
            aria-labelledby="delete-expense-title"
          >
            <div className="sheet-grip" />
            <h2 id="delete-expense-title" className="page-title">
              Delete expense
            </h2>

            {/* The entry restated, so the thing being removed is on screen at the
                moment of confirming rather than remembered from the row behind. */}
            <div className="card card-sunken mt-4 flex items-center gap-3">
              <span
                title={summary.payerName}
                className={`avatar size-9 text-sm ${
                  summary.payerIsPlaceholder
                    ? 'avatar-placeholder'
                    : tintFor(summary.payerName)
                }`}
              >
                {summary.payerName.trim().charAt(0).toUpperCase() || '?'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{summary.description}</span>
                <span className="figure block truncate text-xs text-ink-faint">
                  {summary.payerName} paid &middot; split {summary.ways}{' '}
                  {summary.ways === 1 ? 'way' : 'ways'} &middot; {summary.dateLabel}
                </span>
              </span>
              <span className="figure shrink-0 text-lg font-semibold">
                {summary.amountLabel}
              </span>
            </div>

            {/* Soft delete: the row is kept and can be restored. Saying otherwise
                would be a lie about someone's money history. */}
            <p className="notice-error mt-4">
              This removes {summary.amountLabel} from the group and from all balances. An
              admin can restore it later.
            </p>

            <form action={action} className="mt-4 flex flex-col gap-2">
              <ConfirmButton />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn btn-quiet btn-block"
              >
                Keep it
              </button>
            </form>
          </div>
        </>
      )}
    </>
  );
}
