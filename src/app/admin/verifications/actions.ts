'use server';
import { requireRole } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { back, errMsg, str } from '@/lib/action';
import { notify } from '@/server/notifications';
import { audit } from '@/server/audit';

export async function reviewVerification(fd: FormData) {
  const { user } = await requireRole('admin', '/admin/verifications');
  const id = str(fd, 'id');
  const approve = str(fd, 'decision') === 'approve';
  const reason = str(fd, 'reason');
  const notes = str(fd, 'notes');
  if (!approve && !reason) back(`/admin/verifications/${id}`, { error: 'A reason is required to reject' });

  const supabase = createClient();
  // review_owner_verification() re-checks the admin role and the pending state in the database.
  const { data: v, error } = await supabase.rpc('review_owner_verification', { p_verification_id: id, p_approve: approve, p_reason: reason || undefined });
  if (error) back(`/admin/verifications/${id}`, { error: errMsg(error) });

  if (notes) await createAdminClient().from('owner_verifications').update({ admin_notes: notes }).eq('id', id);
  await audit({ actorId: user.id, action: approve ? 'verification.approve' : 'verification.reject', entityType: 'owner_verification', entityId: id, after: { reason } });
  await notify(v.owner_id, approve ? 'verification.approved' : 'verification.rejected', { reason });
  back('/admin/verifications', { ok: approve ? 'Owner approved' : 'Verification rejected' });
}
