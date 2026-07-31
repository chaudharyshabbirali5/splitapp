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
    .order('created_at', { ascending: false });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-6 sm:p-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Groups</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{user.email}</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href="/profile"
            className="underline underline-offset-4 text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-white"
          >
            Profile
          </Link>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="underline underline-offset-4 text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-white"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {error ? (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          Could not load your groups: {error.message}
        </p>
      ) : groups && groups.length > 0 ? (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {groups.map((g) => (
            <li key={g.id}>
              <Link
                href={`/groups/${g.id}`}
                className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <span className="font-medium">{g.name}</span>
                <span className="text-xs uppercase tracking-wide text-zinc-500">
                  {g.group_type}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-zinc-300 px-6 py-14 text-center dark:border-zinc-700">
          <p className="text-base font-medium">No groups yet</p>
          <p className="max-w-xs text-sm text-zinc-600 dark:text-zinc-400">
            Create a group for a trip, a flat, or a one-off event, then start adding expenses.
          </p>
        </div>
      )}

      <Link
        href="/groups/new"
        className="block w-full rounded-md bg-zinc-900 px-4 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        Create group
      </Link>
    </main>
  );
}
