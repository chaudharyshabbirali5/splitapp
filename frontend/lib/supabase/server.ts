import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 *
 * Uses the anon key and reads the user's session from cookies, so every query still
 * runs as `authenticated` and is subject to RLS. This is deliberate: the service_role
 * key is never used by the app (TRD Section 3).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, which cannot set cookies. Safe to ignore
          // once session refresh is handled in middleware (step 3).
        }
      },
    },
  });
}
