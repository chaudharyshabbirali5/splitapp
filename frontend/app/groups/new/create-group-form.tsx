'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { createGroup, type CreateGroupState } from './actions';

const TYPES = [
  { value: 'trip', label: 'Trip' },
  { value: 'flat', label: 'Flat' },
  { value: 'event', label: 'Event' },
  { value: 'other', label: 'Other' },
] as const;

/**
 * Everything that depends on the in-flight state lives here, because
 * useFormStatus only reports on the form ABOVE it in the tree — a sibling of
 * <form>, or the component rendering it, always reads false.
 */
function SubmitArea({ nameFilled, error }: { nameFilled: boolean; error?: string }) {
  const { pending } = useFormStatus();

  return (
    <>
      {/* Submitting is a real wait: create_group_with_owner writes the group and
          the creator's member row in one transaction. Say so rather than leaving
          a dead button unexplained. No spinner. */}
      {pending && (
        <p className="notice-pending">Creating the group. Do not close this screen.</p>
      )}

      {/* The action's own validation copy is safe to show; a raw Supabase string
          would not be, and never reaches here — see actions.ts. */}
      {error && !pending && (
        <p className="notice-error" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !nameFilled}
        className="btn btn-primary btn-lg btn-block"
      >
        {pending ? 'Creating…' : 'Create group'}
      </button>

      <Link href="/groups" className="link block text-center text-sm">
        Cancel
      </Link>

      <p className="hint">
        {pending
          ? 'You can add members and the first expense on the next screen.'
          : 'Add members after the group exists — invite them with a link, or add someone who is not on SplitApp as a placeholder.'}
      </p>
    </>
  );
}

export function CreateGroupForm() {
  const [state, formAction] = useActionState<CreateGroupState, FormData>(createGroup, {});

  // Tracked so the required rule can be shown as a dead button rather than as an
  // error after the tap. The input stays uncontrolled in every other respect.
  const [name, setName] = useState('');

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
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
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="field"
        />
        <p className="hint">Everyone in the group sees this. You can rename it later.</p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="field-label">Type</legend>
        {/* The same sunken pill track used elsewhere; four options fit 390px. */}
        <div className="segment-pill grid-cols-4">
          {TYPES.map((t, i) => (
            <label key={t.value}>
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
        <p className="hint">
          Only changes the label on the group. It does not change how splitting works.
        </p>
      </fieldset>

      <SubmitArea nameFilled={name.trim().length > 0} error={state.error} />
    </form>
  );
}
