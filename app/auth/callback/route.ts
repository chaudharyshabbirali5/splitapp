import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';

/**
 * Only allow redirects to a path on this site. Without this check, a crafted
 * ?next=https://evil.example would turn the login flow into an open redirect.
 */
function safeNext(raw: string | null): string {
  if (!raw) return '/groups';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/groups';
  return raw;
}

function failed(request: NextRequest, message: string) {
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?error=${encodeURIComponent(message)}`;
  return NextResponse.redirect(url);
}

function succeeded(request: NextRequest, next: string) {
  const url = request.nextUrl.clone();
  url.pathname = next;
  url.search = '';
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNext(searchParams.get('next'));

  const supabase = await createClient();

  // ---- Emailed magic link (token-hash flow) -------------------------------
  // Checked first: this is what the Magic Link email template now sends.
  // verifyOtp exchanges the hash for a session entirely server-side, so nothing
  // is required from the browser that originally requested the link. That is
  // what makes the link work from the Gmail app or a different device.
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return failed(request, error.message);
    return succeeded(request, next);
  }

  // ---- PKCE (?code) -------------------------------------------------------
  // Retained for OAuth / social login, which needs PKCE and always completes in
  // the same browser that started it. The emailed link no longer uses this path.
  const code = searchParams.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return failed(request, error.message);
    return succeeded(request, next);
  }

  // Supabase forwards its own failures as ?error_description=...
  const supabaseError = searchParams.get('error_description') ?? searchParams.get('error');
  return failed(request, supabaseError ?? 'That sign-in link is invalid or has expired.');
}
