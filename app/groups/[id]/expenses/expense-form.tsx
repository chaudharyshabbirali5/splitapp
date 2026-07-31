'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import type { ExpenseFormState } from './actions';

export type MemberOption = {
  id: string;
  display_name: string;
  isPlaceholder: boolean;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
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

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-1.5">
        <label htmlFor="amount" className="block text-sm font-medium">
          Amount
        </label>
        <div className="flex items-center gap-2">
          <span className="text-lg text-zinc-500">₹</span>
          <input
            id="amount"
            name="amount"
            required
            autoFocus
            inputMode="decimal"
            defaultValue={initial?.amount ?? ''}
            placeholder="0.00"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100"
          />
        </div>
        <p className="text-xs text-zinc-500">Rupees, up to two decimals.</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="description" className="block text-sm font-medium">
          Description
        </label>
        <input
          id="description"
          name="description"
          maxLength={140}
          defaultValue={initial?.description ?? ''}
          placeholder="Beach shack dinner"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="paid_by" className="block text-sm font-medium">
          Paid by
        </label>
        <select
          id="paid_by"
          name="paid_by"
          required
          defaultValue={initial?.paidBy ?? members[0]?.id ?? ''}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100"
        >
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
              {m.isPlaceholder ? ' (not joined yet)' : ''}
            </option>
          ))}
        </select>
        <p className="text-xs text-zinc-500">
          Someone who hasn&rsquo;t joined can still be the payer.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          Split between{' '}
          <span className="font-normal text-zinc-500">
            ({checked.size} {checked.size === 1 ? 'person' : 'people'}, equally)
          </span>
        </legend>

        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {members.map((m) => (
            <li key={m.id}>
              <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5">
                <input
                  type="checkbox"
                  name="participants"
                  value={m.id}
                  checked={checked.has(m.id)}
                  onChange={() => toggle(m.id)}
                  className="size-4 accent-zinc-900 dark:accent-zinc-100"
                />
                <span className="text-sm">
                  {m.display_name}
                  {m.isPlaceholder && (
                    <span className="ml-2 text-xs text-zinc-500">not joined yet</span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>

        {checked.size === 0 && (
          <p className="text-sm text-red-600 dark:text-red-400">
            Tick at least one person.
          </p>
        )}
        <p className="text-xs text-zinc-500">
          Any paise left over from an uneven split go to the people at the top of this
          list, so the shares always add up to the exact total.
        </p>
      </fieldset>

      {state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}

      <SubmitButton label={submitLabel} />

      <Link
        href={`/groups/${groupId}`}
        className="block text-center text-sm underline underline-offset-4 text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-white"
      >
        Cancel
      </Link>
    </form>
  );
}
