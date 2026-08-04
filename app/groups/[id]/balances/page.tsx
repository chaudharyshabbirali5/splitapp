import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import {
  simplifyDebts,
  sumNets,
  toPaise,
  type NetBalance,
} from '@/lib/balances';
import { formatPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';

import { ConfirmButton } from './confirm-button';
import { confirmSettlement } from './settle-actions';
import { SettleRow } from './settle-row';

export const dynamic = 'force-dynamic';

export default async function BalancesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/groups/${id}/balances`)}`);

  // groups_select limits this to members, so a non-member falls through to 404.
  const { data: group } = await supabase
    .from('groups')
    .select('id, name')
    .eq('id', id)
    .is('archived_at', null) // archived groups are unreachable
    .maybeSingle();
  if (!group) notFound();

  const { data: pendingSettlements } = await supabase
    .from('settlements')
    .select('id, from_member, to_member, amount_minor, created_at')
    .eq('group_id', id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  const [{ data: members }, balances, { count: expenseCount }] = await Promise.all([
    supabase
      .from('group_members')
      .select('id, user_id, display_name, upi_id')
      .eq('group_id', id)
      .order('joined_at', { ascending: true }),
    // group_balances is SECURITY INVOKER, so RLS still applies: a non-member
    // would get an empty result rather than someone else's numbers.
    supabase.rpc('group_balances', { gid: id }),
    supabase
      .from('expenses')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', id)
      .eq('is_deleted', false),
  ]);

  if (balances.error) {
    return (
      <Shell groupId={id} groupName={group.name}>
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          Could not load balances: {balances.error.message}
        </p>
      </Shell>
    );
  }

  const memberById = new Map((members ?? []).map((m) => [m.id, m]));
  const order = new Map((members ?? []).map((m, i) => [m.id, i]));

  // toPaise throws rather than silently rounding if a value could not survive
  // the JSON round trip.
  let nets: NetBalance[];
  try {
    nets = (balances.data ?? []).map((row: { member_id: string; display_name: string; net_minor: unknown }) => {
      const m = memberById.get(row.member_id);
      return {
        memberId: row.member_id,
        displayName: row.display_name,
        isPlaceholder: m ? m.user_id === null : false,
        upiId: m?.upi_id ?? null,
        netMinor: toPaise(row.net_minor),
      };
    });
  } catch (e) {
    return (
      <Shell groupId={id} groupName={group.name}>
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          Balances could not be read safely: {e instanceof Error ? e.message : String(e)}
        </p>
      </Shell>
    );
  }

  nets.sort((a, b) => (order.get(a.memberId) ?? 0) - (order.get(b.memberId) ?? 0));

  const total = sumNets(nets);
  const payments = simplifyDebts(nets);
  const hasExpenses = (expenseCount ?? 0) > 0;

  // Which member row is the signed-in user? Only that row gets pay buttons —
  // you cannot settle, or claim to have settled, somebody else's debt.
  const myMemberId = (members ?? []).find((m) => m.user_id === user.id)?.id ?? null;

  return (
    <Shell groupId={id} groupName={group.name}>
      {!hasExpenses && (
        <p className="rounded-lg border border-dashed border-zinc-300 px-6 py-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          No expenses yet. Everyone starts at zero.
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Balances</h2>

        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {nets.map((n) => (
              <li key={n.memberId} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0 truncate text-sm">
                  {n.displayName}
                  {n.isPlaceholder && (
                    <span className="ml-2 text-xs text-zinc-500">not joined yet</span>
                  )}
                </span>

                {n.netMinor === 0n ? (
                  <span className="shrink-0 text-sm text-zinc-500">settled up</span>
                ) : n.netMinor > 0n ? (
                  <span className="shrink-0 text-sm font-medium tabular-nums text-green-700 dark:text-green-400">
                    gets back {formatPaise(n.netMinor)}
                  </span>
                ) : (
                  <span className="shrink-0 text-sm font-medium tabular-nums text-amber-700 dark:text-amber-400">
                    owes {formatPaise(-n.netMinor)}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {/* Invariant #7 made visible: if the nets ever stop cancelling out,
              that is a real bug and it should be on screen, not swallowed. */}
          <div
            className={`flex items-center justify-between gap-3 border-t px-4 py-3 ${
              total === 0n
                ? 'border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900'
                : 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950'
            }`}
          >
            <span className="text-sm text-zinc-600 dark:text-zinc-400">Balances add up to</span>
            <span
              className={`text-sm font-medium tabular-nums ${
                total === 0n ? '' : 'text-red-600 dark:text-red-400'
              }`}
            >
              {total === 0n ? formatPaise(0) : `${formatPaise(total)} — expected ₹0.00`}
            </span>
          </div>
        </div>
      </section>

      {(pendingSettlements ?? []).length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Pending payments
          </h2>

          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {(pendingSettlements ?? []).map((s) => {
              const from = memberById.get(s.from_member);
              const to = memberById.get(s.to_member);
              const iAmPayee = to?.user_id === user.id;
              const iAmPayer = from?.user_id === user.id;

              return (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">
                      {iAmPayer ? 'You' : (from?.display_name ?? 'Someone')}
                    </span>{' '}
                    marked {formatPaise(toPaise(s.amount_minor))} paid to{' '}
                    <span className="font-medium">
                      {iAmPayee ? 'you' : (to?.display_name ?? 'someone')}
                    </span>
                    <span className="mt-0.5 block text-xs text-zinc-500">
                      {iAmPayee
                        ? 'Confirm once the money has arrived.'
                        : `Waiting for ${to?.display_name ?? 'them'} to confirm — this does not
                           change balances yet.`}
                    </span>
                  </span>

                  {iAmPayee ? (
                    <ConfirmButton action={confirmSettlement.bind(null, id, s.id)} />
                  ) : (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      pending
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="text-xs text-zinc-500">
            Pending payments are ignored by the balances above until the person who was
            paid confirms them.
          </p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Who pays whom
        </h2>

        {payments.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 px-6 py-10 text-center text-sm dark:border-zinc-700">
            <span className="block text-base font-medium">All settled up</span>
            <span className="mt-1 block text-zinc-600 dark:text-zinc-400">
              Nobody owes anybody anything.
            </span>
          </p>
        ) : (
          <>
            <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {payments.map((p, i) => {
                const isMine = myMemberId !== null && p.from.memberId === myMemberId;
                return (
                  <li key={`${p.from.memberId}-${p.to.memberId}-${i}`} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 text-sm">
                        <span className="font-medium">
                          {isMine ? 'You' : p.from.displayName}
                        </span>{' '}
                        {isMine ? 'pay' : 'pays'}{' '}
                        <span className="font-medium">{p.to.displayName}</span>
                        {p.to.upiId && (
                          <span className="mt-0.5 block truncate text-xs text-zinc-500">
                            {p.to.upiId}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-sm font-medium tabular-nums">
                        {formatPaise(p.amountMinor)}
                      </span>
                    </div>

                    {isMine && (
                      <div className="mt-3">
                        <SettleRow
                          groupId={group.id}
                          groupName={group.name}
                          fromMemberId={p.from.memberId}
                          toMemberId={p.to.memberId}
                          payeeName={p.to.displayName}
                          payeeUpiId={p.to.upiId}
                          amountMinor={p.amountMinor.toString()}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-zinc-500">
              The shortest set of payments that clears everyone —{' '}
              {payments.length === 1 ? '1 transfer' : `${payments.length} transfers`} instead of
              everyone paying everyone.
            </p>
          </>
        )}
      </section>
    </Shell>
  );
}

function Shell({
  groupId,
  groupName,
  children,
}: {
  groupId: string;
  groupName: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-6 sm:p-10">
      <header className="space-y-1">
        <Link
          href={`/groups/${groupId}`}
          className="text-sm underline underline-offset-4 text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-white"
        >
          &larr; Back to group
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Balances</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{groupName}</p>
      </header>
      {children}
    </main>
  );
}
