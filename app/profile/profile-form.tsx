'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { saveProfile, type ProfileFormState } from './actions';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
    >
      {pending ? 'Saving…' : label}
    </button>
  );
}

export function ProfileForm({
  displayName,
  upiId,
  next,
}: {
  displayName: string;
  upiId: string | null;
  next: string | null;
}) {
  const [state, formAction] = useActionState<ProfileFormState, FormData>(saveProfile, {
    status: 'idle',
  });

  return (
    <form action={formAction} className="space-y-5">
      {next && <input type="hidden" name="next" value={next} />}

      <div className="space-y-1.5">
        <label htmlFor="display_name" className="block text-sm font-medium">
          Display name
        </label>
        <input
          id="display_name"
          name="display_name"
          required
          defaultValue={displayName}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100"
        />
        <p className="text-xs text-zinc-500">
          This is the name other people in a group will see.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="upi_id" className="block text-sm font-medium">
          UPI ID{' '}
          {next ? (
            <span className="font-normal text-zinc-500">(required to create a group)</span>
          ) : (
            <span className="font-normal text-zinc-500">(optional)</span>
          )}
        </label>
        <input
          id="upi_id"
          name="upi_id"
          inputMode="email"
          required={!!next}
          defaultValue={upiId ?? ''}
          placeholder="yourname@bank"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100"
        />
        <p className="text-xs text-zinc-500">
          Used to settle up{next ? '. Without it, nobody can pay you back.' : '. You can add this later.'}
        </p>
      </div>

      {state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state.status === 'saved' && !state.error && (
        <p className="text-sm text-green-700 dark:text-green-400">Profile saved.</p>
      )}

      <SubmitButton label={next ? 'Save and continue' : 'Save profile'} />

      <Link
        href="/groups"
        className="block text-center text-sm underline underline-offset-4 text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-white"
      >
        Back to groups
      </Link>
    </form>
  );
}
