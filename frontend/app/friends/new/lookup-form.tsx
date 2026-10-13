'use client';

import { Search, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  lookupFriendByHandle,
  startTabWithUser,
  type AddFriendState,
  type LookupState,
} from './actions';

/** Stable per-person tint, hashed from the name. Mirrors the rest of the app. */
const TINTS = [
  'bg-tint-teal',
  'bg-tint-coral',
  'bg-tint-sand',
  'bg-tint-olive',
  'bg-tint-slate',
  'bg-tint-mauve',
] as const;

function tintFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
  return TINTS[h % TINTS.length];
}

/**
 * Lives in its own component because useFormStatus only reports on the form
 * ABOVE it in the tree — read from the component that renders <form>, it always
 * returns false and the pending state would silently never appear.
 */
function LookUpButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || !enabled}
      className={`btn btn-block mt-1.5 ${pending || !enabled ? 'btn-dead' : 'btn-primary'}`}
    >
      <Search size={16} strokeWidth={1.5} aria-hidden="true" />
      {pending ? 'Looking up…' : 'Look up'}
    </button>
  );
}

function ConfirmButton({ displayName }: { displayName: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn btn-primary btn-block"
    >
      <UserPlus size={16} strokeWidth={1.5} aria-hidden="true" />
      {pending ? 'Opening…' : `Start tab with ${displayName}`}
    </button>
  );
}

/**
 * The found-user card and its confirm action.
 *
 * Its own form, so confirming is a separate submission from the lookup — tapping
 * confirm must not re-run the search, and the pending state has to belong to the
 * create call.
 *
 * create_friend_tab is idempotent, so there is no "already friends" case to
 * handle: confirming an existing pair lands on the existing tab.
 */
function FoundCard({ userId, displayName }: { userId: string; displayName: string }) {
  // The confirm carries no form payload — the user id is already known from the
  // lookup — so the action takes only that id and the form's own submission is
  // the whole input. useActionState still owns the pending and error state.
  const [state, formAction] = useActionState<AddFriendState, FormData>(
    () => startTabWithUser(userId),
    {},
  );

  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {/* Brand-soft, not an error tone and not a money tone: a match is good
          news. The row mirrors the Friends list — solid tinted avatar for a real
          account (never the dashed placeholder treatment, which means "not on
          SplitApp" and would be exactly wrong here). */}
      <div className="card card-brand flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`avatar size-9 shrink-0 text-sm ${tintFor(displayName)}`}
        >
          {displayName.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="khata-label">Found</span>
          <span className="truncate font-medium">{displayName}</span>
        </span>
      </div>

      <form action={formAction} className="flex flex-col gap-2">
        {state.error && (
          <p className="notice-error" role="alert">
            {state.error}
          </p>
        )}
        <ConfirmButton displayName={displayName} />
      </form>

      <p className="hint">
        They are not notified until there is something on the tab.
      </p>
    </div>
  );
}

/**
 * Path A: find someone already on SplitApp by their exact UPI handle.
 *
 * The zero-rows cases are deliberately NOT distinguished. find_friend_by_handle
 * returns nothing for not-found, for an ambiguous handle shared by two accounts,
 * and for your own handle — so that the difference cannot be used to probe which
 * handles exist. The UI preserves that: one calm message covers all of them, and
 * it routes to the by-name fallback rather than suggesting the user try harder.
 */
export function LookupForm() {
  const [state, formAction] = useActionState<LookupState, FormData>(lookupFriendByHandle, {
    status: 'idle',
  });

  // Tracked so the button can be inert on an empty field rather than submitting
  // a blank search. The action also returns 'idle' for blank, so this is the
  // affordance, not the rule.
  const [handle, setHandle] = useState('');
  const filled = handle.trim().length > 0;

  return (
    <section className="flex flex-col gap-5">
      <form action={formAction} className="flex flex-col gap-1.5">
        <label htmlFor="handle" className="field-label">
          UPI ID
        </label>
        <input
          id="handle"
          name="handle"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={120}
          placeholder="name@bank"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          aria-describedby="handle-hint"
          className="field"
        />
        <p id="handle-hint" className="hint">
          We look them up on SplitApp. Nothing is sent to them.
        </p>

        <LookUpButton enabled={filled} />
      </form>

      {state.status === 'found' && (
        <FoundCard userId={state.userId} displayName={state.displayName} />
      )}

      {state.status === 'not-found' && (
        <div className="flex flex-col gap-3" aria-live="polite">
          {/* Calm and sunken, not an error: typing a handle that is not on
              SplitApp is an ordinary outcome, not a mistake. No debit red —
              nothing here is money — and no amber, which would read as a
              warning about something the user did wrong. */}
          <div className="card card-sunken">
            <p className="khata-label">No match</p>
            <p className="mt-1.5 text-sm text-ink-soft">
              No SplitApp user found with that UPI ID. You can still keep a private
              tab against their name.
            </p>
          </div>

          <Link href="/friends/new/by-name" className="btn btn-quiet btn-block">
            <UserPlus size={16} strokeWidth={1.5} aria-hidden="true" />
            Add someone by name
          </Link>
        </div>
      )}

      {state.status === 'error' && (
        <p className="notice-error" role="alert">
          We couldn&rsquo;t run that lookup. Check your connection and try again.
        </p>
      )}
    </section>
  );
}
