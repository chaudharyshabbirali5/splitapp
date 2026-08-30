'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { createMagicLinkClient } from '@/lib/supabase/client';
import { getSiteUrl } from '@/lib/supabase/env';

type State =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; email: string }
  | { kind: 'error' };

/**
 * The one sentence shown when sending fails, whatever the cause.
 *
 * Supabase's own message is deliberately not rendered. Two reasons: it leaks
 * implementation detail into a screen anyone can reach, and the most common
 * real failure here is the built-in mailer's ~2-3/hour rate limit, whose raw
 * text tells a user nothing they can act on.
 */
const SEND_FAILED =
  'We could not send the link. Check the address and try again in a minute.';

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  // Where the user was headed before being bounced to /login.
  const next = searchParams.get('next') ?? '/groups';
  // The callback redirects here with ?error=... on a failed sign-in. Its
  // presence is used; its contents are not rendered — the value is
  // attacker-supplied via the URL, and this is the one page where arbitrary
  // text would be most useful to someone running a phishing lure.
  const hasCallbackError = searchParams.get('error') !== null;

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

    if (error) {
      // Kept for debugging without putting it on screen.
      console.error('signInWithOtp failed:', error.message);
      setState({ kind: 'error' });
      return;
    }
    setState({ kind: 'sent', email: trimmed });
  }

  if (state.kind === 'sent') {
    return (
      <div className="flex w-full max-w-sm flex-col gap-4 text-center">
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
    <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-5">
      {/* Decorative: the wordmark directly below says the same thing. */}
      <Image
        src="/icon-512.png"
        alt=""
        width={44}
        height={44}
        className="rounded-[12px]"
        priority
      />

      <div className="flex flex-col gap-2 border-b border-rule pb-5">
        <p className="khata-label">Shared expenses &middot; settled over UPI</p>
        <h1 className="display-title">SplitApp</h1>
        <p className="text-sm text-ink-soft">Sign in with your email. No password needed.</p>
      </div>

      {(hasCallbackError || state.kind === 'error') && (
        <p className="notice-error" role="alert">
          {hasCallbackError && state.kind !== 'error'
            ? 'That sign-in link did not work. Request a new one below.'
            : SEND_FAILED}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
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

      {/* Loading is a label change, never a spinner or a shimmer. */}
      <button
        type="submit"
        disabled={state.kind === 'sending'}
        className="btn btn-primary btn-block btn-lg"
      >
        {state.kind === 'sending' ? 'Sending…' : 'Send magic link'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main
      className="flex flex-1 flex-col items-center justify-center"
      style={{ paddingInline: 'var(--gutter)' }}
    >
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
