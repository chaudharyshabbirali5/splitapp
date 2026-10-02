import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

import { ExpenseForm, type MemberOption } from '../../../../groups/[id]/expenses/expense-form';
import { createFriendExpense } from '../../expense-actions';

export const dynamic = 'force-dynamic';

/**
 * Add an expense to a friend tab.
 *
 * The FORM is the group one, imported unchanged — custom split, the sum rule, the
 * AmountCell behaviour and the dirty guard all come along. Only the action
 * differs, because the groups action redirects into /groups afterwards.
 *
 * A friend tab has exactly two members (M2's cap trigger makes that a database
 * guarantee), so the participant picker shows two people and defaults to both:
 * the common case is a 50/50 split, and the uncommon one is already served by the
 * existing custom-split mode.
 *
 * isTabBarHidden already matches /<anything>/expenses/new, so the bottom nav
 * hides itself here exactly as it does on the group form — verified, not assumed.
 */
export default async function NewFriendExpensePage({
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

  // Resolved through the RPC, not a groups read: my_friend_positions returns only
  // kind='friend' tabs the caller belongs to, so an id outside that list 404s
  // without the page confirming whether the group exists.
  const { data: positions, error } = await supabase.rpc('my_friend_positions');
  if (error) {
    console.error(`friend ${id} expense-add read failed:`, error.message);
  }

  type Pos = { group_id: string; name: string };
  const tab = ((positions ?? []) as Pos[]).find((p) => p.group_id === id);
  if (!tab) notFound();

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
      <div className="space-y-1 border-b border-rule pb-4">
        <Link href={`/friends/${id}`} className="link-back">
          &larr; {tab.name}
        </Link>
        <h1 className="page-title pt-1">Add expense</h1>
        <p className="text-sm text-ink-soft">Your tab with {tab.name}</p>
      </div>

      <ExpenseForm
        groupId={id}
        members={options}
        action={createFriendExpense.bind(null, id)}
        submitLabel="Add expense"
      />
    </main>
  );
}
