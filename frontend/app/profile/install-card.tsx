'use client';

import Image from 'next/image';

import { useInstallPrompt } from '../pwa';

/**
 * The Install card.
 *
 * Shares useInstallPrompt() with the floating hint in pwa.tsx rather than
 * listening for beforeinstallprompt itself — the event fires once and can only
 * be prompt()-ed once, so two listeners would race and one would render a dead
 * button.
 *
 * Renders nothing when the browser has not offered an install: already
 * installed, an unsupported browser, or iOS Safari, which has no
 * beforeinstallprompt at all. A card whose only button cannot work is worse
 * than no card.
 */
export function InstallCard() {
  const { canInstall, install } = useInstallPrompt();

  if (!canInstall) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="khata-label">Install</h2>
      <div className="card flex items-center gap-3">
        <Image
          src="/icon-512.png"
          alt=""
          width={40}
          height={40}
          className="rounded-[10px]"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Add SplitApp to your home screen</p>
          <p className="hint">Works offline for reading your ledger.</p>
        </div>
        <button
          type="button"
          onClick={() => void install()}
          className="btn btn-quiet btn-sm shrink-0"
        >
          Install
        </button>
      </div>
    </section>
  );
}
