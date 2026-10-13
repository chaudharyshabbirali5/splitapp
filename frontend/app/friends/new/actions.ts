'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

export type AddFriendState = { error?: string };

/**
 * The lookup result, as the screen needs it.
 *
 * `status` is deliberately coarse. find_friend_by_handle returns zero rows for
 * not-found, ambiguous (two accounts sharing a handle), self, and blank — all
 * indistinguishable, by design, so that a caller cannot use the difference as an
 * oracle for probing which handles are in use. This type preserves that: there is
 * no 'ambiguous' or 'self' case to render, because the server does not tell us
 * and must not.
 */
export type LookupState =
  | { status: 'idle' }
  | { status: 'found'; userId: string; displayName: string }
  | { status: 'not-found'; handle: string }
  | { status: 'error' };

/**
 * Looks up a SplitApp user by their exact UPI handle.
 *
 * All the matching rules live in find_friend_by_handle (SECURITY DEFINER, since
 * profiles_select_own would otherwise hide every row but the caller's): exact
 * match on lower(btrim(...)) both sides, self excluded, and more than one match
 * refused rather than guessed. Nothing is re-implemented here — this action
 * shapes the answer for the screen, it does not decide it.
 */
export async function lookupFriendByHandle(
  _prev: LookupState,
  formData: FormData,
): Promise<LookupState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=%2Ffriends%2Fnew');

  const handle = String(formData.get('handle') ?? '').trim();

  // Blank never reaches the database. The RPC also returns zero rows for it, but
  // a round trip to learn nothing is pointless, and 'idle' keeps the screen in
  // its resting state rather than showing a "not found" the user did not ask for.
  if (!handle) return { status: 'idle' };

  const { data, error } = await supabase.rpc('find_friend_by_handle', {
    p_handle: handle,
  });

  if (error) {
    // Real message to the log, one sentence on screen.
    console.error('lookupFriendByHandle failed:', error.message);
    return { status: 'error' };
  }

  type Hit = { user_id: string; display_name: string };
  const rows = (data ?? []) as Hit[];

  // Exactly one row is the only positive outcome. The RPC guarantees it never
  // returns more than one, so this is a belt-and-braces read of its contract
  // rather than a second ambiguity rule.
  if (rows.length !== 1) return { status: 'not-found', handle };

  return {
    status: 'found',
    userId: rows[0].user_id,
    displayName: rows[0].display_name,
  };
}

/**
 * Opens the tab with a user found by lookup.
 *
 * create_friend_tab is idempotent: confirming someone you already share a tab
 * with returns that existing tab rather than failing. So there is deliberately no
 * "you are already friends" error — landing back on the existing tab IS the
 * correct outcome, and an error there would be inventing a problem.
 */
export async function startTabWithUser(userId: string): Promise<AddFriendState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=%2Ffriends%2Fnew');

  const { data: groupId, error } = await supabase.rpc('create_friend_tab', {
    p_other: userId,
  });

  if (error) {
    console.error('startTabWithUser failed:', error.message);
    return { error: 'We could not open that tab. Try again.' };
  }

  if (!groupId) {
    console.error('startTabWithUser: RPC returned no group id');
    return { error: 'We could not open that tab. Try again.' };
  }

  revalidatePath('/friends');
  redirect(`/friends/${groupId}`);
}

/**
 * Creates a PRIVATE friend tab against someone who is not on SplitApp.
 *
 * One RPC, not three inserts: create_placeholder_friend_tab writes the group row,
 * the caller's member row and the placeholder member row in a single transaction,
 * so a failure halfway cannot leave a tab with nobody in it. It is SECURITY
 * DEFINER and re-validates everything below, so these checks decide what the
 * screen SAYS, never what is permitted.
 *
 * Nothing here notifies, invites or messages the named person. There is no such
 * path in the function and none is added: the row it writes has user_id NULL, so
 * there is no account to reach even in principle.
 */
export async function addFriendByName(
  _prev: AddFriendState,
  formData: FormData,
): Promise<AddFriendState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=%2Ffriends%2Fnew%2Fby-name');

  const name = String(formData.get('name') ?? '').trim();
  const upiRaw = String(formData.get('upi_id') ?? '').trim();

  // Our own copy, shown first so a blank submit reads as a sentence rather than
  // as whatever the database would have said. The function raises on blank too.
  if (!name) return { error: 'Enter a name for this person.' };
  if (name.length > 80) return { error: 'That name is too long. Use 80 characters or fewer.' };

  // Blank and absent are the same thing; send NULL so the column stores the
  // absence rather than an empty string. The function normalises this as well.
  const { data: groupId, error } = await supabase.rpc('create_placeholder_friend_tab', {
    p_name: name,
    p_upi: upiRaw || null,
  });

  if (error) {
    // The RPC's own text never reaches the screen — an RLS or constraint message
    // must read as a sentence, not as a policy or column name.
    console.error('addFriendByName failed:', error.message);
    return { error: 'We could not create that tab. Try again.' };
  }

  if (!groupId) {
    console.error('addFriendByName: RPC returned no group id');
    return { error: 'We could not create that tab. Try again.' };
  }

  revalidatePath('/friends');
  redirect(`/friends/${groupId}`);
}
