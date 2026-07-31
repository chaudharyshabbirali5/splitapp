import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { formatPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';

import { AddMemberForm } from './add-member-form';
import { ShareLink } from './share-link';

export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = {
  flat: 'Flat',
  trip: 'Trip',
  event: 'Event',
  other: 'Other',
};

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/groups/${id}`)}`);

  // groups_select limits this to groups the user is a member of or created, so a
  // non-member gets no row. 404 rather than "forbidden" — that way the page does
  // not confirm whether the group exists.
  const { data: group } = await supabase
    .from('groups')
    .select('id, name, group_type, join_code, created_by')
    .eq('id', id)
    .maybeSingle();

  if (!group) notFound();

  const [{ data: members, error: membersError }, { data: expenses, error: expensesError }] =
    await Promise.all([
      supabase
        .from('group_members')
        .select('id, user_id, display_name, upi_id, role, joined_at')
        .eq('group_id', id)
        .order('joined_at', { ascending: true }),
      supabase
        .from('expenses')
        .select('id, description, amount_minor, paid_by, created_at, expense_splits(id)')
        .eq('group_id', id)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false }),
    ]);

  const joined = (members ?? []).filter((m) => m.user_id !== null);
  const placeholders = (members ?? []).filter((m) => m.user_id === null);

  // paid_by references group_members; resolve names here rather than relying on
  // a PostgREST embed, which needs the FK constraint name.
  const memberName = new Map((members ?? []).map((m) => [m.id, m.display_name]));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-6 sm:p-10">
      <header className="space-y-1">
        <Link
          href="/groups"
          className="text-sm underline underline-offset-4 text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-white"
        >
          &larr; All groups
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{group.name}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {TYPE_LABEL[group.group_type] ?? group.group_type} &middot; {(members ?? []).length}{' '}
          {(members ?? []).length === 1 ? 'member' : 'members'}
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Members</h2>

        {membersError ? (
          <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            Could not load members: {membersError.message}
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {[...joined, ...placeholders].map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {m.display_name}
                    {m.user_id === user.id && (
                      <span className="ml-2 text-xs font-normal text-zinc-500">you</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {m.upi_id ?? 'No UPI ID'}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {m.role === 'admin' && (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      admin
                    </span>
                  )}
                  {m.user_id === null ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      not joined yet
                    </span>
                  ) : (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-950 dark:text-green-300">
                      joined
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Expenses</h2>
          <Link
            href={`/groups/${group.id}/expenses/new`}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Add expense
          </Link>
        </div>

        {expensesError ? (
          <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            Could not load expenses: {expensesError.message}
          </p>
        ) : (expenses ?? []).length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 px-6 py-10 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
            No expenses yet.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {(expenses ?? []).map((e) => {
              const ways = (e.expense_splits ?? []).length;
              return (
                <li key={e.id}>
                  <Link
                    href={`/groups/${group.id}/expenses/${e.id}/edit`}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {e.description || 'Expense'}
                      </p>
                      <p className="truncate text-xs text-zinc-500">
                        {memberName.get(e.paid_by) ?? 'Unknown'} paid &middot; split {ways}{' '}
                        {ways === 1 ? 'way' : 'ways'} &middot;{' '}
                        {new Date(e.created_at).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </p>
                    </div>
                    <span className="shrink-0 font-medium tabular-nums">
                      {formatPaise(Number(e.amount_minor))}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Add someone not on SplitApp
        </h2>
        <AddMemberForm groupId={group.id} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Invite</h2>
        <ShareLink joinCode={group.join_code} />
      </section>
    </main>
  );
}
