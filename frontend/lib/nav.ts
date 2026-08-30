/**
 * Route predicates for the bottom navigation.
 *
 * Kept out of the component and free of React/Next imports so they can be
 * tested directly — the tab bar's visibility rules are the sort of thing that
 * silently rots when a route is added.
 */

/** Screens that must NOT show the bar: auth flows and the expense form. */
export function isTabBarHidden(pathname: string): boolean {
  if (pathname === '/') return true; // redirect-only route, never painted
  if (pathname.startsWith('/login')) return true;
  if (pathname.startsWith('/auth')) return true;
  if (pathname.startsWith('/join')) return true;
  // Add expense, and the edit form — the same form, so the same rule.
  if (/\/expenses\/(new|[^/]+\/edit)$/.test(pathname)) return true;
  return false;
}

/** `/groups/<id>/...` → `<id>`; null when we are not inside a real group. */
export function groupIdFromPath(pathname: string): string | null {
  const m = /^\/groups\/([^/]+)/.exec(pathname);
  if (!m) return null;
  return m[1] === 'new' ? null : m[1];
}
