import { Plus } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { toPaise } from '@/lib/balances';
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

type BalanceRow = { member_id: string; display_name: string; net_minor: unknown };

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

  const [
    { data: members, error: membersError },
    { data: expenses, error: expensesError },
    balancesRes,
    pendingRes,
  ] = await Promise.all([
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
    // Every member's net for THIS ONE group, in a single call. This is the
    // per-group RPC doing exactly what it is for — not the N+1 that
    // my_group_positions() replaced, which was calling this once per group on
    // the home screen.
    supabase.rpc('group_balances', { gid: id }),
    supabase
      .from('settlements')
      .select('id, from_member, to_member, amount_minor')
      .eq('group_id', id)
      .eq('status', 'pending'),
  ]);

  const readError = membersError || expensesError || balancesRes.error || pendingRes.error;
  if (readError) {
    // The real message goes to the server log; the screen says something human.
    console.error(`group ${id} read failed:`, readError.message);
  }

  // Money conversion is fail-closed: toPaise throws rather than rounding, and a
  // figure we cannot trust is not rendered at all.
  const netByMember = new Map<string, bigint>();
  let spentTotal = 0n;
  let moneyError = false;
  try {
    for (const b of (balancesRes.data ?? []) as BalanceRow[]) {
      netByMember.set(b.member_id, toPaise(b.net_minor));
    }
    for (const e of expenses ?? []) {
      spentTotal += toPaise(e.amount_minor);
    }
  } catch (e) {
    console.error(`group ${id} money conversion failed:`, (e as Error).message);
    moneyError = true;
  }

  const failed = !!readError || moneyError;

  const allMembers = members ?? [];
  const myMemberId = allMembers.find((m) => m.user_id === user.id)?.id ?? null;
  const myNet = myMemberId ? netByMember.get(myMemberId) : undefined;

  // Anything still awaiting the payee's confirmation. It changes no balance yet,
  // which is exactly why it is worth surfacing here.
  const pending = pendingRes.data ?? [];
  const memberName = new Map(allMembers.map((m) => [m.id, m.display_name]));

  return (
    <main
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 py-6"
      style={{ paddingInline: 'var(--gutter)' }}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/groups" className="link-back">
            &larr; All groups
          </Link>
          <h1 className="page-title pt-1">{group.name}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {TYPE_LABEL[group.group_type] ?? group.group_type} &middot; {allMembers.length}{' '}
            {allMembers.length === 1 ? 'member' : 'members'}
          </p>
        </div>

        <span className="avatar-stack flex shrink-0 items-center">
          {allMembers.slice(0, 5).map((m) => (
            <span
              key={m.id}
              title={m.display_name}
              className={`avatar size-6 text-[0.6rem] ${
                m.user_id === null ? 'avatar-placeholder' : tintFor(m.display_name)
              }`}
            >
              {initial(m.display_name)}
            </span>
          ))}
        </span>
      </header>

      {failed && (
        <p className="notice-error" role="alert">
          We couldn&rsquo;t load this group. Refresh, or sign in again if this keeps
          happening.
        </p>
      )}

      {/* Position card — the caller's own net here, and the way through to the
          full who-owes-whom breakdown. Reserved tokens only. */}
      {!failed && (
        <Link
          href={`/groups/${group.id}/balances`}
          className={`card flex items-center justify-between ${
            myNet === undefined || myNet === 0n ? 'card-sunken' : ''
          }`}
        >
          <span>
            <span
              className={`khata-label block ${
                myNet === undefined || myNet === 0n
                  ? ''
                  : myNet > 0n
                    ? 'text-credit'
                    : 'text-debit'
              }`}
            >
              {myNet === undefined
                ? 'Your balance'
                : myNet === 0n
                  ? 'Settled up'
                  : myNet > 0n
                    ? 'You get back'
                    : 'You owe'}
            </span>
            <span
              className={`figure mt-1.5 block text-2xl font-semibold ${
                myNet === undefined || myNet === 0n
                  ? ''
                  : myNet > 0n
                    ? 'text-credit'
                    : 'text-debit'
              }`}
            >
              {formatPaise(myNet === undefined ? 0n : myNet < 0n ? -myNet : myNet)}
            </span>
          </span>
          <span className="khata-label shrink-0">Who owes whom &rarr;</span>
        </Link>
      )}

      {!failed && pending.length > 0 && (
        <p className="notice-pending">
          {pending.length === 1
            ? `${memberName.get(pending[0].from_member) ?? 'Someone'} marked ${formatPaise(
                toPaise(pending[0].amount_minor),
              )} paid to ${memberName.get(pending[0].to_member) ?? 'someone'}.`
            : `${pending.length} payments are waiting to be confirmed.`}{' '}
          Confirm it in Balances — it does not change anything yet.
        </p>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="khata-label">Expenses</h2>
          <Link href={`/groups/${group.id}/expenses/new`} className="btn btn-primary btn-sm">
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            Add expense
          </Link>
        </div>

        {failed ? null : (expenses ?? []).length === 0 ? (
          <p className="empty text-sm text-ink-soft">No expenses yet.</p>
        ) : (
          <div className="card card-flush">
            <ul className="ledger border-t-0 border-b-0">
              {(expenses ?? []).map((e) => {
                const ways = (e.expense_splits ?? []).length;
                const payer = memberName.get(e.paid_by) ?? 'Unknown';
                const payerIsPlaceholder =
                  allMembers.find((m) => m.id === e.paid_by)?.user_id === null;
                return (
                  <li key={e.id}>
                    <Link
                      href={`/groups/${group.id}/expenses/${e.id}`}
                      className="ledger-row ledger-link"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span
                          title={payer}
                          className={`avatar size-8 text-xs ${
                            payerIsPlaceholder ? 'avatar-placeholder' : tintFor(payer)
                          }`}
                        >
                          {initial(payer)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {e.description || 'Expense'}
                          </span>
                          <span className="block truncate text-xs text-ink-faint">
                            {payer} paid &middot; split {ways} {ways === 1 ? 'way' : 'ways'}{' '}
                            &middot;{' '}
                            {new Date(e.created_at).toLocaleDateString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                            })}
                          </span>
                        </span>
                      </span>
                      <span className="figure shrink-0 font-medium">
                        {formatPaise(toPaise(e.amount_minor))}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="ledger-total">
              <span className="khata-label">Spent by the group</span>
              <span className="figure text-sm font-semibold">{formatPaise(spentTotal)}</span>
            </div>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="khata-label">Members</h2>

        {failed ? null : (
          <div className="card card-flush">
            <ul className="ledger border-t-0 border-b-0">
              {allMembers.map((m) => {
                const net = netByMember.get(m.id);
                const isPlaceholder = m.user_id === null;
                return (
                  <li key={m.id} className="ledger-row">
                    <span className="flex min-w-0 items-center gap-3">
                      <span
                        title={m.display_name}
                        className={`avatar size-8 text-xs ${
                          isPlaceholder ? 'avatar-placeholder' : tintFor(m.display_name)
                        }`}
                      >
                        {initial(m.display_name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {m.display_name}
                          {m.user_id === user.id && (
                            <span className="ml-2 text-xs font-normal text-ink-faint">you</span>
                          )}
                          {m.role === 'admin' && (
                            <span className="ml-2 text-xs font-normal text-ink-faint">
                              &middot; admin
                            </span>
                          )}
                        </span>
                        <span className="figure block truncate text-xs text-ink-faint">
                          {m.upi_id ?? 'No UPI ID'}
                          {isPlaceholder && (
                            <span className="chip chip-pending ml-2">not joined</span>
                          )}
                        </span>
                      </span>
                    </span>

                    {net === undefined ? (
                      <span className="khata-label shrink-0">no balance</span>
                    ) : net === 0n ? (
                      <span className="khata-label shrink-0">settled up</span>
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
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      <div className="flex flex-col gap-2">
        <ShareLink joinCode={group.join_code} />
        <AddMemberForm groupId={group.id} />
      </div>
    </main>
  );
}
