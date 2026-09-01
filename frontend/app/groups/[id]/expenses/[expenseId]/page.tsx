import { Pencil } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { toPaise } from '@/lib/balances';
import { formatPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';

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

/**
 * share_type vocabulary is equal | exact | percentage. A custom split stores
 * `exact` — the word "custom" is a UI concept and never reaches the column.
 */
const SPLIT_MODE: Record<string, string> = {
  equal: 'equally',
  exact: 'by exact amounts',
  percentage: 'by percentage',
};

/**
 * Read-only detail view for one expense.
 *
 * This screen RECOMPUTES NOTHING. It reads expense_splits.share_minor exactly as
 * create_expense / update_expense stored it, in group-member order — which is the
 * order the +1-paise remainder was handed out in, so the rows read top-down the
 * way the split was actually computed. Re-deriving or re-sorting here would be a
 * second, competing source of truth for money that is already settled.
 */
export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string; expenseId: string }>;
}) {
  const { id, expenseId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/groups/${id}/expenses/${expenseId}`)}`);
  }

  // expenses_select is scoped to group members, so a non-member sees nothing.
  const { data: expense } = await supabase
    .from('expenses')
    .select('id, group_id, paid_by, amount_minor, description, created_at, is_deleted')
    .eq('id', expenseId)
    .eq('group_id', id)
    .maybeSingle();

  if (!expense || expense.is_deleted) notFound();

  // This page reads expenses, not groups, so the archived state has to be
  // checked explicitly rather than falling out of the group query.
  const { data: liveGroup } = await supabase
    .from('groups')
    .select('id')
    .eq('id', id)
    .is('archived_at', null)
    .maybeSingle();
  if (!liveGroup) notFound();

  const [{ data: members, error: membersError }, { data: splits, error: splitsError }] =
    await Promise.all([
      supabase
        .from('group_members')
        .select('id, user_id, display_name, upi_id')
        .eq('group_id', id)
        .order('joined_at', { ascending: true }),
      supabase
        .from('expense_splits')
        .select('id, member_id, share_minor, share_type')
        .eq('expense_id', expenseId),
    ]);

  const readError = membersError || splitsError;
  if (readError) {
    // The real message goes to the server log; the screen stays human.
    console.error(`expense ${expenseId} read failed:`, readError.message);
  }

  const byId = new Map((members ?? []).map((m) => [m.id, m]));

  // Group-member order — the order the split was computed in. Not a re-sort by
  // amount or name; this ordering carries information.
  const order = new Map((members ?? []).map((m, i) => [m.id, i]));
  const rows = [...(splits ?? [])].sort(
    (a, b) => (order.get(a.member_id) ?? 0) - (order.get(b.member_id) ?? 0),
  );

  // Fail-closed: toPaise throws rather than silently rounding, and a figure we
  // cannot trust is not rendered at all.
  let total = 0n;
  let sharesTotal = 0n;
  const shareByRow = new Map<string, bigint>();
  let moneyError = false;
  try {
    total = toPaise(expense.amount_minor);
    for (const s of rows) {
      const share = toPaise(s.share_minor);
      shareByRow.set(s.id, share);
      sharesTotal += share;
    }
  } catch (e) {
    console.error(`expense ${expenseId} money conversion failed:`, (e as Error).message);
    moneyError = true;
  }

  const failed = !!readError || moneyError;

  const payer = byId.get(expense.paid_by);
  const payerName = payer?.display_name ?? 'Unknown';
  const payerIsPlaceholder = payer ? payer.user_id === null : false;
  const myMemberId = (members ?? []).find((m) => m.user_id === user.id)?.id ?? null;

  // Every row of one expense carries the same share_type; read it off the data
  // rather than inferring the mode from the numbers.
  const shareType = rows[0]?.share_type ?? 'equal';
  const modeLabel = SPLIT_MODE[shareType] ?? shareType;

  return (
    <main
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 py-6"
      style={{ paddingInline: 'var(--gutter)' }}
    >
      <header className="min-w-0">
        <Link href={`/groups/${id}`} className="link-back">
          &larr; Back to group
        </Link>
        <h1 className="page-title pt-1">{expense.description || 'Expense'}</h1>
        <p className="figure mt-1 text-sm text-ink-soft">
          {payerName} paid &middot;{' '}
          {new Date(expense.created_at).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </p>
      </header>

      {failed ? (
        <p className="notice-error" role="alert">
          We couldn&rsquo;t load this expense. Refresh, or sign in again if this keeps
          happening.
        </p>
      ) : (
        <>
          <div className="card card-brand">
            <p className="khata-label text-brand">Amount</p>
            <p className="figure display-title mt-1">{formatPaise(total)}</p>
          </div>

          {/* Paid by — the credit side of this entry. The payer is up this money
              and gets it back through the split below, so tone="credit" here is
              literal, not decorative. */}
          <section className="flex flex-col gap-2">
            <h2 className="khata-label">Paid by</h2>
            <div className="card card-flush">
              <ul className="ledger border-t-0 border-b-0">
                <li className="ledger-row">
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      title={payerName}
                      className={`avatar size-8 text-xs ${
                        payerIsPlaceholder ? 'avatar-placeholder' : tintFor(payerName)
                      }`}
                    >
                      {initial(payerName)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{payerName}</span>
                      <span className="figure block truncate text-xs text-ink-faint">
                        {payer?.upi_id ?? 'No UPI ID'}
                      </span>
                    </span>
                  </span>
                  <span className="figure shrink-0 text-sm font-medium text-credit">
                    +{formatPaise(total)}
                  </span>
                </li>
              </ul>
            </div>
            <p className="hint">
              {payerName} is up {formatPaise(total)} on this expense and gets it back
              through the split below.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="khata-label">
                Split {rows.length} {rows.length === 1 ? 'way' : 'ways'}, {modeLabel}
              </h2>
              <span className="chip chip-quiet">{shareType}</span>
            </div>

            <div className="card card-flush">
              <ul className="ledger border-t-0 border-b-0">
                {rows.map((s) => {
                  const m = byId.get(s.member_id);
                  const name = m?.display_name ?? 'Unknown';
                  const isMe = m?.id === myMemberId;
                  const isPlaceholder = m?.user_id === null;
                  const share = shareByRow.get(s.id) ?? 0n;
                  return (
                    <li key={s.id} className="ledger-row">
                      <span className="flex min-w-0 items-center gap-3">
                        <span
                          title={name}
                          className={`avatar size-8 text-xs ${
                            isPlaceholder ? 'avatar-placeholder' : tintFor(name)
                          }`}
                        >
                          {initial(name)}
                        </span>
                        <span className="min-w-0 truncate text-sm">
                          {isMe ? (
                            <>
                              You{' '}
                              <span className="text-ink-faint">&middot; your share</span>
                            </>
                          ) : (
                            name
                          )}
                          {isPlaceholder && (
                            <span className="chip chip-quiet ml-2">not joined yet</span>
                          )}
                        </span>
                      </span>

                      <span className="flex shrink-0 items-center gap-2">
                        {m?.id === expense.paid_by && (
                          <span className="chip chip-quiet">paid</span>
                        )}
                        <span
                          className={`figure text-sm font-medium ${isMe ? 'text-debit' : ''}`}
                        >
                          {formatPaise(share)}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>

              {/* Kept even though create_expense / update_expense assert the sum
                  server-side: if stored data ever disagrees, the screen says so. */}
              <div
                className={`ledger-total ${sharesTotal === total ? '' : 'ledger-total-bad'}`}
              >
                <span className="khata-label">Shares add up to</span>
                <span
                  className={`figure text-sm font-medium ${
                    sharesTotal === total ? '' : 'text-debit'
                  }`}
                >
                  {formatPaise(sharesTotal)}
                  {sharesTotal !== total && ` (expected ${formatPaise(total)})`}
                </span>
              </div>
            </div>

            {rows.length > 1 && (
              <p className="hint">
                Shares always add up to the exact amount. Any leftover paise from an
                uneven split went to the people at the top of this list.
              </p>
            )}
          </section>

          {/* The route's only action. Delete lives on the edit screen, and every
              group member may edit — expenses_update is is_group_member(group_id),
              so there is deliberately no role gating here. */}
          <Link
            href={`/groups/${id}/expenses/${expenseId}/edit`}
            className="btn btn-quiet btn-block"
          >
            <Pencil size={16} strokeWidth={1.5} aria-hidden="true" />
            Edit expense
          </Link>
        </>
      )}
    </main>
  );
}
