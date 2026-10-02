'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

export type AddFriendState = { error?: string };

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
