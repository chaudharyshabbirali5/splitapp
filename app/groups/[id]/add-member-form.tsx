'use client';

import { useActionState, useRef } from 'react';
import { useFormStatus } from 'react-dom';

import { addPlaceholderMember, type AddMemberState } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn btn-primary"
    >
      {pending ? 'Adding…' : 'Add'}
    </button>
  );
}

export function AddMemberForm({ groupId }: { groupId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState<AddMemberState, FormData>(
    addPlaceholderMember.bind(null, groupId),
    { status: 'idle' },
  );

  return (
    <form
      ref={formRef}
      action={async (fd) => {
        await formAction(fd);
        formRef.current?.reset();
      }}
      className="space-y-3"
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="display_name"
          required
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

      {state.error && <p className="text-sm text-debit">{state.error}</p>}
      <p className="hint">
        Adds someone who isn&rsquo;t on SplitApp yet. They can join later with the invite link.
      </p>
    </form>
  );
}
