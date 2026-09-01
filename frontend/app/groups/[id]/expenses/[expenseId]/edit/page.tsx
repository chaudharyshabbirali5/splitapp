import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { toPaise } from '@/lib/balances';
import { formatPaise, paiseToRupeeInput } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';

import { softDeleteExpense, updateExpense } from '../../actions';
import { ExpenseForm, type MemberOption } from '../../expense-form';
import { DeleteExpense, type DeleteSummary } from './delete-expense';

export const dynamic = 'force-dynamic';

export default async function EditExpensePage({
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
    redirect(`/login?next=${encodeURIComponent(`/groups/${id}/expenses/${expenseId}/edit`)}`);
  }

  // expenses_select is scoped to group members, so a non-member gets nothing.
  const { data: expense } = await supabase
    .from('expenses')
    .select('id, group_id, paid_by, amount_minor, description, created_at, is_deleted')
    .eq('id', expenseId)
    .eq('group_id', id)
    .maybeSingle();

  if (!expense || expense.is_deleted) notFound();

  // Reads expenses rather than groups, so the archived state needs its own
  // check. The database refuses the write too, via the archived-group trigger.
  const { data: liveGroup } = await supabase
    .from('groups')
    .select('id')
    .eq('id', id)
    .is('archived_at', null)
    .maybeSingle();
  if (!liveGroup) notFound();

  const [{ data: members }, { data: splits }] = await Promise.all([
    supabase
      .from('group_members')
      .select('id, user_id, display_name')
      .eq('group_id', id)
      .order('joined_at', { ascending: true }),
    supabase.from('expense_splits').select('member_id').eq('expense_id', expenseId),
  ]);

  const options: MemberOption[] = (members ?? []).map((m) => ({
    id: m.id,
    display_name: m.display_name,
    isPlaceholder: m.user_id === null,
  }));

  const payer = (members ?? []).find((m) => m.id === expense.paid_by);
  const payerName = payer?.display_name ?? 'Unknown';

  // toPaise throws rather than silently rounding; the amount only reaches the
  // delete sheet as an already-formatted string.
  const summary: DeleteSummary = {
    description: expense.description || 'Expense',
    payerName,
    payerIsPlaceholder: payer ? payer.user_id === null : false,
    ways: (splits ?? []).length,
    dateLabel: new Date(expense.created_at).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }),
    amountLabel: formatPaise(toPaise(expense.amount_minor)),
  };

  return (
    <main
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 py-6"
      style={{ paddingInline: 'var(--gutter)' }}
    >
      <header className="min-w-0">
        <Link href={`/groups/${id}/expenses/${expenseId}`} className="link-back">
          &larr; Back to expense
        </Link>
        <h1 className="page-title pt-1">Edit expense</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Changing an expense recalculates everyone&rsquo;s balances.
        </p>
      </header>

      {/* The SAME shared form as add-expense, not a second copy. Only the label
          and the prefilled values differ; `initial` also switches on the
          dirty-state guard, so Save stays dead until something actually changes.
          Participants prefill, shares do not — the form is equal-split today. */}
      <ExpenseForm
        groupId={id}
        members={options}
        action={updateExpense.bind(null, id, expenseId)}
        submitLabel="Save changes"
        initial={{
          amount: paiseToRupeeInput(Number(expense.amount_minor)),
          description: expense.description ?? '',
          paidBy: expense.paid_by,
          participantIds: (splits ?? []).map((s) => s.member_id),
        }}
      />

      <div className="border-t border-rule pt-5">
        <DeleteExpense
          action={softDeleteExpense.bind(null, id, expenseId)}
          summary={summary}
        />
      </div>
    </main>
  );
}
