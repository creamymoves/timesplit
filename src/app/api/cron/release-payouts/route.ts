import { NextResponse, type NextRequest } from 'next/server';
import { isAuthorizedCron } from '@/lib/cron';

/**
 * Hourly: public.mark_payouts_releasable() then one Stripe transfer per row
 * (see docs/money-flow.md §4). Body wired in the payments feature phase.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ ok: true, todo: 'mark_payouts_releasable() -> stripe.transfers.create -> mark_payout_released()' });
}
