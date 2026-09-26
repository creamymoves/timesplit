import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { env, requireEnv } from '@/lib/env';

/**
 * Service-role client. BYPASSES RLS. Use only in webhooks, cron routes, and server code that has
 * already authorised the caller. Never import from a client component.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
