'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { parseRupeesToPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';

export type ExpenseFormState = { error?: string };

/**
 * Adds an expense to a FRIEND tab.
 *
 * Why this exists rather than reusing createExpense from the groups tree: that
 * action ends with `redirect('/groups/<id>')`, which would land the user on the
 * Groups section after adding to a friend tab. The destination is the only
 * difference — the RPC, the arguments and the split arithmetic are identical, and
 * create_expense does not care whether the group is kind='friend'.
 *
 * The form component itself IS reused unchanged: ExpenseForm takes its action as
 * a prop, so the custom-split mode, the sum rule and the AmountCell behaviour all
 * come along for free.
 */
export async function createFriendExpense(
  groupId: string,
  _prev: ExpenseFormState,
  formData: FormData,
): Promise<ExpenseFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/friends/${groupId}`)}`);

  const amountRaw = String(formData.get('amount') ?? '');
  const description = String(formData.get('description') ?? '').trim();
  const paidBy = String(formData.get('paid_by') ?? '');
  const participants = formData.getAll('participants').map(String).filter(Boolean);
  const sharesRaw = formData.getAll('shares').map(String);

  const amountMinor = parseRupeesToPaise(amountRaw);
  if (amountMinor === null) return { error: 'Enter a valid amount, like 100 or 100.50.' };
  if (!paidBy) return { error: 'Choose who paid.' };
  if (participants.length === 0) return { error: 'Pick at least one person to split with.' };

  // An equal split sends null so the RPC divides it and distributes the
  // remainder; an exact split sends the per-person paise. Same contract as the
  // groups path — the split arithmetic stays in SQL so the client cannot submit
  // shares that disagree with the amount.
  let shares: number[] | null = null;
  if (sharesRaw.length > 0 && sharesRaw.some((s) => s.trim() !== '')) {
    const parsed = sharesRaw.map((s) => parseRupeesToPaise(s.trim() === '' ? '0' : s));
    if (parsed.some((p) => p === null)) {
      return { error: 'Check the individual shares — one of them is not a valid amount.' };
    }
    if (parsed.length !== participants.length) {
      return { error: 'Each person in the split needs exactly one share.' };
    }
    shares = parsed as number[];
  }

  const { error } = await supabase.rpc('create_expense', {
    p_group_id: groupId,
    p_paid_by: paidBy,
    p_amount_minor: amountMinor,
    p_description: description,
    p_participants: participants,
    p_shares: shares,
  });

  if (error) {
    // The groups-tree action returns error.message straight to the screen, which
    // leaks the database's own text. Not repeated here: the real message goes to
    // the log and the user gets a sentence.
    console.error('createFriendExpense failed:', error.message);
    return { error: 'We could not add that expense. Check the amount and try again.' };
  }

  revalidatePath(`/friends/${groupId}`);
  revalidatePath('/friends');
  redirect(`/friends/${groupId}`);
}
