import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

import { AddFriendByNameForm } from './add-friend-by-name-form';

export const dynamic = 'force-dynamic';

/**
 * Add a friend by name — the placeholder path, fully built.
 *
 * Backs to the LOOKUP screen, not to Friends: this screen is reached from there
 * (and, once Path A works, from its no-match state), so back should undo one step
 * rather than jumping to the top of the section.
 *
 * No profile gate, unlike /groups/new. create_group_with_owner hard-requires a
 * UPI ID on the creator because group members need to be paid back;
 * create_placeholder_friend_tab deliberately does not — creation is not gated on
 * it (M3 design, resolved decision), and the missing-UPI state surfaces at
 * settle time where it is actionable. Adding a gate here would contradict the
 * function.
 */
export default async function AddFriendByNamePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=%2Ffriends%2Fnew%2Fby-name');

  return (
    <main
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 py-6"
      style={{ paddingInline: 'var(--gutter)' }}
    >
      <header className="min-w-0">
        <Link href="/friends/new" className="link-back">
          &larr; Add a friend
        </Link>
        <h1 className="page-title pt-1">Add by name</h1>
        <p className="mt-1 text-sm text-ink-soft">
          For someone who isn&rsquo;t on SplitApp.
        </p>
      </header>

      <AddFriendByNameForm />
    </main>
  );
}
