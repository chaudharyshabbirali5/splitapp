'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn btn-danger-solid btn-block"
    >
      {pending ? 'Deleting…' : 'Yes, delete this expense'}
    </button>
  );
}

/**
 * Two-step so a stray tap cannot remove an expense. The delete itself is a soft
 * delete — the row stays, is_deleted flips to true.
 */
export function DeleteExpense({ action }: { action: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="btn btn-danger btn-block"
      >
        Delete expense
      </button>
    );
  }

  return (
    <form action={action} className="space-y-2 border-l-2 border-debit pl-4">
      <p className="text-sm text-ink-soft">
        This removes the expense from the group and from all balances. It can be
        restored later by an admin.
      </p>
      <ConfirmButton />
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="link-back w-full text-center"
      >
        Keep it
      </button>
    </form>
  );
}
