import { Plus } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { toPaise } from '@/lib/balances';
import { formatPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';

import { FriendSettle } from './friend-settle';

export const dynamic = 'force-dynamic';

/** Stable per-person tint, hashed from the name. Mirrors the design's tintFor(). */
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

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

type FriendPosition = {
  group_id: string;
  my_member_id: string;
  counterparty_member_id: string;
  counterparty_user_id: string | null;
  name: string;
  upi: string | null;
  net_minor: unknown;
};

type ExpenseRow = {
  id: string;
  description: string | null;
  amount_minor: unknown;
  paid_by: string;
  created_at: string;
  expense_splits: { member_id: string; share_minor: unknown }[] | null;
};

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

  // The tab is resolved through the RPC rather than a groups read: it returns
  // only kind='friend' tabs the caller is a member of, with the counterparty and
  // signed net already resolved. An id outside that list 404s, so the page never
  // confirms whether some other group exists.
  const [positionsRes, expensesRes] = await Promise.all([
    supabase.rpc('my_friend_positions'),
    supabase
      .from('expenses')
      .select('id, description, amount_minor, paid_by, created_at, expense_splits(member_id, share_minor)')
      .eq('group_id', id)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false }),
  ]);

  const readError = positionsRes.error || expensesRes.error;
  if (readError) {
    console.error(`friend ${id} read failed:`, readError.message);
  }

  const tab = ((positionsRes.data ?? []) as FriendPosition[]).find((p) => p.group_id === id);
  if (!tab) notFound();

  // Money conversion is fail-closed: toPaise throws rather than rounding, and a
  // figure we cannot trust is not rendered at all.
  let net: bigint | null = null;
  let spentTotal = 0n;
  const myShare = new Map<string, bigint>();
  let moneyError = false;
  try {
    net = toPaise(tab.net_minor);
    for (const e of (expensesRes.data ?? []) as ExpenseRow[]) {
      spentTotal += toPaise(e.amount_minor);
      const mine = (e.expense_splits ?? []).find((s) => s.member_id === tab.my_member_id);
      if (mine) myShare.set(e.id, toPaise(mine.share_minor));
    }
  } catch (e) {
    console.error(`friend ${id} money conversion failed:`, (e as Error).message);
    moneyError = true;
  }

  const failed = !!readError || moneyError;
  const isPlaceholder = tab.counterparty_user_id === null;
  const expenses = (expensesRes.data ?? []) as ExpenseRow[];

  // Direction, from the caller's point of view. > 0 they owe you, < 0 you owe.
  const theyOwe = net !== null && net > 0n;
  const iOwe = net !== null && net < 0n;
  const settled = net !== null && net === 0n;

  return (
    <main
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 py-6"
      style={{ paddingInline: 'var(--gutter)' }}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/friends" className="link-back">
            &larr; Friends
          </Link>
          <h1 className="page-title truncate pt-1">{tab.name}</h1>
          {/* A real friend shows their UPI ID — the thing you would pay to. A
              placeholder has no account, and says so plainly. */}
          <p className="figure mt-1 truncate text-sm text-ink-soft">
            {isPlaceholder ? 'Private tab · not on SplitApp' : (tab.upi ?? 'No UPI ID')}
          </p>
        </div>

        <span
          aria-hidden="true"
          className={`avatar size-10 shrink-0 text-base ${
            isPlaceholder ? 'avatar-placeholder' : tintFor(tab.name)
          }`}
        >
          {initial(tab.name)}
        </span>
      </header>

      {failed && (
        <p className="notice-error" role="alert">
          We couldn&rsquo;t load this tab. Refresh, or sign in again if this keeps
          happening.
        </p>
      )}

      {/* ---- balance card: direction decides the treatment ----
          Credit green only when money comes back, debit red only when it is
          owed, calm sunken card when settled. Absolute value always — the
          direction is in the label, never in a minus sign. */}
      {!failed && net !== null && (
        <div className={`card ${settled ? 'card-sunken' : ''}`}>
          <p
            className={`khata-label ${theyOwe ? 'text-credit' : iOwe ? 'text-debit' : ''}`}
          >
            {settled ? 'Settled up' : theyOwe ? `${tab.name} owes you` : `You owe ${tab.name}`}
          </p>
          <p
            className={`figure mt-1.5 text-3xl font-semibold ${
              theyOwe ? 'text-credit' : iOwe ? 'text-debit' : ''
            }`}
          >
            {formatPaise(net < 0n ? -net : net)}
          </p>
          {settled && (
            <p className="hint mt-1.5">Nothing outstanding between you.</p>
          )}
        </div>
      )}

      {/* ---- settle / remind: only when there is something to settle ---- */}
      {!failed && net !== null && !settled && (
        <FriendSettle
          groupId={id}
          myMemberId={tab.my_member_id}
          counterpartyMemberId={tab.counterparty_member_id}
          counterpartyName={tab.name}
          isPlaceholder={isPlaceholder}
          netMinor={net.toString()}
        />
      )}

      {/* ---- the ledger ---- */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="khata-label">Entries</h2>
          <Link href={`/friends/${id}/expenses/new`} className="btn btn-primary btn-sm">
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            Add expense
          </Link>
        </div>

        {failed ? null : expenses.length === 0 ? (
          <p className="empty text-sm text-ink-soft">
            No entries yet. Add the first thing one of you paid for.
          </p>
        ) : (
          <div className="card card-flush">
            <ul className="ledger border-t-0 border-b-0">
              {expenses.map((e) => {
                const paidByMe = e.paid_by === tab.my_member_id;
                const payerName = paidByMe ? 'You' : tab.name;
                const share = myShare.get(e.id);
                return (
                  <li key={e.id} className="ledger-row">
                    <span className="flex min-w-0 items-center gap-3">
                      <span
                        aria-hidden="true"
                        className={`avatar size-8 shrink-0 text-xs ${
                          paidByMe
                            ? tintFor(user.email ?? 'you')
                            : isPlaceholder
                              ? 'avatar-placeholder'
                              : tintFor(tab.name)
                        }`}
                      >
                        {paidByMe ? 'Y' : initial(tab.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {e.description || 'Expense'}
                        </span>
                        <span className="block truncate text-xs text-ink-faint">
                          {payerName} paid &middot;{' '}
                          {new Date(e.created_at).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </span>
                      </span>
                    </span>

                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="figure text-sm font-medium">
                        {formatPaise(toPaise(e.amount_minor))}
                      </span>
                      {share !== undefined && (
                        <span className="text-[0.625rem] leading-none text-ink-faint">
                          your share {formatPaise(share)}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="ledger-total">
              <span className="khata-label">Spent together</span>
              <span className="figure text-sm font-semibold">{formatPaise(spentTotal)}</span>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
