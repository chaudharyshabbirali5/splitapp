'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';

export type ProfileFormState = { status: 'idle' | 'saved'; error?: string };

export async function saveProfile(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: 'idle', error: 'You are signed out. Sign in and try again.' };

  const displayName = String(formData.get('display_name') ?? '').trim();
  const upiRaw = String(formData.get('upi_id') ?? '').trim();

  // display_name is NOT NULL in the schema, so an empty value must be rejected
  // here rather than handed to Postgres.
  if (!displayName) return { status: 'idle', error: 'Please enter a display name.' };

  const { error } = await supabase
    .from('profiles')
    .update({ display_name: displayName, upi_id: upiRaw || null })
    .eq('id', user.id);

  if (error) return { status: 'idle', error: error.message };

  revalidatePath('/profile');
  revalidatePath('/groups');
  return { status: 'saved' };
}
