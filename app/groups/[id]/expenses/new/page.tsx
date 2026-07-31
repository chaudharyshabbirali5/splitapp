import { notFound, redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

import { createExpense } from '../actions';
import { ExpenseForm, type MemberOption } from '../expense-form';

export const dynamic = 'force-dynamic';

export default async function NewExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/groups/${id}/expenses/new`)}`);

  // RLS: a non-member sees no row here, so this doubles as the access check.
  const { data: group } = await supabase
    .from('groups')
    .select('id, name')
    .eq('id', id)
    .maybeSingle();
  if (!group) notFound();

  const { data: members } = await supabase
    .from('group_members')
    .select('id, user_id, display_name')
    .eq('group_id', id)
    .order('joined_at', { ascending: true });

  const options: MemberOption[] = (members ?? []).map((m) => ({
    id: m.id,
    display_name: m.display_name,
    isPlaceholder: m.user_id === null,
  }));

  if (options.length === 0) notFound();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-6 sm:p-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Add expense</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{group.name}</p>
      </div>

      <ExpenseForm
        groupId={id}
        members={options}
        action={createExpense.bind(null, id)}
        submitLabel="Add expense"
      />
    </main>
  );
}
