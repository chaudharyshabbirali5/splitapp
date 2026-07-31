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
      className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
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
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100"
        />
        <input
          name="upi_id"
          inputMode="email"
          placeholder="UPI ID (optional)"
          aria-label="UPI ID (optional)"
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100"
        />
        <SubmitButton />
      </div>

      {state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      <p className="text-xs text-zinc-500">
        Adds someone who isn&rsquo;t on SplitApp yet. They can join later with the invite link.
      </p>
    </form>
  );
}
