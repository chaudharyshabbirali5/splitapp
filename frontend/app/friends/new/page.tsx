import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

import { LookupForm } from './lookup-form';

export const dynamic = 'force-dynamic';

/**
 * Add a friend — the lookup entry screen.
 *
 * Two paths, in order of likelihood:
 *
 *   Path A (above the rule)  Find someone already on SplitApp by their exact UPI
 *                            handle, via find_friend_by_handle (M5). Live.
 *   Path B (below the rule)  Keep a private tab against a name, for someone who
 *                            is not on the app at all. Unchanged, and now reached
 *                            from two places: the "Not on SplitApp?" entry here,
 *                            and the not-found state of a lookup.
 *
 * The lookup is a client component because it holds three result states inline
 * and must not navigate between them — a found match is a step in the same
 * screen, not a new route.
 *
 * On phone paths: the field is UPI-only. The backend serves no phone lookup —
 * profiles.phone exists but is never written and is NULL on every row — so the
 * label and placeholder say UPI and nothing else. Copy that promised a phone
 * path the database cannot serve was the thing to remove here.
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

      {/* ---- Path A: look them up on SplitApp ---- */}
      <LookupForm />

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
