'use client';

import Link from 'next/link';
import { useActionState, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { parseRupeesToPaise, formatPaise, paiseToRupeeInput } from '@/lib/money';

import type { ExpenseFormState } from './actions';

export type MemberOption = {
  id: string;
  display_name: string;
  isPlaceholder: boolean;
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

/**
 * The equal-split rule, mirrored in TypeScript so "Fill equally" and the
 * Equally -> Custom seed produce EXACTLY what create_expense would have stored:
 * floor, then one extra paise to the first `rem` participants in list order.
 * Integer/BigInt throughout, never a division into floats.
 */
function equalShares(totalMinor: bigint, n: number): bigint[] {
  if (n <= 0) return [];
  const big = BigInt(n);
  const base = totalMinor / big;
  const rem = totalMinor - base * big;
  return Array.from({ length: n }, (_, i) => base + (BigInt(i) < rem ? 1n : 0n));
}

/** A cell's typed rupees -> integer paise. Blank reads as 0, never as NaN. */
function cellToPaise(raw: string): bigint | null {
  const t = raw.trim();
  if (t === '') return 0n;
  const parsed = parseRupeesToPaise(t);
  return parsed === null ? null : BigInt(parsed);
}

function SubmitButton({ label, disabled = false }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="btn btn-primary btn-block"
    >
      {pending ? 'Saving…' : label}
    </button>
  );
}

export function ExpenseForm({
  groupId,
  members,
  action,
  submitLabel,
  initial,
}: {
  groupId: string;
  members: MemberOption[];
  action: (prev: ExpenseFormState, formData: FormData) => Promise<ExpenseFormState>;
  submitLabel: string;
  initial?: {
    amount: string;
    description: string;
    paidBy: string;
    participantIds: string[];
    /**
     * Stored per-participant shares, keyed by member id, as rupee strings ready
     * for an AmountCell. Present only for an `exact` split.
     *
     * Without these the edit screen opened an exact split in Equally mode and a
     * no-op re-save silently re-divided it, destroying the shares the user had
     * typed. An equal split deliberately passes nothing: those shares are
     * derived, not authored, and GAPS_SPEC section 5 says not to prefill them.
     */
    shares?: Record<string, string>;
    splitMode?: 'equal' | 'exact';
  };
}) {
  const [state, formAction] = useActionState<ExpenseFormState, FormData>(action, {});

  // Default: everyone is in the split. Tracked in state purely so the "split N
  // ways" hint stays accurate as boxes are ticked.
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(initial?.participantIds ?? members.map((m) => m.id)),
  );

  // Dirty tracking, and ONLY when editing. `initial` is absent on add-expense,
  // where there is nothing to compare against and Save must always be live —
  // so nothing about the add screen changes. The fields stay uncontrolled; a
  // form-level onInput re-reads them rather than converting every input to
  // controlled state, which would be a real change to how this form works.
  const formRef = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);

  // The amount drives the custom-split arithmetic, so it is tracked here as
  // well as living on the uncontrolled input.
  const [amountText, setAmountText] = useState(initial?.amount ?? '');

  function sameAsInitial(
    form: HTMLFormElement,
    nextChecked: Set<string>,
    currentCells: Record<string, string>,
  ): boolean {
    if (!initial) return false;
    const fd = new FormData(form);
    const participants = new Set(nextChecked);
    const initialParticipants = new Set(initial.participantIds);
    // Shares count as a change too: editing only an amount cell must wake Save.
    // Compared in paise, not as text, so "100" and "100.00" are the same figure.
    const initialShares = initial.shares ?? {};
    const sharesUnchanged = [...participants].every((id) => {
      const before = cellToPaise(initialShares[id] ?? '');
      const now = cellToPaise(currentCells[id] ?? '');
      return before !== null && now !== null && before === now;
    });

    return (
      String(fd.get('amount') ?? '').trim() === initial.amount.trim() &&
      String(fd.get('description') ?? '').trim() === initial.description.trim() &&
      String(fd.get('paid_by') ?? '') === initial.paidBy &&
      participants.size === initialParticipants.size &&
      [...participants].every((id) => initialParticipants.has(id)) &&
      sharesUnchanged
    );
  }

  function recomputeDirty(nextChecked: Set<string>, nextCells?: Record<string, string>) {
    if (!initial || !formRef.current) return;
    setDirty(!sameAsInitial(formRef.current, nextChecked, nextCells ?? cells));
  }

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      recomputeDirty(next);
      return next;
    });
  }

  // ── Custom split ──────────────────────────────────────────────────────────
  // A branch alongside the equal path, never a replacement for it. When mode is
  // 'equal' nothing below runs and the form submits exactly the fields it always
  // has, so create_expense receives no p_shares and takes its unchanged path.
  // Opens in whatever the stored expense actually is. An exact split MUST open
  // in Custom: opening it in Equally and saving would re-divide it.
  const [mode, setMode] = useState<'equal' | 'custom'>(
    initial?.splitMode === 'exact' ? 'custom' : 'equal',
  );

  // Raw text per member id, so a half-typed "12." is preserved while editing and
  // only becomes paise on parse. Blank means "nothing typed yet", which is not
  // the same as a typed 0.00 — the initial state must read as empty.
  const [cells, setCells] = useState<Record<string, string>>(() => ({
    ...(initial?.shares ?? {}),
  }));

  const totalMinor = useMemo(() => {
    const parsed = parseRupeesToPaise(amountText);
    return parsed === null ? null : BigInt(parsed);
  }, [amountText]);

  const participantIds = members.filter((m) => checked.has(m.id)).map((m) => m.id);

  // Sum in BigInt paise. A single unparseable cell makes the whole sum unknown
  // rather than quietly contributing zero.
  //
  // Deliberately NOT memoised: it is a loop over a handful of members, and the
  // dependency would have to be a derived key over participantIds + cells, which
  // is exactly the kind of hand-maintained dep list that goes stale silently. A
  // wrong sum here is a wrong money figure, so correctness beats the micro-opt.
  let allocated = 0n;
  let anyUnparseable = false;
  for (const id of participantIds) {
    const v = cellToPaise(cells[id] ?? '');
    if (v === null) anyUnparseable = true;
    else allocated += v;
  }

  // THE rule, and it must equal the RPC's assertion exactly: diff === 0n, no
  // tolerance, no rounding. create_expense raises 22023 unless the stored shares
  // sum to the amount, so anything looser here means a server error the user
  // cannot act on, and anything stricter blocks a legal split.
  const diff = totalMinor === null ? null : totalMinor - allocated;
  const balanced = mode === 'equal' || (diff === 0n && !anyUnparseable);
  const overBy = diff !== null && diff < 0n ? -diff : 0n;

  function setCell(id: string, raw: string) {
    setCells((prev) => {
      const next = { ...prev, [id]: raw };
      recomputeDirty(checked, next);
      return next;
    });
  }

  function fillEqually() {
    if (totalMinor === null) return;
    const shares = equalShares(totalMinor, participantIds.length);
    const next: Record<string, string> = { ...cells };
    participantIds.forEach((id, i) => {
      next[id] = paiseToRupeeInput(Number(shares[i]));
    });
    setCells(next);
    recomputeDirty(checked, next);
  }

  function clearCells() {
    const next: Record<string, string> = { ...cells };
    for (const id of participantIds) next[id] = '';
    setCells(next);
    recomputeDirty(checked, next);
  }

  /** Offer the shortfall to the first participant — the same "top of the list"
   *  rule an equal split uses, offered rather than applied. */
  function addRemainderToFirst() {
    if (diff === null || diff <= 0n) return;
    const first = participantIds[0];
    if (!first) return;
    const current = cellToPaise(cells[first] ?? '') ?? 0n;
    setCell(first, paiseToRupeeInput(Number(current + diff)));
  }

  function switchMode(next: 'equal' | 'custom') {
    if (next === mode) return;
    if (next === 'custom') {
      // Seed from the equal split so Custom opens balanced and is edited from
      // there, including the paise remainder already placed.
      if (totalMinor !== null && participantIds.length > 0) {
        const shares = equalShares(totalMinor, participantIds.length);
        const seeded: Record<string, string> = { ...cells };
        participantIds.forEach((id, i) => {
          seeded[id] = paiseToRupeeInput(Number(shares[i]));
        });
        setCells(seeded);
      }
      setMode('custom');
      return;
    }
    // Custom -> Equally discards typed values, so confirm if any differ from
    // what an equal split would have produced.
    const shares =
      totalMinor === null ? [] : equalShares(totalMinor, participantIds.length);
    const differs = participantIds.some((id, i) => {
      const typed = cellToPaise(cells[id] ?? '');
      return typed === null || typed !== (shares[i] ?? 0n);
    });
    if (differs && !window.confirm('Switch to an equal split? Your typed amounts will be discarded.')) {
      return;
    }
    setMode('equal');
    recomputeDirty(checked);
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onInput={() => recomputeDirty(checked)}
      className="space-y-6"
    >
      <div className="space-y-1.5">
        <label htmlFor="amount" className="field-label">
          Amount
        </label>
        <div className="flex items-center gap-2">
          <span className="figure text-lg text-ink-faint">₹</span>
          <input
            id="amount"
            name="amount"
            required
            autoFocus
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            placeholder="0.00"
            className="field field-amount text-base"
          />
        </div>
        <p className="hint">Rupees, up to two decimals.</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="description" className="field-label">
          Description
        </label>
        <input
          id="description"
          name="description"
          maxLength={140}
          defaultValue={initial?.description ?? ''}
          placeholder="Beach shack dinner"
          className="field"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="paid_by" className="field-label">
          Paid by
        </label>
        <select
          id="paid_by"
          name="paid_by"
          required
          defaultValue={initial?.paidBy ?? members[0]?.id ?? ''}
          className="field"
        >
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
              {m.isPlaceholder ? ' (not joined yet)' : ''}
            </option>
          ))}
        </select>
        <p className="hint">Someone who hasn&rsquo;t joined can still be the payer.</p>
      </div>

      <fieldset className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <legend className="field-label">
            Split between{' '}
            <span className="font-normal text-ink-faint">
              ({checked.size} {checked.size === 1 ? 'person' : 'people'})
            </span>
          </legend>
        </div>

        {/* Equally | Custom. Equally is the untouched path; selecting it never
            sends p_shares, so the RPC divides exactly as it always has. */}
        <div className="segment-pill grid-cols-2">
          {(['equal', 'custom'] as const).map((m) => (
            <label key={m}>
              <input
                type="radio"
                name="split_mode_ui"
                value={m}
                checked={mode === m}
                onChange={() => switchMode(m)}
                className="sr-only"
              />
              {m === 'equal' ? 'Equally' : 'Custom'}
            </label>
          ))}
        </div>

        {mode === 'custom' && (
          <div className="flex items-center justify-between gap-3">
            <span className="khata-label">
              Between {participantIds.length}{' '}
              {participantIds.length === 1 ? 'person' : 'people'}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={fillEqually}
                disabled={totalMinor === null || participantIds.length === 0}
                className="btn btn-quiet btn-sm"
              >
                Fill equally
              </button>
              <button
                type="button"
                onClick={clearCells}
                disabled={participantIds.every((id) => (cells[id] ?? '') === '')}
                className="btn btn-quiet btn-sm"
              >
                Clear
              </button>
            </span>
          </div>
        )}

        {/* Plain ledger — hairlines between rows, not boxed cards. */}
        <ul className="ledger">
          {members.map((m) => {
            const isChecked = checked.has(m.id);
            const raw = cells[m.id] ?? '';
            const paise = cellToPaise(raw);
            // A cell is invalid only when the split is OVER: it is the shares
            // that are wrong, not this one field. Unparseable text is invalid
            // on its own account.
            const invalid =
              mode === 'custom' &&
              isChecked &&
              (paise === null || (overBy > 0n && paise > 0n));
            // Typed zero: on the expense, no share. Distinct from unchecked.
            const zeroShare =
              mode === 'custom' && isChecked && raw.trim() !== '' && paise === 0n;

            return (
              <li key={m.id}>
                <label className="ledger-row cursor-pointer">
                  <span className="flex min-w-0 items-center gap-3">
                    <input
                      type="checkbox"
                      name="participants"
                      value={m.id}
                      checked={isChecked}
                      onChange={() => toggle(m.id)}
                      className="size-4 shrink-0 accent-brand"
                    />
                    <span
                      title={m.display_name}
                      className={`avatar size-7 text-[0.65rem] ${
                        m.isPlaceholder ? 'avatar-placeholder' : tintFor(m.display_name)
                      }`}
                    >
                      {m.display_name.trim().charAt(0).toUpperCase() || '?'}
                    </span>
                    <span className="min-w-0 truncate text-sm">
                      {m.display_name}
                      {m.isPlaceholder && (
                        <span className="ml-2 text-xs text-ink-faint">not joined yet</span>
                      )}
                      {zeroShare && <span className="chip chip-quiet ml-2">no share</span>}
                    </span>
                  </span>

                  {mode === 'custom' ? (
                    isChecked ? (
                      <span
                        className="amount-cell"
                        data-invalid={invalid ? '' : undefined}
                        data-quiet={zeroShare ? '' : undefined}
                      >
                        <span>₹</span>
                        <input
                          inputMode="decimal"
                          aria-label={`${m.display_name} share`}
                          value={raw}
                          placeholder="0.00"
                          onChange={(e) => setCell(m.id, e.target.value)}
                          onBlur={(e) => {
                            // Normalise to paise on blur, per the spec. A value
                            // that will not parse is left alone so the typo stays
                            // visible rather than being silently discarded.
                            const v = cellToPaise(e.target.value);
                            if (v !== null && e.target.value.trim() !== '') {
                              setCell(m.id, paiseToRupeeInput(Number(v)));
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </span>
                    ) : (
                      <span className="khata-label shrink-0">not splitting</span>
                    )
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>

        {mode === 'custom' && (
          <>
            <div className={`ledger-total ${diff !== null && diff < 0n ? 'ledger-total-bad' : ''}`}>
              <span className="khata-label">Allocated</span>
              <span
                className={`figure text-sm font-medium ${
                  diff !== null && diff < 0n ? 'text-debit' : ''
                }`}
              >
                {formatPaise(allocated)}
              </span>
            </div>

            {/* The glance test: the double rule above, and this row. Three chip
                states, no fourth, no progress bar. */}
            <div className="flex min-h-7 items-center gap-2">
              {totalMinor === null ? (
                <span className="khata-label">Enter an amount first</span>
              ) : diff === 0n && !anyUnparseable ? (
                <span className="chip chip-joined">adds up to {formatPaise(totalMinor)}</span>
              ) : diff !== null && diff > 0n ? (
                <>
                  <span className="chip chip-pending">
                    {formatPaise(diff)} left to allocate
                  </span>
                  {/* A rupee-scale gap is a typo, not a rounding artefact — the
                      one-tap offer only appears at 100 paise or less. */}
                  {diff <= 100n && participantIds.length > 0 && (
                    <button
                      type="button"
                      onClick={addRemainderToFirst}
                      className="btn btn-quiet btn-sm"
                    >
                      Add it to{' '}
                      {members.find((m) => m.id === participantIds[0])?.display_name ?? 'the first person'}
                    </button>
                  )}
                </>
              ) : (
                /* Over. chip-pending carries it rather than a red chip: the
                   reddened double rule, the invalid cells and the error notice
                   already say "wrong", and --debit stays reserved for owed
                   money (decision b, 9147942). */
                <span className="chip chip-pending">{formatPaise(overBy)} over the total</span>
              )}
            </div>

            {diff !== null && diff < 0n ? (
              <p className="notice-error" role="alert">
                The shares are {formatPaise(overBy)} more than the expense. Reduce
                someone&rsquo;s share, or raise the amount to {formatPaise(allocated)}.
              </p>
            ) : (
              <p className="hint">
                A custom split is not spread for you — the last paise are yours to place.
                Set someone to ₹0.00 to keep them on the expense without a share.
              </p>
            )}
          </>
        )}

        {checked.size === 0 && (
          <p className="text-sm text-debit">Tick at least one person.</p>
        )}

        {mode === 'equal' && (
          <p className="hint">
            Any paise left over from an uneven split go to the people at the top of this
            list, so the shares always add up to the exact total.
          </p>
        )}

        {/* Aligned index-for-index with the checked participants above, which is
            how create_expense correlates them. Unchecked people appear in
            neither array — they are not on the expense at all. */}
        {mode === 'custom' &&
          participantIds.map((id) => (
            <input
              key={id}
              type="hidden"
              name="shares"
              value={String(cellToPaise(cells[id] ?? '') ?? 0n)}
            />
          ))}
      </fieldset>

      {state.error && <p className="text-sm text-debit">{state.error}</p>}

      <SubmitButton
        label={submitLabel}
        disabled={(!!initial && !dirty) || !balanced || checked.size === 0}
      />

      <Link href={`/groups/${groupId}`} className="link block text-center text-sm">
        Cancel
      </Link>
    </form>
  );
}
