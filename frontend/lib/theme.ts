/**
 * Theme resolution, kept as pure functions so the no-flash inline script and
 * the React provider cannot drift apart — both import the same rules.
 *
 * Why an explicit attribute rather than CSS media queries: globals.css triggers
 * dark from [data-theme='dark'] ONLY. It deliberately ships no
 * prefers-color-scheme block (see the comment above its dark block). So
 * "system" is not something the stylesheet can do by itself — it has to be
 * resolved to a concrete light/dark value and written onto <html>.
 */

export const THEME_STORAGE_KEY = 'splitapp-theme';

/** What the user chose. */
export type ThemePreference = 'light' | 'dark' | 'system';

/** What actually ends up on <html data-theme="...">. */
export type ResolvedTheme = 'light' | 'dark';

export function isThemePreference(v: unknown): v is ThemePreference {
  return v === 'light' || v === 'dark' || v === 'system';
}

/**
 * A stored value is only honoured if it is one of the three known states.
 * Anything else — absent, corrupted, or written by an older build — falls back
 * to following the system.
 */
export function readPreference(raw: string | null): ThemePreference {
  return isThemePreference(raw) ? raw : 'system';
}

/** 'system' defers to the OS; the other two override it. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}
