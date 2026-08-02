import type { NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own assets and static files. Auth cookies need
     * refreshing on real page requests, not on every image fetch.
     *
     * manifest.webmanifest, sw.js and offline.html MUST be excluded. They are
     * fetched by the browser itself, without cookies, so running them through
     * the auth check redirects them to /login — and a manifest or service
     * worker that answers with HTML makes the app fail installability with no
     * obvious error.
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw\\.js|offline\\.html|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)',
  ],
};
