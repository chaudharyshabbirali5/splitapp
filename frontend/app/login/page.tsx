'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { createMagicLinkClient } from '@/lib/supabase/client';
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

    // No PKCE — see createMagicLinkClient(). The emailed link must open in any
    // browser, so it cannot depend on a code_verifier stored in this one.
    const supabase = createMagicLinkClient();

    // Always carries a query string, which the email template relies on when it
    // appends &token_hash=...&type=... to this URL.
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
        <h1 className="page-title">Check your email</h1>
        <p className="text-sm text-ink-soft">
          We sent a sign-in link to{' '}
          <span className="figure font-medium text-ink">{state.email}</span>. Open it on
          this device to finish signing in.
        </p>
        <button
          type="button"
          onClick={() => setState({ kind: 'idle' })}
          className="link text-sm"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5">
      <div className="space-y-2 border-b border-rule pb-5">
        <p className="khata-label">Shared expenses &middot; settled over UPI</p>
        <h1 className="text-3xl font-semibold tracking-[-0.03em]">SplitApp</h1>
        <p className="text-sm text-ink-soft">Sign in with your email. No password needed.</p>
      </div>

      {authError && <p className="notice-error">{authError}</p>}

      <div className="space-y-1.5">
        <label htmlFor="email" className="field-label">
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
          className="field"
        />
      </div>

      {state.kind === 'error' && <p className="text-sm text-debit">{state.message}</p>}

      <button
        type="submit"
        disabled={state.kind === 'sending'}
        className="btn btn-primary btn-block"
      >
        {state.kind === 'sending' ? 'Sending…' : 'Send magic link'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
