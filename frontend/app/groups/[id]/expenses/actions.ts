'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { parseRupeesToPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';

export type ExpenseFormState = { error?: string };

function readForm(formData: FormData) {
  const amountRaw = String(formData.get('amount') ?? '');
  const description = String(formData.get('description') ?? '').trim();
  const paidBy = String(formData.get('paid_by') ?? '');
  // Checkbox group: one entry per ticked member.
  const participants = formData.getAll('participants').map(String).filter(Boolean);
  // Custom split only. Hidden inputs, already integer paise, emitted in the same
  // order as the ticked participants because create_expense correlates the two
  // arrays BY INDEX. Absent entirely on an equal split, which is what makes the
  // RPC take its unchanged path.
  const sharesRaw = formData.getAll('shares').map(String).filter((v) => v !== '');
  return { amountRaw, description, paidBy, participants, sharesRaw };
}

/**
 * Shares are only forwarded when there is exactly one per participant and each
 * is a non-negative integer. Anything else is treated as "no custom split"
 * rather than passed on half-formed — the RPC would reject it, but a malformed
 * payload should never get that far.
 *
 * The sum is NOT checked here: create_expense asserts it server-side and that
 * assertion is the guarantee. Duplicating it would create a second definition of
 * "adds up" that could drift from the one that matters.
 */
function readShares(sharesRaw: string[], participantCount: number): number[] | null {
  if (sharesRaw.length === 0) return null;
  if (sharesRaw.length !== participantCount) return null;
  const parsed: number[] = [];
  for (const raw of sharesRaw) {
    if (!/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < 0) return null;
    parsed.push(n);
  }
  return parsed;
}

function validate(amountRaw: string, paidBy: string, participants: string[]) {
  const amountMinor = parseRupeesToPaise(amountRaw);
  if (amountMinor === null) {
    return { error: 'Enter a valid amount, like 100 or 100.50.' as const };
  }
  if (!paidBy) return { error: 'Choose who paid.' as const };
  if (participants.length === 0) {
    return { error: 'Tick at least one person to split between.' as const };
  }
  return { amountMinor };
}

export async function createExpense(
  groupId: string,
  _prev: ExpenseFormState,
  formData: FormData,
): Promise<ExpenseFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/groups/${groupId}`)}`);

  const { amountRaw, description, paidBy, participants, sharesRaw } = readForm(formData);
  const checked = validate(amountRaw, paidBy, participants);
  if ('error' in checked) return { error: checked.error };

  // One RPC: the expense row and its splits must land together, and the split
  // arithmetic is done in SQL so the client cannot submit shares that disagree
  // with the amount.
  const { error } = await supabase.rpc('create_expense', {
    p_group_id: groupId,
    p_paid_by: paidBy,
    p_amount_minor: checked.amountMinor,
    p_description: description,
    p_participants: participants,
    // null on an equal split, so the RPC defaults it and divides as before.
    p_shares: readShares(sharesRaw, participants.length),
  });

  if (error) return { error: error.message };

  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}`);
}

export async function updateExpense(
  groupId: string,
  expenseId: string,
  _prev: ExpenseFormState,
  formData: FormData,
): Promise<ExpenseFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/groups/${groupId}`)}`);

  const { amountRaw, description, paidBy, participants, sharesRaw } = readForm(formData);
  const checked = validate(amountRaw, paidBy, participants);
  if ('error' in checked) return { error: checked.error };

  const { error } = await supabase.rpc('update_expense', {
    p_expense_id: expenseId,
    p_paid_by: paidBy,
    p_amount_minor: checked.amountMinor,
    p_description: description,
    p_participants: participants,
    // null on an equal split, so the RPC defaults it and divides as before.
    p_shares: readShares(sharesRaw, participants.length),
  });

  if (error) {
    // The RPC's own text never reaches the screen — an RLS refusal must read as
    // "you can't do this", not as a policy name.
    console.error('updateExpense failed:', error.message);
    return { error: 'We could not save those changes. Try again.' };
  }

  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}`);
}

/**
 * Soft delete only (TRD Section 3). group_balances already filters
 * is_deleted = false, so a removed expense stops affecting balances without
 * destroying the record. Permitted by the existing expenses_update policy.
 */
export async function softDeleteExpense(groupId: string, expenseId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/groups/${groupId}`)}`);

  const { error } = await supabase
    .from('expenses')
    .update({ is_deleted: true })
    .eq('id', expenseId);

  if (error) throw new Error(error.message);

  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}`);
}
