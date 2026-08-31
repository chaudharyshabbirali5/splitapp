'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { safeNext } from '@/lib/safe-next';
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

  const rawNext = String(formData.get('next') ?? '');
  const next = rawNext ? safeNext(rawNext) : null;

  // display_name is NOT NULL in the schema, so an empty value must be rejected
  // here rather than handed to Postgres.
  if (!displayName) return { status: 'idle', error: 'Please enter a display name.' };

  // When the user was sent here by the group-creation gate, the UPI ID is the
  // whole reason they were redirected, so it is required for that round trip.
  if (next && !upiRaw) {
    return { status: 'idle', error: 'Add a UPI ID so people can pay you back.' };
  }

  const { error } = await supabase
    .from('profiles')
    .update({ display_name: displayName, upi_id: upiRaw || null })
    .eq('id', user.id);

  if (error) {
    // Supabase's own text never reaches the screen; an RLS refusal must read as
    // "you can't do this", not as a policy name.
    console.error('saveProfile failed:', error.message);
    return { status: 'idle', error: 'We could not save your profile. Try again.' };
  }

  revalidatePath('/profile');
  revalidatePath('/groups');

  // redirect() throws internally, so it must stay outside any try/catch.
  if (next) redirect(next);

  return { status: 'saved' };
}
