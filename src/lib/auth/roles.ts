import 'server-only';
import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import type { AppClaims, AppRole, OwnerVerificationStatus } from '@/types/database';

export interface SessionUser {
  user: User;
  roles: AppRole[];
  ownerStatus: OwnerVerificationStatus;
}

function decodeClaims(accessToken: string): AppClaims {
  try {
    const payload = accessToken.split('.')[1] ?? '';
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AppClaims;
  } catch {
    return {};
  }
}

/**
 * Current user with roles from the JWT (set by custom_access_token_hook). Claims are a UI hint
 * only: the database re-checks user_roles in RLS and in every SECURITY DEFINER function.
 * Falls back to querying user_roles when the hook is not enabled (e.g. fresh local stack).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const claims = session ? decodeClaims(session.access_token) : {};

  let roles = claims.app_roles;
  let ownerStatus = claims.owner_status;
  if (!roles || !ownerStatus) {
    const [{ data: roleRows }, { data: profile }] = await Promise.all([
      supabase.from('user_roles').select('role').eq('user_id', user.id),
      supabase.from('profiles').select('owner_verification_status').eq('id', user.id).maybeSingle(),
    ]);
    roles = roles ?? ((roleRows ?? []) as Array<{ role: AppRole }>).map((r) => r.role);
    ownerStatus =
      ownerStatus ??
      ((profile as { owner_verification_status: OwnerVerificationStatus } | null)?.owner_verification_status ??
        'not_started');
  }
  return { user, roles, ownerStatus: ownerStatus ?? 'not_started' };
}

export async function requireUser(next = '/dashboard'): Promise<SessionUser> {
  const s = await getSessionUser();
  if (!s) redirect(`/login?next=${encodeURIComponent(next)}`);
  return s;
}

export async function requireRole(role: AppRole, next?: string): Promise<SessionUser> {
  const s = await requireUser(next);
  if (!s.roles.includes(role)) redirect('/dashboard?error=forbidden');
  return s;
}

/** Owners may browse their dashboard unverified, but anything that publishes or gets paid needs this. */
export async function requireVerifiedOwner(next?: string): Promise<SessionUser> {
  const s = await requireRole('owner', next);
  if (s.ownerStatus !== 'approved') redirect('/owner/verify');
  return s;
}

export const hasRole = (s: SessionUser | null, role: AppRole) => !!s && s.roles.includes(role);
