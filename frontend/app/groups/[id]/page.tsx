import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { formatPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';

import { AddMemberForm } from './add-member-form';
import { ArchiveGroup } from './archive-group';
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
    .is('archived_at', null) // an archived group behaves as if it is gone
    .maybeSingle();

  if (!group) notFound();

  const isCreator = group.created_by === user.id;

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
      <header className="space-y-1 border-b border-rule pb-4">
        <Link href="/groups" className="link-back">
          &larr; All groups
        </Link>
        <h1 className="page-title pt-1">{group.name}</h1>
        <p className="text-sm text-ink-soft">
          {TYPE_LABEL[group.group_type] ?? group.group_type} &middot; {(members ?? []).length}{' '}
          {(members ?? []).length === 1 ? 'member' : 'members'}
        </p>
      </header>

      <Link
        href={`/groups/${group.id}/balances`}
        className="ledger ledger-row ledger-link"
      >
        <span className="text-sm font-medium">Balances</span>
        <span className="khata-label">Who owes whom &rarr;</span>
      </Link>

      <section className="space-y-3">
        <h2 className="khata-label">Members</h2>

        {membersError ? (
          <p className="notice-error">Could not load members: {membersError.message}</p>
        ) : (
          <ul className="ledger">
            {[...joined, ...placeholders].map((m) => (
              <li key={m.id} className="ledger-row">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {m.display_name}
                    {m.user_id === user.id && (
                      <span className="ml-2 text-xs font-normal text-ink-faint">you</span>
                    )}
                  </p>
                  <p className="figure truncate text-xs text-ink-faint">
                    {m.upi_id ?? 'No UPI ID'}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {m.role === 'admin' && <span className="chip chip-quiet">admin</span>}
                  {m.user_id === null ? (
                    <span className="chip chip-pending">not joined</span>
                  ) : (
                    <span className="chip chip-joined">joined</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="khata-label">Expenses</h2>
          <Link
            href={`/groups/${group.id}/expenses/new`}
            className="btn btn-primary btn-sm"
          >
            Add expense
          </Link>
        </div>

        {expensesError ? (
          <p className="notice-error">Could not load expenses: {expensesError.message}</p>
        ) : (expenses ?? []).length === 0 ? (
          <p className="empty text-sm text-ink-soft">No expenses yet.</p>
        ) : (
          <ul className="ledger">
            {(expenses ?? []).map((e) => {
              const ways = (e.expense_splits ?? []).length;
              return (
                <li key={e.id}>
                  <Link
                    href={`/groups/${group.id}/expenses/${e.id}`}
                    className="ledger-row ledger-link"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {e.description || 'Expense'}
                      </p>
                      <p className="truncate text-xs text-ink-faint">
                        {memberName.get(e.paid_by) ?? 'Unknown'} paid &middot; split {ways}{' '}
                        {ways === 1 ? 'way' : 'ways'} &middot;{' '}
                        {new Date(e.created_at).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </p>
                    </div>
                    <span className="figure shrink-0 font-medium">
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
        <h2 className="khata-label">Add someone not on SplitApp</h2>
        <AddMemberForm groupId={group.id} />
      </section>

      <section className="space-y-3">
        <h2 className="khata-label">Invite</h2>
        <ShareLink joinCode={group.join_code} />
      </section>

      {/* Creator-only. archive_group() and the groups_update policy both enforce
          this again server-side, so hiding it here is convenience, not security. */}
      {isCreator && (
        <section className="space-y-3 border-t border-rule pt-6">
          <h2 className="khata-label">Danger zone</h2>
          <ArchiveGroup groupId={group.id} groupName={group.name} />
        </section>
      )}
    </main>
  );
}
