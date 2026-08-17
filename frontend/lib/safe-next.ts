/**
 * Only allow redirects to a path on this site.
 *
 * Without this check a crafted ?next=https://evil.example would turn the login
 * and profile flows into an open redirect. A leading "//" is rejected too — the
 * browser reads //evil.example as protocol-relative and leaves the site.
 */
export function safeNext(raw: string | null | undefined, fallback = '/groups'): string {
  if (!raw) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
  return raw;
}
