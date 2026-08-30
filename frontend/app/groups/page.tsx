import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Stable per-person tint, hashed from the name so the same person keeps the
 * same colour everywhere. Mirrors Avatar's tintFor() in the design system.
 */
const TINTS = [
  'bg-tint-teal',
  'bg-tint-coral',
  'bg-tint-sand',
  'bg-tint-olive',
  'bg-tint-slate',
  'bg-tint-mauve',
] as const;

function tintFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
  return TINTS[h % TINTS.length];
}

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

  const count = groups?.length ?? 0;

  return (
    <main
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 py-6"
      style={{ paddingInline: 'var(--gutter)' }}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="page-title">Your groups</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {count} active &middot; balances update when a payment is confirmed
          </p>
        </div>

        {/* The avatar is the route to Profile, as in the design. */}
        <Link
          href="/profile"
          aria-label="Profile"
          className={`avatar size-9 text-sm ${tintFor(user.email ?? '')}`}
        >
          {(user.email ?? '?').trim().charAt(0).toUpperCase()}
        </Link>
      </header>

      {error ? (
        // Never the raw PostgREST/RLS text — a refusal reads as "you can't see
        // this", not as a policy name.
        <p className="notice-error" role="alert">
          We couldn&rsquo;t load your groups. Refresh, or sign in again if this keeps
          happening.
        </p>
      ) : count > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="khata-label">All groups</h2>
          <div className="card card-flush">
            <ul className="ledger border-t-0 border-b-0">
              {groups!.map((g) => (
                <li key={g.id}>
                  <Link href={`/groups/${g.id}`} className="ledger-row ledger-link">
                    <span className="min-w-0 truncate font-medium">{g.name}</span>
                    <span className="chip chip-quiet">{g.group_type}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : (
        <div className="empty flex flex-col items-center gap-2">
          <p className="khata-label">Nothing entered yet</p>
          <p className="mt-1 max-w-xs text-sm text-ink-soft">
            Create a group for a trip, a flat, or a one-off event, then start adding expenses.
          </p>
        </div>
      )}

      <Link href="/groups/new" className="btn btn-quiet btn-block">
        Create group
      </Link>
    </main>
  );
}
