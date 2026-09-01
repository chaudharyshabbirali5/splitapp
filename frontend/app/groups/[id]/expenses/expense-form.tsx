'use client';

import Link from 'next/link';
import { useActionState, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import type { ExpenseFormState } from './actions';

export type MemberOption = {
  id: string;
  display_name: string;
  isPlaceholder: boolean;
};

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

  function sameAsInitial(form: HTMLFormElement, nextChecked: Set<string>): boolean {
    if (!initial) return false;
    const fd = new FormData(form);
    const participants = new Set(nextChecked);
    const initialParticipants = new Set(initial.participantIds);
    return (
      String(fd.get('amount') ?? '').trim() === initial.amount.trim() &&
      String(fd.get('description') ?? '').trim() === initial.description.trim() &&
      String(fd.get('paid_by') ?? '') === initial.paidBy &&
      participants.size === initialParticipants.size &&
      [...participants].every((id) => initialParticipants.has(id))
    );
  }

  function recomputeDirty(nextChecked: Set<string>) {
    if (!initial || !formRef.current) return;
    setDirty(!sameAsInitial(formRef.current, nextChecked));
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
            defaultValue={initial?.amount ?? ''}
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

      <fieldset className="space-y-2">
        <legend className="field-label">
          Split between{' '}
          <span className="font-normal text-ink-faint">
            ({checked.size} {checked.size === 1 ? 'person' : 'people'}, equally)
          </span>
        </legend>

        <ul className="ledger">
          {members.map((m) => (
            <li key={m.id}>
              <label className="flex cursor-pointer items-center gap-3 px-2.5 py-2.5">
                <input
                  type="checkbox"
                  name="participants"
                  value={m.id}
                  checked={checked.has(m.id)}
                  onChange={() => toggle(m.id)}
                  className="size-4 accent-brand"
                />
                <span className="text-sm">
                  {m.display_name}
                  {m.isPlaceholder && (
                    <span className="ml-2 text-xs text-ink-faint">not joined yet</span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>

        {checked.size === 0 && (
          <p className="text-sm text-debit">Tick at least one person.</p>
        )}
        <p className="hint">
          Any paise left over from an uneven split go to the people at the top of this
          list, so the shares always add up to the exact total.
        </p>
      </fieldset>

      {state.error && <p className="text-sm text-debit">{state.error}</p>}

      <SubmitButton label={submitLabel} disabled={!!initial && !dirty} />

      <Link href={`/groups/${groupId}`} className="link block text-center text-sm">
        Cancel
      </Link>
    </form>
  );
}
