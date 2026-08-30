'use client';

import { House, Inbox, Plus, Scale, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { groupIdFromPath, isTabBarHidden } from '@/lib/nav';

/**
 * The floating bottom navigation.
 *
 * Rendered from the root layout rather than from each screen, so Stage 3 adds
 * no code to any page.tsx. Visibility is decided here from the pathname.
 *
 * The group-scoped tabs need a group id, which the layout does not have. Rather
 * than invent one, they read it out of the current path when we are inside a
 * group, and fall back to the groups list when we are not — so a tab never
 * points at a route that cannot exist.
 */

const ICON = { size: 21, strokeWidth: 1.5 } as const;

export function TabBar() {
  const pathname = usePathname() ?? '';
  if (isTabBarHidden(pathname)) return null;

  const groupId = groupIdFromPath(pathname);
  const groupHref = groupId ? `/groups/${groupId}` : '/groups';
  const balancesHref = groupId ? `/groups/${groupId}/balances` : '/groups';
  const addHref = groupId ? `/groups/${groupId}/expenses/new` : '/groups/new';

  const onGroups = pathname === '/groups';
  const onGroup = !!groupId && pathname === `/groups/${groupId}`;
  const onBalances = !!groupId && pathname === `/groups/${groupId}/balances`;
  const onProfile = pathname.startsWith('/profile');

  return (
    <nav className="tabbar" aria-label="Primary">
      <Link
        href="/groups"
        className="tabbar-tab"
        aria-label="Groups"
        aria-current={onGroups ? 'page' : undefined}
      >
        <House {...ICON} aria-hidden="true" />
      </Link>

      <Link
        href={groupHref}
        className="tabbar-tab"
        aria-label="This group"
        aria-current={onGroup ? 'page' : undefined}
      >
        <Inbox {...ICON} aria-hidden="true" />
      </Link>

      <Link
        href={addHref}
        className="tabbar-add"
        aria-label={groupId ? 'Add expense' : 'New group'}
      >
        <Plus size={24} strokeWidth={1.5} aria-hidden="true" />
      </Link>

      <Link
        href={balancesHref}
        className="tabbar-tab"
        aria-label="Balances"
        aria-current={onBalances ? 'page' : undefined}
      >
        <Scale {...ICON} aria-hidden="true" />
      </Link>

      <Link
        href="/profile"
        className="tabbar-tab"
        aria-label="Profile"
        aria-current={onProfile ? 'page' : undefined}
      >
        <User {...ICON} aria-hidden="true" />
      </Link>
    </nav>
  );
}

/**
 * Bottom padding so the floating bar never covers the last row, applied from
 * the layout because the scroll containers live inside each page.tsx and those
 * are Stage 4. Mirrors TabBar's own visibility so screens without a bar keep
 * their original spacing.
 */
export function TabBarSpacer() {
  const pathname = usePathname() ?? '';
  if (isTabBarHidden(pathname)) return null;
  return <div aria-hidden="true" style={{ height: 120 }} />;
}
