'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { addFriendByName, type AddFriendState } from '../actions';

/**
 * Everything that depends on the in-flight state lives here, because
 * useFormStatus only reports on the form ABOVE it in the tree — read from the
 * component that renders <form>, it always returns false and the submitting
 * state would silently never appear.
 */
function SubmitArea({ nameFilled, error }: { nameFilled: boolean; error?: string }) {
  const { pending } = useFormStatus();

  return (
    <>
      {/* A real wait: the RPC writes a group and two member rows in one
          transaction. Pending amber — nothing here is a debt. No spinner. */}
      {pending && <p className="notice-pending">Creating the tab. Do not close this screen.</p>}

      {/* The action's own validation copy is safe to show. A raw database string
          would not be, and never reaches here — see actions.ts. */}
      {error && !pending && (
        <p className="notice-error" role="alert">
          {error}
        </p>
      )}

      {/* Dead until there is a name, so the required rule reads as "not yet"
          rather than as an error after the tap. */}
      <button
        type="submit"
        disabled={pending || !nameFilled}
        className="btn btn-primary btn-lg btn-block"
      >
        {pending ? 'Creating…' : 'Create private tab'}
      </button>

      <Link href="/friends" className="link block text-center text-sm">
        Cancel
      </Link>
    </>
  );
}

export function AddFriendByNameForm() {
  const [state, formAction] = useActionState<AddFriendState, FormData>(addFriendByName, {});

  // Tracked so the preview card can name the person as you type, and so the
  // button can be dead rather than erroring after submit.
  const [name, setName] = useState('');
  const trimmed = name.trim();

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="field-label">
          Name
        </label>
        <input
          id="name"
          name="name"
          required
          autoFocus
          maxLength={80}
          placeholder="Ravi"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="field"
        />
        <p className="hint">Only you see this. You can change it later.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="upi_id" className="field-label">
          UPI ID <span className="text-ink-faint">(optional)</span>
        </label>
        <input
          id="upi_id"
          name="upi_id"
          inputMode="email"
          maxLength={120}
          placeholder="ravi@okicici"
          className="field"
        />
        <p className="hint">Kept on the tab for your reference.</p>
      </div>

      {/* ---- the private-tab preview ----
          Brand-soft, not debit: this card is informational, and nothing on this
          screen is money owed. The dashed avatar is the same placeholder
          treatment the Friends list and the group screens already use, so the
          row you are about to create is recognisable before it exists. */}
      <section className="card card-brand flex flex-col gap-3" aria-live="polite">
        <p className="khata-label">Private tab</p>

        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="avatar avatar-placeholder size-9 shrink-0 text-sm">
            {trimmed.charAt(0).toUpperCase() || '?'}
          </span>

          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate font-medium">{trimmed || 'Their name'}</span>
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="chip chip-quiet">Only you</span>
              <span className="chip chip-pending">Not on SplitApp</span>
            </span>
          </div>
        </div>

        {/* The honesty line. Named explicitly rather than implied, and it uses
            the name as typed so it reads as a statement about a person. */}
        <p className="text-sm text-ink-soft">
          A private tab just for you &mdash; {trimmed || 'this person'} isn&rsquo;t notified
          and can&rsquo;t see it.
        </p>
      </section>

      <SubmitArea nameFilled={trimmed.length > 0} error={state.error} />
    </form>
  );
}
