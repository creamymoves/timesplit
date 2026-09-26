'use server';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';
import { back, errMsg, str } from '@/lib/action';
import { audit } from '@/server/audit';

const PATH = '/admin/users';

export async function setRole(fd: FormData) {
  const { user } = await requireRole('admin', PATH);
  const userId = z.string().uuid().safeParse(str(fd, 'user_id'));
  const role = z.enum(['owner', 'admin']).safeParse(str(fd, 'role'));
  if (!userId.success || !role.success) back(PATH, { error: 'Invalid request' });
  const grant = str(fd, 'grant') === '1';
  if (!grant && userId.data === user.id && role.data === 'admin') back(PATH, { error: 'You cannot revoke your own admin role' });
  const supabase = createClient();
  const { error } = grant
    ? await supabase.rpc('grant_role', { p_user_id: userId.data, p_role: role.data })
    : await supabase.rpc('revoke_role', { p_user_id: userId.data, p_role: role.data });
  if (error) back(PATH, { error: errMsg(error) });
  await audit({ actorId: user.id, action: grant ? 'role.grant' : 'role.revoke', entityType: 'user', entityId: userId.data, after: { role: role.data } });
  back(PATH, { ok: `${grant ? 'Granted' : 'Revoked'} ${role.data}` });
}
