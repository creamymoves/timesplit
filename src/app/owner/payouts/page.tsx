import type { Metadata } from 'next';
import { requireRole } from '@/lib/auth/roles';

export const metadata: Metadata = { title: 'Payouts' };

export default async function OwnerPayouts() {
  await requireRole('owner');
  return (
    <>
      <div className="page-head"><h1>Payouts</h1></div>
      <div className="card">
        <p>Stripe onboarding, held and released payouts, and resort confirmation uploads land with the payments release.</p>
        <p className="muted small">See docs/money-flow.md for how the hold and release works.</p>
      </div>
    </>
  );
}
