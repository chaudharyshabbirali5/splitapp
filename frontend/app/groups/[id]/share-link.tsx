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
        className="btn btn-quiet btn-block"
      >
        {copied ? 'Link copied' : 'Share invite link'}
      </button>

      {fallback && (
        <p className="figure break-all bg-sunken px-3 py-2 text-xs text-ink-soft">
          {fallback}
        </p>
      )}

      <p className="hint">Anyone signed in who opens this link joins the group.</p>
    </div>
  );
}
