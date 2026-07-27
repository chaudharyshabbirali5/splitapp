/**
 * Public Supabase config.
 *
 * Only NEXT_PUBLIC_* values belong here — they are inlined into the browser bundle.
 * The service_role key and the database URL are server-only and must never be read
 * from this module (see TRD Section 3).
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Add it to .env.local locally, and to the ` +
        `project's Environment Variables in Vercel before deploying.`,
    );
  }
  return value;
}

export const SUPABASE_URL = required(
  'NEXT_PUBLIC_SUPABASE_URL',
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);

export const SUPABASE_ANON_KEY = required(
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
