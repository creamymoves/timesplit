import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { AppClaims } from '@/types/database';

const PROTECTED: Array<{ prefix: string; role?: 'owner' | 'admin' }> = [
  { prefix: '/dashboard' },
  { prefix: '/owner', role: 'owner' },
  { prefix: '/admin', role: 'admin' },
  { prefix: '/api/owner', role: 'owner' },
  { prefix: '/api/admin', role: 'admin' },
];

function claimsFrom(token: string | undefined): AppClaims {
  if (!token) return {};
  try {
    return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as AppClaims;
  } catch {
    return {};
  }
}

/**
 * Refreshes the Supabase session cookie on every request and does a cheap, claims-based
 * gate for role-scoped routes. This is UX only; authorisation is enforced by RLS.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const rule = PROTECTED.find((r) => request.nextUrl.pathname.startsWith(r.prefix));
  if (!rule) return response;

  if (!user) {
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  if (rule.role) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const roles = claimsFrom(session?.access_token).app_roles ?? [];
    if (!roles.includes(rule.role)) {
      if (request.nextUrl.pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard';
      url.searchParams.set('error', 'forbidden');
      return NextResponse.redirect(url);
    }
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
