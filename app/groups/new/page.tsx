import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

import { CreateGroupForm } from './create-group-form';

export const dynamic = 'force-dynamic';

export default async function NewGroupPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=%2Fgroups%2Fnew');

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, upi_id')
    .eq('id', user.id)
    .maybeSingle();

  // Profile gate. A member with no UPI ID cannot be paid back, so the group is
  // not useful until it is set. Send them to the profile form and bring them
  // straight back here afterwards. create_group_with_owner enforces the same
  // rule server-side, so this cannot be skipped by calling the RPC directly.
  const incomplete =
    !profile?.display_name?.trim() || !profile?.upi_id?.trim();
  if (incomplete) redirect('/profile?next=%2Fgroups%2Fnew');

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6 sm:p-10">
      <div className="space-y-1.5 border-b border-rule pb-4">
        <h1 className="page-title">New group</h1>
        <p className="text-sm text-ink-soft">You&rsquo;ll be added as the first member.</p>
      </div>

      <CreateGroupForm />
    </main>
  );
}
