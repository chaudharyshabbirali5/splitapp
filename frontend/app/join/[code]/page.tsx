import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Joining a group from an invite link.
 *
 * A first-time joiner is neither a member nor the creator, so members_insert
 * correctly refuses a direct INSERT. Rather than loosening that policy, the join
 * goes through join_group_via_code(), a SECURITY DEFINER function for which
 * holding a valid invite code IS the authorisation.
 *
 * If the visitor is signed out, middleware sends them to /login?next=/join/<code>
 * first and the callback returns them here afterwards.
 */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/join/${code}`)}`);

  // Reject a malformed code before it reaches Postgres, where a bad uuid cast
  // would surface as a database error rather than a readable message.
  if (!UUID_RE.test(code)) return <JoinError message="That invite link is not valid." />;

  const { data: groupId, error } = await supabase.rpc('join_group_via_code', { p_code: code });

  if (error) return <JoinError message={error.message} />;
  if (!groupId) return <JoinError message="That invite link is not valid." />;

  redirect(`/groups/${groupId}`);
}

function JoinError({ message }: { message: string }) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="page-title">Could not join</h1>
      <p className="text-sm text-ink-soft">{message}</p>
      <Link href="/groups" className="link text-sm">
        Back to groups
      </Link>
    </main>
  );
}
