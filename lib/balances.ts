/**
 * Balance maths. Everything here is integer paise held in bigint — no floats,
 * no Number arithmetic on money (TRD Invariant #1).
 */

export type MemberRef = {
  memberId: string;
  displayName: string;
  isPlaceholder: boolean;
  /** Present for the payee so step 7 can build a UPI intent without re-querying. */
  upiId: string | null;
};

export type NetBalance = MemberRef & {
  /** > 0 the group owes them, < 0 they owe the group. */
  netMinor: bigint;
};

export type Payment = {
  from: MemberRef;
  to: MemberRef;
  amountMinor: bigint;
};

/**
 * Converts a value that came back from PostgREST into paise.
 *
 * net_minor is bigint in Postgres. PostgREST serialises int8 as a JSON number,
 * which JSON.parse turns into a double — exact only up to 2^53. That ceiling is
 * astronomically above any real rupee amount, but "probably fine" is not a
 * guarantee, so anything that would not survive the round trip is rejected loudly
 * instead of silently rounding. A string is accepted too, since some PostgREST
 * configurations return int8 that way.
 */
export function toPaise(raw: unknown): bigint {
  if (typeof raw === 'bigint') return raw;

  if (typeof raw === 'string') {
    if (!/^-?\d+$/.test(raw.trim())) {
      throw new Error(`Expected an integer amount, got ${JSON.stringify(raw)}`);
    }
    return BigInt(raw.trim());
  }

  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw)) {
      throw new Error(
        `Amount ${raw} is not a safe integer — it may have lost precision in transit.`,
      );
    }
    return BigInt(raw);
  }

  throw new Error(`Expected an integer amount, got ${typeof raw}`);
}

/** Invariant #7: every net in a group must cancel out. */
export function sumNets(nets: NetBalance[]): bigint {
  return nets.reduce((acc, n) => acc + n.netMinor, 0n);
}

function stripNet({ memberId, displayName, isPlaceholder, upiId }: NetBalance): MemberRef {
  return { memberId, displayName, isPlaceholder, upiId };
}

/**
 * Minimal "who pays whom" list (TRD Section 9).
 *
 * Greedy: the largest debtor pays the largest creditor, settling at least one of
 * them each round, so at most n-1 payments are produced for n people.
 *
 * Ties are broken by display name then member id, so the same balances always
 * produce the same list rather than shuffling between renders.
 */
export function simplifyDebts(nets: NetBalance[]): Payment[] {
  const byMagnitude = (a: { remaining: bigint }, b: { remaining: bigint }) =>
    a.remaining > b.remaining ? -1 : a.remaining < b.remaining ? 1 : 0;

  const stable = (a: NetBalance, b: NetBalance) =>
    a.displayName.localeCompare(b.displayName) || a.memberId.localeCompare(b.memberId);

  const creditors = nets
    .filter((n) => n.netMinor > 0n)
    .map((n) => ({ ref: stripNet(n), source: n, remaining: n.netMinor }))
    .sort((a, b) => byMagnitude(a, b) || stable(a.source, b.source));

  const debtors = nets
    .filter((n) => n.netMinor < 0n)
    .map((n) => ({ ref: stripNet(n), source: n, remaining: -n.netMinor }))
    .sort((a, b) => byMagnitude(a, b) || stable(a.source, b.source));

  const payments: Payment[] = [];
  let d = 0;
  let c = 0;

  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d];
    const creditor = creditors[c];

    const amount = debtor.remaining < creditor.remaining ? debtor.remaining : creditor.remaining;
    if (amount > 0n) {
      payments.push({ from: debtor.ref, to: creditor.ref, amountMinor: amount });
    }

    debtor.remaining -= amount;
    creditor.remaining -= amount;

    if (debtor.remaining === 0n) d += 1;
    if (creditor.remaining === 0n) c += 1;
  }

  return payments;
}

/**
 * Applies a payment list back onto the nets. Used by tests to prove the list
 * actually settles everyone rather than merely looking plausible.
 */
export function applyPayments(nets: NetBalance[], payments: Payment[]): Map<string, bigint> {
  const result = new Map(nets.map((n) => [n.memberId, n.netMinor]));
  for (const p of payments) {
    result.set(p.from.memberId, (result.get(p.from.memberId) ?? 0n) + p.amountMinor);
    result.set(p.to.memberId, (result.get(p.to.memberId) ?? 0n) - p.amountMinor);
  }
  return result;
}
