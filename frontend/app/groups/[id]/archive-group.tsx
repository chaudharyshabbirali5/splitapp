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
      className="btn btn-danger-solid btn-block"
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
        className="btn btn-danger btn-block"
      >
        Archive group
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-3 border-l-2 border-debit pl-4">
      <p className="text-sm">
        This hides <span className="font-medium">{groupName}</span> from everyone in it.
      </p>
      <p className="hint">
        Nothing is deleted — every expense, split and settlement is kept, and the group
        can be restored later. It just stops appearing and can no longer be changed.
      </p>

      <div className="space-y-1.5">
        <label htmlFor="confirm_name" className="khata-label block">
          Type <span className="text-ink">{groupName}</span> to confirm
        </label>
        <input
          id="confirm_name"
          name="confirm_name"
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="field"
        />
      </div>

      {state.error && <p className="text-sm text-debit">{state.error}</p>}

      <ConfirmButton enabled={typed.trim() === groupName.trim()} />

      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setTyped('');
        }}
        className="link-back w-full text-center"
      >
        Keep this group
      </button>
    </form>
  );
}
