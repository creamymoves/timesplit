import 'server-only';
import Stripe from 'stripe';
import { requireEnv } from '@/lib/env';

let _stripe: Stripe | undefined;

/** Platform Stripe client. Connected-account calls pass `{ stripeAccount }` per request. */
export function stripe(): Stripe {
  _stripe ??= new Stripe(requireEnv('STRIPE_SECRET_KEY'), {
    apiVersion: '2025-02-24.acacia',
    typescript: true,
    appInfo: { name: 'timesplit', version: '0.1.0' },
  });
  return _stripe;
}
