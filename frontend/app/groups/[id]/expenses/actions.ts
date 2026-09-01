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
  return { amountRaw, description, paidBy, participants };
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

  const { amountRaw, description, paidBy, participants } = readForm(formData);
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

  const { amountRaw, description, paidBy, participants } = readForm(formData);
  const checked = validate(amountRaw, paidBy, participants);
  if ('error' in checked) return { error: checked.error };

  const { error } = await supabase.rpc('update_expense', {
    p_expense_id: expenseId,
    p_paid_by: paidBy,
    p_amount_minor: checked.amountMinor,
    p_description: description,
    p_participants: participants,
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
