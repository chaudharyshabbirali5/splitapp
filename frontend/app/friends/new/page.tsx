import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Add a friend — the lookup entry screen (Path A).
 *
 * PATH A IS DELIBERATELY NOT FUNCTIONAL. Looking someone up by UPI ID or phone
 * needs a server-side lookup function that does not exist yet: nothing in the
 * schema resolves a UPI ID or phone to a profile, and profiles_select_own means
 * a caller cannot read another person's row to do it client-side either. Building
 * the field and wiring it to nothing — or worse, to a client-side guess — would
 * be a working-looking search that can never match. So the field is present as
 * the designed entry point and the button is visibly dead, with a line saying
 * why.
 *
 * The field is rendered DISABLED rather than live-but-inert: a field you can type
 * into, with a button that refuses, teaches the user their input was wrong. A
 * disabled field says the feature is not ready, which is the true statement.
 *
 * Path B — add by name — is fully built and sits below the hairline.
 */
export default async function NewFriendPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=%2Ffriends%2Fnew');

  return (
    <main
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 py-6"
      style={{ paddingInline: 'var(--gutter)' }}
    >
      <header className="min-w-0">
        <Link href="/friends" className="link-back">
          &larr; Friends
        </Link>
        <h1 className="page-title pt-1">Add a friend</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Start a one-to-one tab. Groups stay separate.
        </p>
      </header>

      {/* ---- Path A: look them up on SplitApp (not built) ---- */}
      <section className="flex flex-col gap-1.5">
        <label htmlFor="handle" className="field-label">
          UPI ID or phone number
        </label>
        <input
          id="handle"
          name="handle"
          disabled
          placeholder="name@bank or 98765 43210"
          aria-describedby="handle-hint handle-unavailable"
          className="field"
        />
        <p id="handle-hint" className="hint">
          We look them up on SplitApp. Nothing is sent to them.
        </p>

        <button type="button" disabled className="btn btn-dead btn-block mt-1.5">
          Look up
        </button>

        {/* Says what is true, in the place where the user is about to be
            disappointed. Pending amber, not debit red — nothing here is money. */}
        <p id="handle-unavailable" className="notice-pending mt-1.5">
          Looking people up isn&rsquo;t ready yet. You can still add someone by name
          below.
        </p>
      </section>

      {/* ---- the hairline, then Path B ---- */}
      <div className="flex flex-col gap-3 border-t border-rule pt-5">
        <div className="min-w-0">
          <p className="field-label">Not on SplitApp?</p>
          <p className="hint mt-1">
            Keep a private running tab against their name. They are not contacted.
          </p>
        </div>

        <Link href="/friends/new/by-name" className="btn btn-quiet btn-block">
          Add someone by name
        </Link>
      </div>

      <Link href="/friends" className="link block text-center text-sm">
        Cancel
      </Link>
    </main>
  );
}
