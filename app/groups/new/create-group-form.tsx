'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { createGroup, type CreateGroupState } from './actions';

const TYPES = [
  { value: 'trip', label: 'Trip' },
  { value: 'flat', label: 'Flat' },
  { value: 'event', label: 'Event' },
  { value: 'other', label: 'Other' },
] as const;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
    >
      {pending ? 'Creating…' : 'Create group'}
    </button>
  );
}

export function CreateGroupForm() {
  const [state, formAction] = useActionState<CreateGroupState, FormData>(createGroup, {});

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-1.5">
        <label htmlFor="name" className="block text-sm font-medium">
          Group name
        </label>
        <input
          id="name"
          name="name"
          required
          autoFocus
          maxLength={80}
          placeholder="Goa Trip"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100"
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Type</legend>
        <div className="grid grid-cols-4 gap-2">
          {TYPES.map((t, i) => (
            <label
              key={t.value}
              className="flex cursor-pointer items-center justify-center rounded-md border border-zinc-300 px-2 py-2 text-sm has-checked:border-zinc-900 has-checked:bg-zinc-900 has-checked:text-white dark:border-zinc-700 dark:has-checked:border-zinc-100 dark:has-checked:bg-zinc-100 dark:has-checked:text-zinc-900"
            >
              <input
                type="radio"
                name="group_type"
                value={t.value}
                defaultChecked={i === 0}
                className="sr-only"
              />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>

      {state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}

      <SubmitButton />

      <Link
        href="/groups"
        className="block text-center text-sm underline underline-offset-4 text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-white"
      >
        Cancel
      </Link>
    </form>
  );
}
