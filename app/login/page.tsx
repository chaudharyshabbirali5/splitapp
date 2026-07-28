'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { createClient } from '@/lib/supabase/client';
import { getSiteUrl } from '@/lib/supabase/env';

type State =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; email: string }
  | { kind: 'error'; message: string };

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  // Where the user was headed before being bounced to /login.
  const next = searchParams.get('next') ?? '/groups';
  const authError = searchParams.get('error');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    setState({ kind: 'sending' });

    const supabase = createClient();
    const redirectTo = `${getSiteUrl()}/auth/callback?next=${encodeURIComponent(next)}`;

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: redirectTo },
    });

    setState(error ? { kind: 'error', message: error.message } : { kind: 'sent', email: trimmed });
  }

  if (state.kind === 'sent') {
    return (
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          We sent a sign-in link to <span className="font-medium">{state.email}</span>. Open it on
          this device to finish signing in.
        </p>
        <button
          type="button"
          onClick={() => setState({ kind: 'idle' })}
          className="text-sm underline underline-offset-4 text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-white"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5">
      <div className="space-y-1.5 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">SplitApp</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Sign in with your email. No password needed.
        </p>
      </div>

      {authError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {authError}
        </p>
      )}

      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100"
        />
      </div>

      {state.kind === 'error' && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
      )}

      <button
        type="submit"
        disabled={state.kind === 'sending'}
        className="w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {state.kind === 'sending' ? 'Sending…' : 'Send magic link'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 p-8 dark:bg-black">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
