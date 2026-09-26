import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/types/database';

/** Append to public.audit_log. Never throws: an audit failure must not roll back the user-facing action. */
export async function audit(e: { actorId: string | null; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown }) {
  try {
    await createAdminClient().from('audit_log').insert({
      actor_id: e.actorId, action: e.action, entity_type: e.entityType, entity_id: e.entityId,
      before: (e.before ?? null) as Json, after: (e.after ?? null) as Json,
    });
  } catch (err) {
    console.error('audit failed', e.action, err);
  }
}
