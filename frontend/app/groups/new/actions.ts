'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';

export type CreateGroupState = { error?: string };

const GROUP_TYPES = ['flat', 'trip', 'event', 'other'] as const;

export async function createGroup(
  _prev: CreateGroupState,
  formData: FormData,
): Promise<CreateGroupState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=%2Fgroups%2Fnew');

  const name = String(formData.get('name') ?? '').trim();
  const groupType = String(formData.get('group_type') ?? 'other');

  if (!name) return { error: 'Give the group a name.' };
  if (!GROUP_TYPES.includes(groupType as (typeof GROUP_TYPES)[number])) {
    return { error: 'Pick a valid group type.' };
  }

  // One RPC rather than two inserts: the group row and the creator's membership
  // row have to land together, or a failure halfway leaves a group nobody is in.
  const { data: groupId, error } = await supabase.rpc('create_group_with_owner', {
    p_name: name,
    p_group_type: groupType,
  });

  if (error) return { error: error.message };

  revalidatePath('/groups');
  redirect(`/groups/${groupId}`);
}
