import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

import { ProfileForm } from './profile-form';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // The row is created by the on_auth_user_created trigger at signup, so it
  // should always exist. maybeSingle() keeps a missing row from throwing.
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('display_name, upi_id')
    .eq('id', user.id)
    .maybeSingle();

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6 sm:p-10">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Complete your profile</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Tell people who you are before you start splitting expenses.
        </p>
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          Could not load your profile: {error.message}
        </p>
      ) : (
        <ProfileForm
          displayName={profile?.display_name ?? ''}
          upiId={profile?.upi_id ?? null}
        />
      )}
    </main>
  );
}
