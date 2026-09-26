'use server';
import { requireRole } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';
import { back, errMsg, str } from '@/lib/action';
import { audit } from '@/server/audit';
import { notify } from '@/server/notifications';

const PATH = '/admin/listings';

export async function removeListing(fd: FormData) {
  const { user } = await requireRole('admin', PATH);
  const id = str(fd, 'id');
  const reason = str(fd, 'reason');
  if (!reason) back(PATH, { error: 'Reason required' });
  const supabase = createClient();
  const { data: l, error } = await supabase.from('listings').update({ status: 'removed_by_admin', admin_notes: reason }).eq('id', id).select('owner_id, title').single();
  if (error) back(PATH, { error: errMsg(error) });
  await audit({ actorId: user.id, action: 'listing.remove', entityType: 'listing', entityId: id, after: { reason } });
  await notify(l.owner_id, 'listing.removed', { title: l.title, reason, listingId: id });
  back(PATH, { ok: 'Listing removed' });
}

export async function restoreListing(fd: FormData) {
  const { user } = await requireRole('admin', PATH);
  const id = str(fd, 'id');
  const { error } = await createClient().from('listings').update({ status: 'paused', admin_notes: null }).eq('id', id);
  if (error) back(PATH, { error: errMsg(error) });
  await audit({ actorId: user.id, action: 'listing.restore', entityType: 'listing', entityId: id });
  back(PATH, { ok: 'Listing restored as paused' });
}
