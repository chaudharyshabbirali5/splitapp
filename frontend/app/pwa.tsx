'use client';

import { useEffect, useState } from 'react';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISSED_KEY = 'splitapp:install-hint-dismissed';

export function Pwa() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(true);

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
  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      // Suppress the default mini-infobar so the hint appears where we want it.
      e.preventDefault();
      setInstallEvent(e as InstallPromptEvent);
      try {
        if (window.localStorage.getItem(DISMISSED_KEY) !== '1') setHidden(false);
      } catch {
        setHidden(false);
      }
    };
    const onInstalled = () => {
      setHidden(true);
      setInstallEvent(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  function dismiss() {
    setHidden(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Private mode can refuse writes; the hint simply returns next visit.
    }
  }

  async function install() {
    if (!installEvent) return;
    setHidden(true);
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  }

  if (hidden || !installEvent) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
      <p className="min-w-0 flex-1 text-sm">
        Install SplitApp for quicker access.
      </p>
      <button
        type="button"
        onClick={install}
        className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        Install
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install hint"
        className="shrink-0 text-sm text-zinc-500 hover:text-black dark:hover:text-white"
      >
        Not now
      </button>
    </div>
  );
}
