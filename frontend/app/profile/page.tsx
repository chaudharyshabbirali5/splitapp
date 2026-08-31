import Link from 'next/link';
import { redirect } from 'next/navigation';

import { safeNext } from '@/lib/safe-next';
import { createClient } from '@/lib/supabase/server';

import { ArchivePicker, type ArchivableGroup } from './archive-picker';
import { InstallCard } from './install-card';
import { ProfileForm } from './profile-form';
import { ThemeToggle } from '../theme-toggle';

export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = {
  flat: 'Flat',
  trip: 'Trip',
  event: 'Event',
  other: 'Other',
};

/** Stable per-person tint, hashed from the name. Mirrors the design's tintFor(). */
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

  const [profileRes, archivedRes, ownedRes] = await Promise.all([
    // The row is created by the on_auth_user_created trigger at signup, so it
    // should always exist. maybeSingle() keeps a missing row from throwing.
    supabase.from('profiles').select('display_name, upi_id').eq('id', user.id).maybeSingle(),
    // Archived groups are still readable — archiving hides, it does not delete.
    supabase
      .from('groups')
      .select('id, name, group_type, archived_at')
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false }),
    // Only groups this user created can be archived by them. Convenience only:
    // archive_group() and groups_update enforce it again server-side.
    supabase
      .from('groups')
      .select('id, name')
      .eq('created_by', user.id)
      .is('archived_at', null)
      .order('created_at', { ascending: false }),
  ]);

  const readError = profileRes.error || archivedRes.error || ownedRes.error;
  if (readError) {
    console.error('profile page read failed:', readError.message);
  }

  const profile = profileRes.data;
  const archived = archivedRes.data ?? [];
  const owned = (ownedRes.data ?? []) as ArchivableGroup[];
  const displayName = profile?.display_name ?? '';

  return (
    <main
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 py-6"
      style={{ paddingInline: 'var(--gutter)' }}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/groups" className="link-back">
            &larr; All groups
          </Link>
          <h1 className="page-title pt-1">
            {next ? 'Complete your profile' : 'Profile'}
          </h1>
          <p className="figure mt-1 truncate text-sm text-ink-soft">{user.email}</p>
        </div>
        <span
          className={`avatar size-10 shrink-0 text-base ${tintFor(displayName || user.email || '')}`}
        >
          {(displayName || user.email || '?').trim().charAt(0).toUpperCase()}
        </span>
      </header>

      {next && (
        <p className="text-sm text-ink-soft">
          Before you create a group, tell people who you are and how to pay you back.
        </p>
      )}

      {readError ? (
        <p className="notice-error" role="alert">
          We couldn&rsquo;t load your profile. Refresh, or sign in again if this keeps
          happening.
        </p>
      ) : (
        <>
          <ProfileForm
            displayName={displayName}
            upiId={profile?.upi_id ?? null}
            next={next}
          />

          <InstallCard />

          {/* The theme control finally gets a home. The mechanism has been live
              since the design-system swap; this only renders it. */}
          <section className="flex flex-col gap-2">
            <h2 className="khata-label">Appearance</h2>
            <ThemeToggle />
            <p className="hint">
              System follows your device. Light and dark override it.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="khata-label">Archived groups</h2>

            {archived.length === 0 ? (
              <p className="empty text-sm text-ink-soft">No archived groups.</p>
            ) : (
              <div className="card card-flush">
                <ul className="ledger border-t-0 border-b-0">
                  {archived.map((g) => (
                    <li key={g.id} className="ledger-row">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{g.name}</span>
                        <span className="block truncate text-xs text-ink-faint">
                          Archived{' '}
                          {g.archived_at
                            ? new Date(g.archived_at).toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                              })
                            : ''}
                        </span>
                      </span>
                      <span className="chip chip-quiet">
                        {TYPE_LABEL[g.group_type] ?? g.group_type}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="hint">
              An archived group is hidden and frozen for everyone in it. Nothing is
              deleted — restoring one currently needs a hand-run SQL statement.
            </p>

            {/* Archiving lives with the archived list: one place for a group's
                whole lifecycle, rather than split across two screens. */}
            <ArchivePicker groups={owned} />
          </section>

          <section className="flex flex-col gap-3 border-t border-rule pt-5">
            <h2 className="khata-label">Danger zone</h2>
            <form action="/auth/signout" method="post">
              <button type="submit" className="btn btn-quiet btn-block">
                Sign out
              </button>
            </form>
          </section>
        </>
      )}
    </main>
  );
}
