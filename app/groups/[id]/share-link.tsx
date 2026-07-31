'use client';

import { useState } from 'react';

/**
 * Builds the invite URL in the browser from window.location.origin, so it is
 * correct on localhost and on the deployed domain without any env var.
 */
export function ShareLink({ joinCode }: { joinCode: string }) {
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);

  async function copy() {
    const url = `${window.location.origin}/join/${joinCode}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access needs a secure context and can be blocked outright.
      // Show the link so it can still be copied by hand.
      setFallback(url);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={copy}
        className="w-full rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        {copied ? 'Link copied' : 'Share invite link'}
      </button>

      {fallback && (
        <p className="break-all rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {fallback}
        </p>
      )}

      <p className="text-xs text-zinc-500">
        Anyone signed in who opens this link joins the group.
      </p>
    </div>
  );
}
