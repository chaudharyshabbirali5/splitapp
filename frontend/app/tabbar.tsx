'use client';

import { House, Users, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { isTabBarHidden } from '@/lib/nav';

/**
 * The floating bottom navigation.
 *
 * Rendered from the root layout rather than from each screen, so no page.tsx
 * carries nav code. Visibility is decided here from the pathname.
 *
 * EXACTLY THREE TABS, each with a visible text label.
 *
 * What changed, and why it is a deliberate reduction rather than a tidy-up:
 *
 *   * "This group" and "Balances" are gone. Both were group-scoped — they read a
 *     group id out of the path and fell back to /groups when there wasn't one,
 *     which meant two of the five tabs pointed at the same place from anywhere
 *     outside a group. A tab that changes meaning depending on where you already
 *     are is not top-level navigation. Balances is reached from a group screen,
 *     which is the only place it has a subject.
 *   * The centre Add button is gone. It had the same problem in sharper form: it
 *     was "Add expense" inside a group and "New group" outside, one control with
 *     two unrelated destinations. Each screen already carries its own primary
 *     action (Create group on the groups list, Add someone on a group), which is
 *     where an action belongs — next to the thing it acts on.
 *
 * That leaves Groups | Friends | Profile: three destinations that mean the same
 * thing from every screen in the app, so the bar no longer needs to know the
 * route it is sitting on to decide where a tab goes.
 *
 * LABELS. Every icon now carries its text. aria-label is dropped from the link
 * because the visible label is the accessible name once it is real text — keeping
 * both would have the screen reader choose between two names for one control.
 * The icon is aria-hidden, as before.
 *
 * NO NEW CSS. .tabbar-tab is a fixed 44x44 centring box, which cannot hold a
 * stacked icon-plus-label, so the stack is composed from existing utilities:
 * flex-col, h-auto to release the fixed height, and the tap target kept at 44px
 * via min-h. No token, class or component is added to globals.css.
 */

const ICON = { size: 20, strokeWidth: 1.5 } as const;

export function TabBar() {
  const pathname = usePathname() ?? '';
  if (isTabBarHidden(pathname)) return null;

  // Each tab is one fixed destination, so "am I here" is a plain prefix test.
  // /groups must not light up while you are on /groups/<id>/... — a section tab
  // that stays lit inside a detail screen tells you nothing — so the groups tab
  // matches the list and the create screen only.
  const onGroups = pathname === '/groups' || pathname.startsWith('/groups/new');
  const onFriends = pathname.startsWith('/friends');
  const onProfile = pathname.startsWith('/profile');

  return (
    <nav className="tabbar" aria-label="Primary">
      <Link
        href="/groups"
        className="tabbar-tab h-auto min-h-11 flex-1 flex-col gap-1 py-1.5"
        aria-current={onGroups ? 'page' : undefined}
      >
        <House {...ICON} aria-hidden="true" />
        <span className="text-[0.625rem] leading-none font-medium">Groups</span>
      </Link>

      <Link
        href="/friends"
        className="tabbar-tab h-auto min-h-11 flex-1 flex-col gap-1 py-1.5"
        aria-current={onFriends ? 'page' : undefined}
      >
        <Users {...ICON} aria-hidden="true" />
        <span className="text-[0.625rem] leading-none font-medium">Friends</span>
      </Link>

      <Link
        href="/profile"
        className="tabbar-tab h-auto min-h-11 flex-1 flex-col gap-1 py-1.5"
        aria-current={onProfile ? 'page' : undefined}
      >
        <User {...ICON} aria-hidden="true" />
        <span className="text-[0.625rem] leading-none font-medium">Profile</span>
      </Link>
    </nav>
  );
}

/**
 * Bottom padding so the floating bar never covers the last row, applied from the
 * layout because the scroll containers live inside each page.tsx. Mirrors
 * TabBar's own visibility so screens without a bar keep their original spacing.
 */
export function TabBarSpacer() {
  const pathname = usePathname() ?? '';
  if (isTabBarHidden(pathname)) return null;
  return <div aria-hidden="true" style={{ height: 120 }} />;
}
