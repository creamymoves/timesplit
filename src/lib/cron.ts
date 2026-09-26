import 'server-only';
import type { NextRequest } from 'next/server';

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Reject anything else. */
export function isAuthorizedCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}
