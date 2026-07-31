'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';

export type AddMemberState = { status: 'idle' | 'added'; error?: string };

/**
 * Adds a placeholder member — someone who is part of the group but has no
 * account yet, so user_id stays NULL. Allowed by the existing members_insert
 * policy (is_group_member OR is_group_creator); no policy change needed.
 */
export async function addPlaceholderMember(
  groupId: string,
  _prev: AddMemberState,
  formData: FormData,
): Promise<AddMemberState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: 'idle', error: 'You are signed out. Sign in and try again.' };

  const displayName = String(formData.get('display_name') ?? '').trim();
  const upiRaw = String(formData.get('upi_id') ?? '').trim();

  if (!displayName) return { status: 'idle', error: 'Enter a name.' };

  const { error } = await supabase.from('group_members').insert({
    group_id: groupId,
    user_id: null, // placeholder: not on the app yet
    display_name: displayName,
    upi_id: upiRaw || null,
    role: 'member',
  });

  if (error) return { status: 'idle', error: error.message };

  revalidatePath(`/groups/${groupId}`);
  return { status: 'added' };
}
