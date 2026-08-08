import { redirect } from 'next/navigation';

import { safeNext } from '@/lib/safe-next';
import { createClient } from '@/lib/supabase/server';

import { ProfileForm } from './profile-form';

export const dynamic = 'force-dynamic';

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=%2Fprofile');

  const { next: rawNext } = await searchParams;
  const next = rawNext ? safeNext(rawNext) : null;

  // The row is created by the on_auth_user_created trigger at signup, so it
  // should always exist. maybeSingle() keeps a missing row from throwing.
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('display_name, upi_id')
    .eq('id', user.id)
    .maybeSingle();

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6 sm:p-10">
      <div className="space-y-1.5 border-b border-rule pb-4">
        <h1 className="page-title">{next ? 'Complete your profile' : 'Your profile'}</h1>
        <p className="text-sm text-ink-soft">
          {next
            ? 'Before you create a group, tell people who you are and how to pay you back.'
            : 'Tell people who you are before you start splitting expenses.'}
        </p>
      </div>

      {error ? (
        <p className="notice-error">Could not load your profile: {error.message}</p>
      ) : (
        <ProfileForm
          displayName={profile?.display_name ?? ''}
          upiId={profile?.upi_id ?? null}
          next={next}
        />
      )}
    </main>
  );
}
