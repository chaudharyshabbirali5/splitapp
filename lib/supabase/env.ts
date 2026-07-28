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

/**
 * Absolute origin of this deployment, used to build the magic-link redirect.
 *
 * Order matters. NEXT_PUBLIC_SITE_URL wins so a custom domain can be pinned;
 * NEXT_PUBLIC_VERCEL_URL covers preview deployments automatically; falling back
 * to window.location.origin keeps the link correct even if neither is set, which
 * is why a forgotten env var on Vercel degrades instead of emailing localhost links.
 */
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  const vercel = process.env.NEXT_PUBLIC_VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  if (typeof window !== 'undefined') return window.location.origin;

  return 'http://localhost:3000';
}
