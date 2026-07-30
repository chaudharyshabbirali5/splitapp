import { createBrowserClient } from '@supabase/ssr';
import { createClient as createPlainClient } from '@supabase/supabase-js';

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

/**
 * Supabase client for Client Components. Runs as the `authenticated` (or `anon`)
 * role. Uses the PKCE flow, which is what OAuth/social login will need.
 */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/**
 * Client used ONLY to request a magic-link email.
 *
 * Why this exists instead of reusing createClient(): @supabase/ssr hardcodes
 * flowType: 'pkce' and applies it *after* spreading caller-supplied auth options,
 * so PKCE cannot be turned off there. PKCE stores a code_verifier in the browser
 * that requested the link, and the emailed link must work when opened somewhere
 * else entirely — the Gmail app's in-app browser, or a different device. A link
 * tied to a verifier that browser never had fails with "code challenge does not
 * match previously saved code verifier".
 *
 * Sending the OTP through a plain client with no PKCE means no flow state is
 * attached to the token, so /auth/callback can complete sign-in with
 * verifyOtp({ token_hash, type }) from any browser.
 *
 * This client never holds a session: the callback route establishes it in
 * cookies, server-side.
 */
export function createMagicLinkClient() {
  return createPlainClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: 'implicit',
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
