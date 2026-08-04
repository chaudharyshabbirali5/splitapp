'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { archiveGroup, type ArchiveState } from './archive-actions';

function ConfirmButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || !enabled}
      className="w-full rounded-md bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? 'Archiving…' : 'Archive this group'}
    </button>
  );
}

/**
 * Two steps, and the second requires typing the group name. Archiving hides a
 * shared ledger from everyone in the group, so it should be hard to do by
 * accident on a phone.
 */
export function ArchiveGroup({ groupId, groupName }: { groupId: string; groupName: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [state, formAction] = useActionState<ArchiveState, FormData>(
    archiveGroup.bind(null, groupId, groupName),
    {},
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-md border border-red-300 px-4 py-2.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
      >
        Archive group
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-3 rounded-md border border-red-300 p-4 dark:border-red-900">
      <p className="text-sm">
        This hides <span className="font-medium">{groupName}</span> from everyone in it.
      </p>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Nothing is deleted — every expense, split and settlement is kept, and the group
        can be restored later. It just stops appearing and can no longer be changed.
      </p>

      <div className="space-y-1.5">
        <label htmlFor="confirm_name" className="block text-xs font-medium">
          Type <span className="font-semibold">{groupName}</span> to confirm
        </label>
        <input
          id="confirm_name"
          name="confirm_name"
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100"
        />
      </div>

      {state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}

      <ConfirmButton enabled={typed.trim() === groupName.trim()} />

      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setTyped('');
        }}
        className="w-full text-center text-xs underline underline-offset-4 text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-white"
      >
        Keep this group
      </button>
    </form>
  );
}
