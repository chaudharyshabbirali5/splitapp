'use client';

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from 'react';

import {
  readPreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/* ── preference store (localStorage) ─────────────────────────────────────────
   localStorage is not reactive, so it is wrapped as an external store. The
   listener set covers changes made in THIS tab; the 'storage' event covers
   changes made in another one, so two open tabs stay in agreement. */

const listeners = new Set<() => void>();

function subscribePreference(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function getPreference(): ThemePreference {
  try {
    return readPreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Private modes can throw on access. Following the system is the safe read.
    return 'system';
  }
}

// On the server there is no preference to read, and no OS to ask.
const getPreferenceOnServer = (): ThemePreference => 'system';

/* ── system store (matchMedia) ───────────────────────────────────────────── */

function subscribeSystem(onChange: () => void) {
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function getSystemDark(): boolean {
  try {
    return window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

const getSystemDarkOnServer = () => false;

/* ── provider ────────────────────────────────────────────────────────────── */

type ThemeContextValue = {
  /** What the user picked: light | dark | system. */
  preference: ThemePreference;
  /** What is actually on screen right now. */
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preference = useSyncExternalStore(
    subscribePreference,
    getPreference,
    getPreferenceOnServer,
  );

  // Kept live rather than read once: if the OS flips to dark at sunset while
  // the preference is 'system', the app follows without a reload.
  const systemDark = useSyncExternalStore(
    subscribeSystem,
    getSystemDark,
    getSystemDarkOnServer,
  );

  const resolved = resolveTheme(preference, systemDark);

  // The one place <html data-theme> is written after first paint. globals.css
  // keys its entire dark palette off this attribute. Before paint, the inline
  // script in <head> has already set the same value.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Persistence is a convenience; a private-mode failure must not stop the
      // theme changing for this session.
    }
    // 'storage' does not fire in the tab that made the change, so tell it here.
    listeners.forEach((l) => l());
  }, []);

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
