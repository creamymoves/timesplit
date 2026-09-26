import { NextResponse, type NextRequest } from 'next/server';
import { isAuthorizedCron } from '@/lib/cron';

/**
 * Every 10 minutes: expire 48h requests and release stale checkout holds
 * (public.expire_stale_bookings), then advance confirmed stays by date (public.advance_stays).
 * Body wired in the booking feature phase.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ ok: true, todo: 'call expire_stale_bookings() and advance_stays() via admin client' });
}
