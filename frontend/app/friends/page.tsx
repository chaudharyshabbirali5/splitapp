import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { toPaise } from '@/lib/balances';
import { formatPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Stable per-person tint, hashed from the name so the same person keeps the same
 * colour everywhere. Copied from the groups list rather than shared: it is four
 * lines, and the alternative is a new module, which this commit does not add.
 */
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
 * Exactly the shape my_friend_positions() returns (migration 20260914103000).
 * net_minor arrives as bigint over PostgREST, so it is `unknown` until toPaise
 * has vetted it — Number() on a money value is the bug that type is guarding.
 */
type FriendPosition = {
  group_id: string;
  my_member_id: string;
  counterparty_member_id: string;
  counterparty_user_id: string | null;
  name: string;
  upi: string | null;
  net_minor: unknown;
  last_entry_description: string | null;
  last_entry_at: string | null;
};

/** "3 Feb" — enough to place an entry in time without a full timestamp. */
function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default async function FriendsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=%2Ffriends');

  // The RPC, not a groups query. my_friend_positions() already returns only
  // kind='friend' tabs the caller is a member of, with the counterparty and the
  // signed net resolved in one round trip — so there is nothing to filter here
  // and no second call to make. It is SECURITY INVOKER, so RLS still applies.
  const { data, error } = await supabase.rpc('my_friend_positions');

  if (error) {
    // A refusal must never surface as RLS or Postgres text.
    console.error('friends page read failed:', error.message);
  }

  const rows = (data ?? []) as FriendPosition[];

  // Money conversion is fenced: toPaise throws rather than silently rounding, and
  // one bad row must not take down the screen with a stack trace.
  let moneyError = false;
  const tabs: { row: FriendPosition; net: bigint }[] = [];
  try {
    for (const row of rows) tabs.push({ row, net: toPaise(row.net_minor) });
  } catch (e) {
    console.error('friends page money conversion failed:', (e as Error).message);
    moneyError = true;
  }

  // Summed over BigInt, formatted once. No float touches this path.
  const grandTotal = tabs.reduce((a, t) => a + t.net, 0n);

  // Biggest debts first in each direction, settled tabs last: the rows that need
  // action sort above the ones that do not.
  const ordered = [...tabs].sort((a, b) => {
    const aAbs = a.net < 0n ? -a.net : a.net;
    const bAbs = b.net < 0n ? -b.net : b.net;
    if (aAbs === bAbs) return a.row.name.localeCompare(b.row.name);
    return bAbs > aAbs ? 1 : -1;
  });

  const count = tabs.length;
  const failed = !!error || moneyError;

  return (
    <main
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 py-6"
      style={{ paddingInline: 'var(--gutter)' }}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="page-title">Friends</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {count === 0
              ? 'One-to-one tabs, separate from your groups'
              : `${count} ${count === 1 ? 'tab' : 'tabs'} · one person each`}
          </p>
        </div>

        <Link
          href="/profile"
          aria-label="Profile"
          className={`avatar size-9 text-sm ${tintFor(user.email ?? '')}`}
        >
          {(user.email ?? '?').trim().charAt(0).toUpperCase()}
        </Link>
      </header>

      {failed ? (
        <p className="notice-error" role="alert">
          We couldn&rsquo;t load your friends. Refresh, or sign in again if this keeps
          happening.
        </p>
      ) : count > 0 ? (
        <>
          {/* Net across every friend tab. Credit green only when money comes
              back, debit red only when it is owed — the reserved meanings. */}
          <div className="card flex items-center justify-between">
            <div>
              <p className="khata-label">
                {grandTotal < 0n
                  ? 'You owe across friends'
                  : grandTotal > 0n
                    ? 'You get back across friends'
                    : 'You are settled up'}
              </p>
              <p
                className={`figure mt-1.5 text-3xl font-semibold ${
                  grandTotal > 0n ? 'text-credit' : grandTotal < 0n ? 'text-debit' : ''
                }`}
              >
                {formatPaise(grandTotal < 0n ? -grandTotal : grandTotal)}
              </p>
            </div>
            {grandTotal !== 0n && (
              <span className={grandTotal < 0n ? 'text-debit' : 'text-credit'}>
                {grandTotal < 0n ? (
                  <ArrowUpRight size={28} strokeWidth={1.5} aria-hidden="true" />
                ) : (
                  <ArrowDownLeft size={28} strokeWidth={1.5} aria-hidden="true" />
                )}
              </span>
            )}
          </div>

          <section className="flex flex-col gap-2">
            <h2 className="khata-label">All friends</h2>
            <div className="card card-flush">
              <ul className="ledger border-t-0 border-b-0">
                {ordered.map(({ row, net }) => {
                  // The ONLY placeholder signal. NULL means no account, which is
                  // why the avatar is dashed and why settle-up will route to cash
                  // rather than UPI on the detail screen (commit (c)).
                  const isPlaceholder = row.counterparty_user_id === null;
                  const when = shortDate(row.last_entry_at);

                  // Meta line: the last entry if there is one, otherwise why the
                  // tab is empty. A placeholder with no entries is the common case
                  // right after creation, so it gets its own words.
                  const meta = row.last_entry_description
                    ? when
                      ? `${row.last_entry_description} · ${when}`
                      : row.last_entry_description
                    : 'No entries yet';

                  return (
                    <li key={row.group_id}>
                      <Link href={`/friends/${row.group_id}`} className="ledger-row ledger-link">
                        <span className="flex min-w-0 items-center gap-3">
                          <span
                            aria-hidden="true"
                            className={`avatar size-9 shrink-0 text-sm ${
                              isPlaceholder ? 'avatar-placeholder' : tintFor(row.name)
                            }`}
                          >
                            {row.name.trim().charAt(0).toUpperCase() || '?'}
                          </span>

                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-medium">{row.name}</span>
                              {/* Pending amber, not debit red: "not on SplitApp"
                                  is a state of the person, never money owed. */}
                              {isPlaceholder && (
                                <span className="chip chip-pending shrink-0">not joined</span>
                              )}
                            </span>
                            <span className="truncate text-xs text-ink-faint">{meta}</span>
                          </span>
                        </span>

                        {/* Absolute value always. Direction is carried by the
                            colour and the caption, never by a minus sign. */}
                        {net === 0n ? (
                          <span className="chip chip-quiet shrink-0">settled up</span>
                        ) : (
                          <span className="flex shrink-0 flex-col items-end gap-0.5">
                            <span
                              className={`figure text-sm font-medium ${
                                net < 0n ? 'text-debit' : ''
                              }`}
                            >
                              {formatPaise(net < 0n ? -net : net)}
                            </span>
                            <span
                              className={`text-[0.625rem] leading-none ${
                                net < 0n ? 'text-debit' : 'text-ink-faint'
                              }`}
                            >
                              {net < 0n ? 'you owe' : 'owes you'}
                            </span>
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        </>
      ) : (
        <div className="empty flex flex-col items-center gap-2">
          <p className="khata-label">No friends yet</p>
          <p className="mt-1 max-w-xs text-sm text-ink-soft">
            A friend tab is a running one-to-one ledger — lunch, a cab, a ticket you
            covered. Add someone who is on SplitApp, or anyone who is not.
          </p>
        </div>
      )}

      <Link href="/friends/new" className="btn btn-quiet btn-block">
        Add a friend
      </Link>
    </main>
  );
}
