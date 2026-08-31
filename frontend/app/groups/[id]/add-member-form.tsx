'use client';

import { UserPlus } from 'lucide-react';
import { useActionState, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { addPlaceholderMember, type AddMemberState } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary">
      {pending ? 'Adding…' : 'Add'}
    </button>
  );
}

/**
 * Adds someone who is in the group but not on the app yet.
 *
 * Collapsed behind a quiet button so the group screen reads as a ledger rather
 * than a form: the design pairs this with "Share invite link" as two quiet
 * actions at the foot of the screen, and the fields only appear on demand.
 */
export function AddMemberForm({ groupId }: { groupId: string }) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState<AddMemberState, FormData>(
    addPlaceholderMember.bind(null, groupId),
    { status: 'idle' },
  );

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-quiet btn-block">
        <UserPlus size={16} strokeWidth={1.5} aria-hidden="true" />
        Add someone
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      action={async (fd) => {
        await formAction(fd);
        formRef.current?.reset();
      }}
      className="flex flex-col gap-3 border-l-2 border-brand pl-3"
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="display_name"
          required
          autoFocus
          maxLength={80}
          placeholder="Name"
          aria-label="Name"
          className="field flex-1"
        />
        <input
          name="upi_id"
          inputMode="email"
          placeholder="UPI ID (optional)"
          aria-label="UPI ID (optional)"
          className="field field-amount flex-1"
        />
        <SubmitButton />
      </div>

      {/* The action returns Supabase's own message; it is not shown. A refusal
          from RLS must read as "you can't do this", not as a policy name. */}
      {state.error && (
        <p className="notice-error" role="alert">
          We couldn&rsquo;t add them. Check the name and try again.
        </p>
      )}

      <p className="hint">
        Adds someone who isn&rsquo;t on SplitApp yet. They can join later with the invite link.
      </p>

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="link-back w-full text-center"
      >
        Cancel
      </button>
    </form>
  );
}
