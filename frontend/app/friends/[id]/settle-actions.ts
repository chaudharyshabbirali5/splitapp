'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { parseRupeesToPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';

export type FriendSettleState = { error?: string };

/**
 * Records a CASH settlement on a friend tab whose counterparty is a placeholder.
 *
 * Separate from the groups-tree action only because of revalidation: that one
 * revalidates /groups/<id> and its balances screen, which are the wrong paths
 * here. The RPC call and its arguments are identical.
 *
 * Every authorization rule lives in record_cash_settlement, which is SECURITY
 * DEFINER and so has no RLS backstop: it requires the caller to be a party or the
 * group admin, and at least one party to be a placeholder. Nothing is re-checked
 * here — a second copy of that rule would be a second thing that can drift from
 * the one actually guarding the money. The UI only declines to OFFER the action
 * where the RPC would refuse it.
 */
export async function recordFriendCashSettlement(
  groupId: string,
  fromMemberId: string,
  toMemberId: string,
  _prev: FriendSettleState,
  formData: FormData,
): Promise<FriendSettleState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/friends/${groupId}`)}`);

  // The affirmation tick stands in for the other person's Confirm, so it is
  // required rather than advisory.
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
    // Money path: a refusal must read as a sentence, never as a policy name.
    console.error('recordFriendCashSettlement failed:', error.message);
    return { error: 'We could not record that cash payment. Try again.' };
  }

  revalidatePath(`/friends/${groupId}`);
  revalidatePath('/friends');
  return {};
}
