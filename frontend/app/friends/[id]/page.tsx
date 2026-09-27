import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { toPaise } from '@/lib/balances';
import { formatPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type FriendPosition = {
  group_id: string;
  counterparty_user_id: string | null;
  name: string;
  net_minor: unknown;
};

/**
 * STUB — commit (c) builds this screen.
 *
 * It shows who the tab is with and where it stands, and nothing else: no entries,
 * no add-expense, no settle-up. Those are the next change.
 *
 * It resolves the tab through my_friend_positions() and 404s when the id is not in
 * the caller's own list, so the stub cannot be used to probe whether a given group
 * id exists. That check is worth having even on a placeholder screen — it is the
 * kind of thing that quietly never gets added later.
 */
export default async function FriendDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/friends/${id}`)}`);

  const { data, error } = await supabase.rpc('my_friend_positions');
  if (error) {
    console.error('friend detail read failed:', error.message);
  }

  const tab = ((data ?? []) as FriendPosition[]).find((r) => r.group_id === id);
  if (!tab) notFound();

  let net: bigint | null = null;
  try {
    net = toPaise(tab.net_minor);
  } catch (e) {
    console.error('friend detail money conversion failed:', (e as Error).message);
  }

  const isPlaceholder = tab.counterparty_user_id === null;

  return (
    <main
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 py-6"
      style={{ paddingInline: 'var(--gutter)' }}
    >
      <header className="min-w-0">
        <Link href="/friends" className="link-back">
          &larr; Friends
        </Link>
        <h1 className="page-title mt-2 truncate">{tab.name}</h1>
        {isPlaceholder && (
          <p className="mt-1.5">
            <span className="chip chip-pending">not joined</span>
          </p>
        )}
      </header>

      <div className="card">
        <p className="khata-label">
          {net === null
            ? 'Balance unavailable'
            : net > 0n
              ? 'Owes you'
              : net < 0n
                ? 'You owe'
                : 'Settled up'}
        </p>
        {net !== null && (
          <p
            className={`figure mt-1.5 text-3xl font-semibold ${
              net > 0n ? 'text-credit' : net < 0n ? 'text-debit' : ''
            }`}
          >
            {formatPaise(net < 0n ? -net : net)}
          </p>
        )}
      </div>

      <div className="empty flex flex-col items-center gap-2">
        <p className="khata-label">Not built yet</p>
        <p className="mt-1 max-w-xs text-sm text-ink-soft">
          Entries and settle-up land in the next change.
        </p>
      </div>
    </main>
  );
}
