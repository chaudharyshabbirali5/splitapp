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

  if (error) {
    // The RPC's own text never reaches the screen. This is the money path, so a
    // refusal must read as a sentence, never as a policy name.
    console.error('recordSettlement failed:', error.message);
    return { error: 'We could not record that payment. Try again.' };
  }

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
  if (error) {
    console.error('confirmSettlement failed:', error.message);
    throw new Error('We could not confirm that payment. Try again.');
  }

  revalidatePath(`/groups/${groupId}/balances`);
}


/**
 * Records a CASH settlement with a placeholder member. One step, confirmed on
 * creation — the placeholder has no account and can never tap "Confirm
 * received", which is the whole reason this path exists.
 *
 * Every authorization rule lives in record_cash_settlement, which is SECURITY
 * DEFINER and therefore has no RLS backstop: it requires the caller to be the
 * counterparty or the group admin, AND at least one party to be a placeholder.
 * Nothing is re-checked here — a second copy of that rule would be a second
 * thing that can drift from the one that actually guards the money. The UI
 * merely declines to OFFER the action where the RPC would refuse it.
 */
export async function recordCashSettlement(
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

  // The affirmation tick carries the weight the payee's Confirm normally would,
  // so it is required rather than advisory.
  if (String(formData.get('affirm') ?? '') !== 'on') {
    return { error: 'Tick the box to confirm the cash actually changed hands.' };
  }

  const amountMinor = parseRupeesToPaise(String(formData.get('amount') ?? ''));
  if (amountMinor === null) return { error: 'Enter a valid amount, like 100 or 100.50.' };
  if (amountMinor <= 0) return { error: 'Enter an amount greater than zero.' };

  const { error } = await supabase.rpc('record_cash_settlement', {
    p_group_id: groupId,
    p_from_member: fromMemberId,
    p_to_member: toMemberId,
    p_amount_minor: amountMinor,
  });

  if (error) {
    console.error('recordCashSettlement failed:', error.message);
    return { error: 'We could not record that cash payment. Try again.' };
  }

  revalidatePath(`/groups/${groupId}/balances`);
  revalidatePath(`/groups/${groupId}`);
  return {};
}
