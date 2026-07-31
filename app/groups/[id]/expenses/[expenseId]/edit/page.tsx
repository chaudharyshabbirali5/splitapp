import { notFound, redirect } from 'next/navigation';

import { paiseToRupeeInput } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';

import { softDeleteExpense, updateExpense } from '../../actions';
import { ExpenseForm, type MemberOption } from '../../expense-form';
import { DeleteExpense } from './delete-expense';

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
    .select('id, group_id, paid_by, amount_minor, description, is_deleted')
    .eq('id', expenseId)
    .eq('group_id', id)
    .maybeSingle();

  if (!expense || expense.is_deleted) notFound();

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

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-6 sm:p-10">
      <h1 className="text-2xl font-semibold tracking-tight">Edit expense</h1>

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

      <div className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <DeleteExpense action={softDeleteExpense.bind(null, id, expenseId)} />
      </div>
    </main>
  );
}
