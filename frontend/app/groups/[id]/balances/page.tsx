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
import { CashSettleRow } from './cash-settle-row';
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
    .select('id, name, created_by')
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

  // Cash settlements are confirmed on creation, so they never appear in the
  // pending query above. recorded_by is read because it is the whole point of
  // the column: the feed has to say WHO asserted the payment, and distinguish
  // the payer recording their own from an admin recording on their behalf.
  const { data: cashSettlements } = await supabase
    .from('settlements')
    .select('id, from_member, to_member, amount_minor, created_at, recorded_by')
    .eq('group_id', id)
    .eq('method', 'cash')
    .order('created_at', { ascending: false });

  const [{ data: members }, balances, { count: expenseCount }] = await Promise.all([
    supabase
      .from('group_members')
      .select('id, user_id, display_name, upi_id, role')
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
    // The RPC's own text never reaches the screen; an RLS refusal must read as
    // "you can't see this", not as a policy name.
    console.error(`balances ${id} read failed:`, balances.error.message);
    return (
      <Shell groupId={id} groupName={group.name}>
        <p className="notice-error" role="alert">
          We couldn&rsquo;t load these balances. Refresh, or sign in again if this keeps
          happening.
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
        <p className="notice-error">
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

  // The admin half of the cash-settle rule, mirroring record_cash_settlement's
  // own check: role = 'admin' OR the group's creator. Convenience only — the RPC
  // is SECURITY DEFINER and re-checks all of it, so this decides what to OFFER,
  // never what is permitted.
  const viewerIsAdmin =
    (members ?? []).some((m) => m.user_id === user.id && m.role === 'admin') ||
    group.created_by === user.id;

  return (
    <Shell groupId={id} groupName={group.name}>
      {!hasExpenses && (
        <p className="empty text-sm text-ink-soft">
          No expenses yet. Everyone starts at zero.
        </p>
      )}

      <section className="space-y-3">
        <h2 className="khata-label">Balances</h2>

        <div>
          <ul className="ledger border-b-0">
            {nets.map((n) => (
              <li key={n.memberId} className="ledger-row">
                <span className="min-w-0 truncate text-sm">
                  {n.displayName}
                  {n.isPlaceholder && (
                    <span className="ml-2 text-xs text-ink-faint">not joined yet</span>
                  )}
                </span>

                {n.netMinor === 0n ? (
                  <span className="khata-label shrink-0">settled up</span>
                ) : n.netMinor > 0n ? (
                  <span className="figure shrink-0 text-sm font-medium text-credit">
                    +{formatPaise(n.netMinor)}
                    <span className="khata-label ml-2 text-credit">gets back</span>
                  </span>
                ) : (
                  <span className="figure shrink-0 text-sm font-medium text-debit">
                    &minus;{formatPaise(-n.netMinor)}
                    <span className="khata-label ml-2 text-debit">owes</span>
                  </span>
                )}
              </li>
            ))}
          </ul>

          {/* Invariant #7 made visible: if the nets ever stop cancelling out,
              that is a real bug and it should be on screen, not swallowed.
              The double rule is the ledger's "this figure is final". */}
          <div className={`ledger-total ${total === 0n ? '' : 'ledger-total-bad'}`}>
            <span className="khata-label">Balances add up to</span>
            <span
              className={`figure text-sm font-medium ${total === 0n ? '' : 'text-debit'}`}
            >
              {total === 0n ? formatPaise(0) : `${formatPaise(total)} — expected ₹0.00`}
            </span>
          </div>
        </div>
      </section>

      {(pendingSettlements ?? []).length > 0 && (
        <section className="space-y-3">
          <h2 className="khata-label">Pending payments</h2>

          <ul className="ledger">
            {(pendingSettlements ?? []).map((s) => {
              const from = memberById.get(s.from_member);
              const to = memberById.get(s.to_member);
              const iAmPayee = to?.user_id === user.id;
              const iAmPayer = from?.user_id === user.id;

              return (
                <li key={s.id} className="ledger-row items-start">
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">
                      {iAmPayer ? 'You' : (from?.display_name ?? 'Someone')}
                    </span>{' '}
                    marked{' '}
                    <span className="figure font-medium">
                      {formatPaise(toPaise(s.amount_minor))}
                    </span>{' '}
                    paid to{' '}
                    <span className="font-medium">
                      {iAmPayee ? 'you' : (to?.display_name ?? 'someone')}
                    </span>
                    <span className="hint mt-0.5 block">
                      {iAmPayee
                        ? 'Confirm once the money has arrived.'
                        : `Waiting for ${to?.display_name ?? 'them'} to confirm — this does not
                           change balances yet.`}
                    </span>
                  </span>

                  {iAmPayee ? (
                    <ConfirmButton action={confirmSettlement.bind(null, id, s.id)} />
                  ) : (
                    <span className="chip chip-pending shrink-0">pending</span>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="hint">
            Pending payments are ignored by the balances above until the person who was
            paid confirms them.
          </p>
        </section>
      )}

      {(cashSettlements ?? []).length > 0 && (
        <section className="space-y-3">
          <h2 className="khata-label">Settled in cash</h2>

          <ul className="ledger">
            {(cashSettlements ?? []).map((s) => {
              const from = memberById.get(s.from_member);
              const to = memberById.get(s.to_member);
              const recorder = s.recorded_by ? memberById.get(s.recorded_by) : null;
              const iAmPayer = from?.user_id === user.id;
              // The distinction recorded_by exists for: the payer recording
              // their own cash reads differently from an admin doing it for
              // them, and the ledger must not blur the two.
              const recordedBySomeoneElse =
                !!s.recorded_by && s.recorded_by !== s.from_member;

              return (
                <li key={s.id} className="ledger-row items-start">
                  <span className="min-w-0 text-sm">
                    {recordedBySomeoneElse ? (
                      <>
                        <span className="font-medium">
                          {recorder?.display_name ?? 'An admin'}
                        </span>{' '}
                        recorded{' '}
                        <span className="figure font-medium">
                          {formatPaise(toPaise(s.amount_minor))}
                        </span>{' '}
                        paid in cash on behalf of{' '}
                        <span className="font-medium">
                          {from?.display_name ?? 'someone'}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="font-medium">
                          {iAmPayer ? 'You' : (from?.display_name ?? 'Someone')}
                        </span>{' '}
                        paid{' '}
                        <span className="font-medium">
                          {to?.display_name ?? 'someone'}
                        </span>{' '}
                        <span className="figure font-medium">
                          {formatPaise(toPaise(s.amount_minor))}
                        </span>{' '}
                        in cash
                      </>
                    )}
                    <span className="hint mt-0.5 block">
                      Recorded by {recorder?.display_name ?? 'someone'} &middot;{' '}
                      {new Date(s.created_at).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                  </span>

                  {/* Confirmed on creation, so it is settled, not pending. A
                      pending chip must never appear on a cash settlement. */}
                  <span className="chip chip-joined shrink-0">settled</span>
                </li>
              );
            })}
          </ul>

          <p className="hint">
            Cash settlements clear the balance immediately. Delete one from the group
            feed if it was recorded by mistake.
          </p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="khata-label">Who pays whom</h2>

        {payments.length === 0 ? (
          <p className="empty text-sm">
            <span className="block font-medium">All settled up</span>
            <span className="mt-1 block text-ink-soft">Nobody owes anybody anything.</span>
          </p>
        ) : (
          <>
            <ul className="ledger">
              {payments.map((p, i) => {
                const isMine = myMemberId !== null && p.from.memberId === myMemberId;
                return (
                  <li
                    key={`${p.from.memberId}-${p.to.memberId}-${i}`}
                    className="px-2.5 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 text-sm">
                        <span className="font-medium">
                          {isMine ? 'You' : p.from.displayName}
                        </span>{' '}
                        {isMine ? 'pay' : 'pays'}{' '}
                        <span className="font-medium">{p.to.displayName}</span>
                        {p.to.isPlaceholder ? (
                          <span className="mt-0.5 block truncate text-xs text-ink-faint">
                            Not on SplitApp &middot; no UPI ID
                            <span className="chip chip-pending ml-2">not joined</span>
                          </span>
                        ) : (
                          p.to.upiId && (
                            <span className="figure mt-0.5 block truncate text-xs text-ink-faint">
                              {p.to.upiId}
                            </span>
                          )
                        )}
                      </span>
                      <span className="figure shrink-0 text-sm font-medium">
                        {formatPaise(p.amountMinor)}
                      </span>
                    </div>

                    {/* A placeholder payee can never tap Confirm, so this leg takes the
                        one-step cash path instead of the two-step UPI one. Real-user rows
                        are untouched: same SettleRow, same isMine gate, same flow. */}
                    {p.to.isPlaceholder ? (
                      <CashSettleRow
                        groupId={group.id}
                        fromMemberId={p.from.memberId}
                        toMemberId={p.to.memberId}
                        payerName={p.from.displayName}
                        payeeName={p.to.displayName}
                        amountMinor={p.amountMinor.toString()}
                        canRecord={
                          (myMemberId !== null &&
                            (p.from.memberId === myMemberId || p.to.memberId === myMemberId)) ||
                          viewerIsAdmin
                        }
                        viewerIsPayer={isMine}
                      />
                    ) : (
                      isMine && (
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
                      )
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="hint">
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
      <header className="space-y-1 border-b border-rule pb-4">
        <Link href={`/groups/${groupId}`} className="link-back">
          &larr; Back to group
        </Link>
        <h1 className="page-title pt-1">Balances</h1>
        <p className="text-sm text-ink-soft">{groupName}</p>
      </header>
      {children}
    </main>
  );
}
