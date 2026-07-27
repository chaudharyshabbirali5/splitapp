'use client';

import { useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';

type Status =
  | { kind: 'checking' }
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

export default function Home() {
  const [status, setStatus] = useState<Status>({ kind: 'checking' });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const supabase = createClient();
        const { error } = await supabase.auth.getSession();
        if (cancelled) return;
        setStatus(error ? { kind: 'error', message: error.message } : { kind: 'ok' });
      } catch (e) {
        // Most likely cause: a missing NEXT_PUBLIC_* env var.
        if (cancelled) return;
        setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 p-8 font-sans dark:bg-black">
      <h1 className="text-4xl font-semibold tracking-tight text-black dark:text-zinc-50">
        SplitApp
      </h1>

      <p
        className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400"
        role="status"
        aria-live="polite"
      >
        <span
          aria-hidden="true"
          className={
            'inline-block size-2 shrink-0 rounded-full ' +
            (status.kind === 'ok'
              ? 'bg-green-500'
              : status.kind === 'error'
                ? 'bg-red-500'
                : 'bg-zinc-400')
          }
        />
        {status.kind === 'checking' && 'Checking Supabase…'}
        {status.kind === 'ok' && 'Connected to Supabase'}
        {status.kind === 'error' && `Supabase error: ${status.message}`}
      </p>
    </main>
  );
}
