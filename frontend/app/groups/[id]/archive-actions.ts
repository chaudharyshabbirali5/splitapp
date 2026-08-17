'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';

export type ArchiveState = { error?: string };

/**
 * Archives (soft-deletes) a group.
 *
 * Creator-only, enforced by the groups_update RLS policy via is_group_creator;
 * archive_group() re-checks so the user gets a readable message rather than a
 * silent no-op. Nothing is destroyed — every expense, split and settlement
 * stays exactly where it was.
 */
export async function archiveGroup(
  groupId: string,
  groupName: string,
  _prev: ArchiveState,
  formData: FormData,
): Promise<ArchiveState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/groups/${groupId}`)}`);

  // Typed confirmation. Checked here as well as in the browser so a stray
  // request cannot skip it.
  const typed = String(formData.get('confirm_name') ?? '').trim();
  if (typed !== groupName.trim()) {
    return { error: `Type the group name exactly — "${groupName}" — to confirm.` };
  }

  const { error } = await supabase.rpc('archive_group', { p_group_id: groupId });
  if (error) return { error: error.message };

  revalidatePath('/groups');
  redirect('/groups');
}
