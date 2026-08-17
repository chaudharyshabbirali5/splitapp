import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function GroupsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // First real round-trip through RLS. Signed in as `authenticated`, so the
  // groups_select policy limits this to groups the user belongs to or created.
  const { data: groups, error } = await supabase
    .from('groups')
    .select('id, name, group_type, created_at')
    .is('archived_at', null) // archived groups are hidden, not deleted
    .order('created_at', { ascending: false });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-6 sm:p-10">
      <header className="flex items-start justify-between gap-4 border-b border-rule pb-4">
        <div className="min-w-0">
          <h1 className="page-title">Groups</h1>
          <p className="figure mt-1 truncate text-xs text-ink-faint">{user.email}</p>
        </div>
        <div className="flex shrink-0 items-center gap-4 text-sm">
          <Link href="/profile" className="link">
            Profile
          </Link>
          <form action="/auth/signout" method="post">
            <button type="submit" className="link">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {error ? (
        <p className="notice-error">Could not load your groups: {error.message}</p>
      ) : groups && groups.length > 0 ? (
        <ul className="ledger">
          {groups.map((g) => (
            <li key={g.id}>
              <Link href={`/groups/${g.id}`} className="ledger-row ledger-link">
                <span className="min-w-0 truncate font-medium">{g.name}</span>
                <span className="chip chip-quiet">{g.group_type}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty flex flex-col items-center gap-2">
          <p className="khata-label">Nothing entered yet</p>
          <p className="mt-1 max-w-xs text-sm text-ink-soft">
            Create a group for a trip, a flat, or a one-off event, then start adding expenses.
          </p>
        </div>
      )}

      <Link href="/groups/new" className="btn btn-primary btn-block">
        Create group
      </Link>
    </main>
  );
}
