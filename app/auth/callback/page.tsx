'use client';

import { useEffect, useState } from 'react';
import type { EmailOtpType } from '@supabase/supabase-js';

import { safeNext } from '@/lib/safe-next';
import { createCallbackClient } from '@/lib/supabase/client';

/**
 * Completes sign-in from the emailed link.
 *
 * This is a CLIENT page, not a route handler, and that is the whole point.
 * Supabase's default (uneditable without custom SMTP) magic-link email points at
 * /auth/v1/verify on Supabase, which verifies the token server-side and then
 * redirects here with the session in the URL *fragment*:
 *
 *   /auth/callback?next=/groups#access_token=...&refresh_token=...
 *
 * A fragment is never transmitted to the server, so no server route could read
 * it. Reading it here and calling setSession() stores the session in cookies via
 * @supabase/ssr, which is what middleware and Server Components then see.
 *
 * Because the tokens travel in the link itself, nothing is required from the
 * browser that originally requested it — this works from the Gmail app, another
 * browser, or another device.
 */
export default function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const supabase = createCallbackClient();

      const query = new URLSearchParams(window.location.search);
      const fragment = new URLSearchParams(
        window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '',
      );
      const next = safeNext(query.get('next'));

      const fail = (message: string) => {
        if (cancelled) return;
        setError(message);
        window.location.replace(`/login?error=${encodeURIComponent(message)}`);
      };

      const done = () => {
        if (cancelled) return;
        // Drop the tokens from the address bar before navigating, so they do not
        // linger in browser history.
        window.history.replaceState(null, '', window.location.pathname);
        // Full navigation rather than a client-side push: middleware has to run
        // and read the cookies we just set.
        window.location.replace(next);
      };

      // Supabase reports its own failures in whichever half of the URL it used.
      const reported =
        fragment.get('error_description') ??
        fragment.get('error') ??
        query.get('error_description') ??
        query.get('error');
      if (reported) return fail(reported);

      // ---- Implicit flow: tokens in the fragment -------------------------
      // This is what the DEFAULT Supabase email template produces.
      const accessToken = fragment.get('access_token');
      const refreshToken = fragment.get('refresh_token');
      if (accessToken && refreshToken) {
        const { error: e } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        return e ? fail(e.message) : done();
      }

      // ---- Token-hash flow ------------------------------------------------
      // Used only if the email template is later customised (needs custom SMTP).
      // Verified here rather than server-side so both flows share one route.
      const tokenHash = query.get('token_hash');
      const type = query.get('type');
      if (tokenHash && type) {
        const { error: e } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: type as EmailOtpType,
        });
        return e ? fail(e.message) : done();
      }

      // ---- PKCE ------------------------------------------------------------
      // Retained for OAuth / social login, which completes in the same browser
      // that started it and therefore still has the code_verifier.
      const code = query.get('code');
      if (code) {
        const { error: e } = await supabase.auth.exchangeCodeForSession(code);
        return e ? fail(e.message) : done();
      }

      fail('That sign-in link is invalid or has expired.');
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <p className="khata-label" role="status" aria-live="polite">
        {error ? `Sign-in failed: ${error}` : 'Signing you in…'}
      </p>
    </main>
  );
}
