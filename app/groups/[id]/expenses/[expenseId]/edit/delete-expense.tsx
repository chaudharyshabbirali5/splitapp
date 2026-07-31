'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
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
        className="w-full rounded-md border border-red-300 px-4 py-2.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
      >
        Delete expense
      </button>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        This removes the expense from the group and from all balances. It can be
        restored later by an admin.
      </p>
      <ConfirmButton />
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="w-full text-center text-sm underline underline-offset-4 text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-white"
      >
        Keep it
      </button>
    </form>
  );
}
