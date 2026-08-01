'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { parseRupeesToPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';

export type SettleState = { error?: string };

/**
 * Records "I've paid" as a PENDING settlement. Nothing moves the balances until
 * the payee confirms — there is no reliable automatic confirmation for P2P UPI.
 *
 * The amount defaults to the suggested one but may be lower, so a part payment
 * is recorded honestly rather than overstating what was sent. group_balances
 * nets whatever amount is confirmed, so no reconciliation logic is needed here.
 */
export async function recordSettlement(
  groupId: string,
  fromMemberId: string,
  toMemberId: string,
  _prev: SettleState,
  formData: FormData,
): Promise<SettleState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/groups/${groupId}/balances`)}`);

  const amountMinor = parseRupeesToPaise(String(formData.get('amount') ?? ''));
  if (amountMinor === null) return { error: 'Enter a valid amount, like 100 or 100.50.' };

  const { error } = await supabase.rpc('record_settlement', {
    p_group_id: groupId,
    p_from_member: fromMemberId,
    p_to_member: toMemberId,
    p_amount_minor: amountMinor,
  });

  if (error) return { error: error.message };

  revalidatePath(`/groups/${groupId}/balances`);
  return {};
}

/** Only the payee can confirm; enforced inside confirm_settlement. */
export async function confirmSettlement(
  groupId: string,
  settlementId: string,
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/groups/${groupId}/balances`)}`);

  const { error } = await supabase.rpc('confirm_settlement', {
    p_settlement_id: settlementId,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/groups/${groupId}/balances`);
}
