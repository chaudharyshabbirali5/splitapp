import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { toPaise } from '@/lib/balances';
import { formatPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Stable per-person tint, hashed from the name so the same person keeps the
 * same colour everywhere. Mirrors Avatar's tintFor() in the design system.
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
 * Bubble cluster geometry, copied verbatim from the design system.
 *
 * Every value is a fraction of the container's WIDTH — including the vertical
 * ones and the container's own height. That is the whole trick: scale the
 * column and the discs scale together, so the cluster never self-intersects at
 * any width. Do not round these and do not convert y to a fraction of height.
 */
const BUBBLE_LAYOUT = [
  { x: 0.32, y: 0.0, d: 0.42 },
  { x: 0.02, y: 0.04, d: 0.26 },
  { x: 0.04, y: 0.32, d: 0.3 },
  { x: 0.66, y: 0.4, d: 0.24 },
  { x: 0.38, y: 0.44, d: 0.2 },
] as const;
const BUBBLE_ASPECT = 0.64; // container height = width * this

const BUBBLE_TINTS = [
  'bg-tint-teal',
  'bg-tint-coral',
  'bg-tint-sand',
  'bg-tint-olive',
  'bg-tint-slate',
] as const;

type Position = { group_id: string; my_member_id: string; net_minor: unknown };
type MemberRow = { group_id: string; display_name: string; user_id: string | null };
type ExpenseRow = { group_id: string; amount_minor: unknown };

export default async function GroupsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // First real round-trip through RLS. Signed in as `authenticated`, so the
  // groups_select policy limits this to groups the user belongs to or created.
  const { data: groups, error } = await supabase
    .from('groups')
    .select('id, name, group_type, created_at')
    .is('archived_at', null) // archived groups are hidden, not deleted
    .order('created_at', { ascending: false });

  const groupIds = (groups ?? []).map((g) => g.id);

  // All balances in ONE call. Calling group_balances(gid) per group would be
  // the N+1 that my_group_positions() exists to remove.
  // Members and expense totals are batched across every group in one query
  // each — never per group.
  const [positionsRes, membersRes, expensesRes] = await Promise.all([
    supabase.rpc('my_group_positions'),
    groupIds.length
      ? supabase
          .from('group_members')
          .select('group_id, display_name, user_id')
          .in('group_id', groupIds)
          .order('joined_at', { ascending: true })
      : Promise.resolve({ data: [] as MemberRow[], error: null }),
    groupIds.length
      ? supabase
          .from('expenses')
          .select('group_id, amount_minor')
          .in('group_id', groupIds)
          .eq('is_deleted', false)
      : Promise.resolve({ data: [] as ExpenseRow[], error: null }),
  ]);

  // Any read failing is reported the same way: a human sentence on screen, the
  // real message to the server log. A refusal must never surface as RLS text.
  const readError = error || positionsRes.error || membersRes.error || expensesRes.error;
  if (readError) {
    console.error('groups page read failed:', readError.message);
  }

  // Keyed by group_id, never by array position. A group can appear in the list
  // with NO matching position row — the known case is a creator who has no
  // group_members row — and that must render as "no balance", not as another
  // group's figure.
  const netByGroup = new Map<string, bigint>();
  const totalByGroup = new Map<string, bigint>();
  const membersByGroup = new Map<string, MemberRow[]>();
  let moneyError: string | null = null;

  try {
    for (const p of (positionsRes.data ?? []) as Position[]) {
      // toPaise throws rather than silently rounding — PostgREST hands bigint
      // over as a string, and Number() on it would be a real money bug.
      netByGroup.set(p.group_id, toPaise(p.net_minor));
    }
    for (const e of (expensesRes.data ?? []) as ExpenseRow[]) {
      totalByGroup.set(e.group_id, (totalByGroup.get(e.group_id) ?? 0n) + toPaise(e.amount_minor));
    }
  } catch (e) {
    console.error('groups page money conversion failed:', (e as Error).message);
    moneyError = 'balances';
  }

  for (const m of (membersRes.data ?? []) as MemberRow[]) {
    const list = membersByGroup.get(m.group_id) ?? [];
    list.push(m);
    membersByGroup.set(m.group_id, list);
  }

  // The caller's position across everything. Summed over BigInt in application
  // code, then formatted once — no float touches this path.
  const grandTotal = [...netByGroup.values()].reduce((a, b) => a + b, 0n);

  // Largest first, so the biggest group lands in the biggest disc.
  const bubbles = (groups ?? [])
    .map((g) => ({ name: g.name, total: totalByGroup.get(g.id) ?? 0n }))
    .filter((b) => b.total > 0n)
    .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0))
    .slice(0, BUBBLE_LAYOUT.length);

  const count = groups?.length ?? 0;

  return (
    <main
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 py-6"
      style={{ paddingInline: 'var(--gutter)' }}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="page-title">Your groups</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {count} active &middot; balances update when a payment is confirmed
          </p>
        </div>

        {/* The avatar is the route to Profile, as in the design. */}
        <Link
          href="/profile"
          aria-label="Profile"
          className={`avatar size-9 text-sm ${tintFor(user.email ?? '')}`}
        >
          {(user.email ?? '?').trim().charAt(0).toUpperCase()}
        </Link>
      </header>

      {readError || moneyError ? (
        <p className="notice-error" role="alert">
          We couldn&rsquo;t load your groups. Refresh, or sign in again if this keeps
          happening.
        </p>
      ) : count > 0 ? (
        <>
          {/* Position card. Green only when money comes back, red only when it
              is owed — the reserved meanings, never decoration. */}
          <div className="card flex items-center justify-between">
            <div>
              <p className="khata-label">
                {grandTotal < 0n
                  ? 'You owe overall'
                  : grandTotal > 0n
                    ? 'You get back overall'
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

          {bubbles.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="khata-label">Group totals</h2>
              {/* Height is a fraction of WIDTH, matching the geometry above.
                  aspect-ratio does exactly that without measuring in JS. */}
              <div className="relative w-full" style={{ aspectRatio: `1 / ${BUBBLE_ASPECT}` }}>
                {bubbles.map((b, i) => {
                  const s = BUBBLE_LAYOUT[i];
                  return (
                    <span
                      key={b.name}
                      title={b.name}
                      className={`bubble ${BUBBLE_TINTS[i % BUBBLE_TINTS.length]}`}
                      style={{
                        left: `${s.x * 100}%`,
                        top: `${(s.y / BUBBLE_ASPECT) * 100}%`,
                        width: `${s.d * 100}%`,
                        aspectRatio: '1 / 1',
                        padding: `${s.d * 16}%`,
                      }}
                    >
                      <span className="figure text-[0.7rem] font-medium">
                        {formatPaise(b.total)}
                      </span>
                      {s.d > 0.28 && (
                        <span className="text-[0.6rem] leading-tight text-ink-soft">{b.name}</span>
                      )}
                    </span>
                  );
                })}
              </div>
            </section>
          )}

          <section className="flex flex-col gap-2">
            <h2 className="khata-label">All groups</h2>
            <div className="card card-flush">
              <ul className="ledger border-t-0 border-b-0">
                {groups!.map((g) => {
                  // Looked up by id. A missing entry means no position row for
                  // this group, which renders neutral rather than borrowing
                  // some other group's number.
                  const net = netByGroup.get(g.id);
                  const members = membersByGroup.get(g.id) ?? [];
                  return (
                    <li key={g.id}>
                      <Link href={`/groups/${g.id}`} className="ledger-row ledger-link">
                        <span className="flex min-w-0 flex-col gap-1">
                          <span className="truncate font-medium">{g.name}</span>
                          {members.length > 0 && (
                            <span className="avatar-stack flex items-center">
                              {members.slice(0, 5).map((m, i) => (
                                <span
                                  key={`${g.id}-${i}`}
                                  title={m.display_name}
                                  className={`avatar size-5 text-[0.55rem] ${
                                    m.user_id === null
                                      ? 'avatar-placeholder'
                                      : tintFor(m.display_name)
                                  }`}
                                >
                                  {m.display_name.trim().charAt(0).toUpperCase() || '?'}
                                </span>
                              ))}
                              {members.length > 5 && (
                                <span className="avatar size-5 bg-sunken text-[0.55rem] text-ink-soft">
                                  +{members.length - 5}
                                </span>
                              )}
                            </span>
                          )}
                        </span>

                        {net === undefined ? (
                          <span className="chip chip-quiet">{g.group_type}</span>
                        ) : net === 0n ? (
                          <span className="chip chip-quiet">settled up</span>
                        ) : (
                          <span
                            className={`figure shrink-0 text-sm font-medium ${
                              net > 0n ? 'text-credit' : 'text-debit'
                            }`}
                          >
                            {net > 0n ? '+' : '−'}
                            {formatPaise(net > 0n ? net : -net)}
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
          <p className="khata-label">Nothing entered yet</p>
          <p className="mt-1 max-w-xs text-sm text-ink-soft">
            Create a group for a trip, a flat, or a one-off event, then start adding expenses.
          </p>
        </div>
      )}

      <Link href="/groups/new" className="btn btn-quiet btn-block">
        Create group
      </Link>
    </main>
  );
}
