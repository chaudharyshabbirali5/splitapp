'use client';

import { useCallback, useEffect, useState } from 'react';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISSED_KEY = 'splitapp:install-hint-dismissed';

/**
 * Captures the browser's install prompt so more than one surface can offer it.
 *
 * Extracted so the Profile screen's Install card and this floating hint share
 * ONE mechanism. beforeinstallprompt fires once and its event can only be
 * prompt()-ed once, so two independent listeners would race for the same event
 * and the loser would render a dead button.
 */
export function useInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      // Suppress the default mini-infobar so the offer appears where we want it.
      e.preventDefault();
      setInstallEvent(e as InstallPromptEvent);
    };
    const onInstalled = () => setInstallEvent(null);

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  }, [installEvent]);

  return { canInstall: installEvent !== null, install };
}

export function Pwa() {
  const { canInstall, install } = useInstallPrompt();

  // ---- service worker registration ----
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // If a worker is already controlling this page, a later controllerchange means
    // a NEW build took over, and the page should reload to match it. On the very
    // first install there is no controller yet, and reloading then would be a
    // pointless flash.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloading = false;

    const onControllerChange = () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          // Never satisfy the script request from the HTTP cache.
          updateViaCache: 'none',
        });
        // Catch a new deploy while the app is open rather than only on next launch.
        registration.update().catch(() => {});
      } catch {
        // A failed registration must not break the app; it only costs installability.
      }
    };

    if (document.readyState === 'complete') void register();
    else window.addEventListener('load', register, { once: true });

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      window.removeEventListener('load', register);
    };
  }, []);

  // ---- install hint ----
  // Only the dismissal is this component's business now; the prompt itself is
  // owned by useInstallPrompt() above and shared with the Profile screen.
  //
  // Read lazily rather than in an effect: it is a one-time read of storage that
  // never changes afterwards, so an effect would only add a render and trip
  // react-hooks/set-state-in-effect. Starts true on the server so the hint
  // cannot flash before the real value is known.
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Private mode can refuse writes; the hint simply returns next visit.
    }
  }

  if (dismissed || !canInstall) return null;

  return (
    // Sits above the floating tab bar (64px tall, 20px gutter), not under it.
    <div
      className="card fixed inset-x-5 z-50 mx-auto flex max-w-md items-center gap-3"
      style={{ bottom: 'calc(var(--gutter) + var(--tabbar-h) + 12px + var(--safe-bottom))' }}
    >
      <p className="min-w-0 flex-1 text-sm">
        Install SplitApp for quicker access.
      </p>
      <button
        type="button"
        onClick={() => void install()}
        className="btn btn-primary btn-sm shrink-0"
      >
        Install
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install hint"
        className="link shrink-0 text-sm"
      >
        Not now
      </button>
    </div>
  );
}
