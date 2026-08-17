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
      className="btn btn-primary btn-block"
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
        <label htmlFor="display_name" className="field-label">
          Display name
        </label>
        <input
          id="display_name"
          name="display_name"
          required
          defaultValue={displayName}
          className="field"
        />
        <p className="hint">
          This is the name other people in a group will see. Short names read best in a
          list of balances.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="upi_id" className="field-label">
          UPI ID{' '}
          <span className="font-normal text-ink-faint">
            {next ? '(required to create a group)' : '(optional)'}
          </span>
        </label>
        <input
          id="upi_id"
          name="upi_id"
          inputMode="email"
          required={!!next}
          defaultValue={upiId ?? ''}
          placeholder="yourname@bank"
          className="field field-amount"
        />
        <p className="hint">
          Used to settle up{next ? '. Without it, nobody can pay you back.' : '. You can add this later.'}
        </p>
      </div>

      {state.error && <p className="text-sm text-debit">{state.error}</p>}
      {state.status === 'saved' && !state.error && (
        <p className="text-sm text-credit">Profile saved.</p>
      )}

      <SubmitButton label={next ? 'Save and continue' : 'Save profile'} />

      <Link href="/groups" className="link block text-center text-sm">
        Back to groups
      </Link>
    </form>
  );
}
