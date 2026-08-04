import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { formatPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Read-only detail view for one expense.
 *
 * This is the screen that answers "what do I actually owe on this?", so it reads
 * expense_splits.share_minor and shows each participant's exact share. Nothing
 * here recomputes anything — the values are exactly what create_expense /
 * update_expense stored.
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

  const [{ data: members }, { data: splits, error: splitsError }] = await Promise.all([
    supabase
      .from('group_members')
      .select('id, user_id, display_name')
      .eq('group_id', id)
      .order('joined_at', { ascending: true }),
    supabase
      .from('expense_splits')
      .select('id, member_id, share_minor')
      .eq('expense_id', expenseId),
  ]);

  const byId = new Map((members ?? []).map((m) => [m.id, m]));
  const total = Number(expense.amount_minor);

  // Keep the group's member order so the +1-paise participants read top-down,
  // matching the order the split was computed in.
  const order = new Map((members ?? []).map((m, i) => [m.id, i]));
  const rows = [...(splits ?? [])].sort(
    (a, b) => (order.get(a.member_id) ?? 0) - (order.get(b.member_id) ?? 0),
  );

  const sharesTotal = rows.reduce((acc, s) => acc + Number(s.share_minor), 0);
  const payerName = byId.get(expense.paid_by)?.display_name ?? 'Unknown';

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 p-6 sm:p-10">
      <div className="space-y-1">
        <Link
          href={`/groups/${id}`}
          className="text-sm underline underline-offset-4 text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-white"
        >
          &larr; Back to group
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {expense.description || 'Expense'}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {payerName} paid &middot;{' '}
          {new Date(expense.created_at).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </p>
      </div>

      <p className="text-4xl font-semibold tabular-nums">{formatPaise(total)}</p>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Split {rows.length} {rows.length === 1 ? 'way' : 'ways'}, equally
        </h2>

        {splitsError ? (
          <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            Could not load the split: {splitsError.message}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {rows.map((s) => {
                const m = byId.get(s.member_id);
                return (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="min-w-0 truncate text-sm">
                      {m?.display_name ?? 'Unknown'}
                      {m?.user_id === null && (
                        <span className="ml-2 text-xs text-zinc-500">not joined yet</span>
                      )}
                      {m?.id === expense.paid_by && (
                        <span className="ml-2 text-xs text-zinc-500">paid</span>
                      )}
                    </span>
                    <span className="shrink-0 text-sm font-medium tabular-nums">
                      {formatPaise(Number(s.share_minor))}
                    </span>
                  </li>
                );
              })}
            </ul>

            {/* Shown so the rounding is auditable at a glance: the shares must
                equal the total exactly, even when the amount does not divide evenly. */}
            <div className="flex items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
              <span className="text-sm text-zinc-600 dark:text-zinc-400">Shares add up to</span>
              <span
                className={`text-sm font-medium tabular-nums ${
                  sharesTotal === total ? '' : 'text-red-600 dark:text-red-400'
                }`}
              >
                {formatPaise(sharesTotal)}
                {sharesTotal !== total && ` (expected ${formatPaise(total)})`}
              </span>
            </div>
          </div>
        )}

        {rows.length > 1 && (
          <p className="text-xs text-zinc-500">
            When the amount doesn&rsquo;t divide evenly, the leftover paise go to the people
            at the top of this list, so the shares always total the exact amount.
          </p>
        )}
      </section>

      <Link
        href={`/groups/${id}/expenses/${expenseId}/edit`}
        className="w-full rounded-md border border-zinc-300 px-4 py-2.5 text-center text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        Edit expense
      </Link>
    </main>
  );
}
