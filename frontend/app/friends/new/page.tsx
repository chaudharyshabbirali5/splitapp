import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * STUB — commit (b) builds this screen.
 *
 * It exists now so "Add a friend" on the list routes somewhere real instead of a
 * 404. The backend it will call is already live: create_friend_tab(p_other uuid)
 * for someone on SplitApp, create_placeholder_friend_tab(p_name, p_upi) for
 * someone who is not.
 *
 * Deliberately no form. A half-built create screen that looks finished is worse
 * than one that says it isn't: this cannot be mistaken for a working flow, and it
 * cannot half-write a tab.
 */
export default async function NewFriendPage() {
  const supabase = await createClient();

  // Auth-gated like every other screen, so the stub cannot become the one route
  // that renders for a signed-out visitor.
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
        <h1 className="page-title mt-2">Add a friend</h1>
      </header>

      <div className="empty flex flex-col items-center gap-2">
        <p className="khata-label">Not built yet</p>
        <p className="mt-1 max-w-xs text-sm text-ink-soft">
          Adding a friend lands in the next change. You will be able to start a tab
          with someone on SplitApp, or with someone who is not on it at all.
        </p>
      </div>

      <Link href="/friends" className="btn btn-quiet btn-block">
        Back to friends
      </Link>
    </main>
  );
}
