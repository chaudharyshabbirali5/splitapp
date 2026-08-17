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
      className="btn btn-primary btn-block"
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
        <label htmlFor="name" className="field-label">
          Group name
        </label>
        <input
          id="name"
          name="name"
          required
          autoFocus
          maxLength={80}
          placeholder="Goa Trip"
          className="field"
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="field-label">Type</legend>
        <div className="grid grid-cols-4 gap-2">
          {TYPES.map((t, i) => (
            <label key={t.value} className="segment">
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

      {state.error && <p className="text-sm text-debit">{state.error}</p>}

      <SubmitButton />

      <Link href="/groups" className="link block text-center text-sm">
        Cancel
      </Link>
    </form>
  );
}
