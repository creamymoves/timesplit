'use server';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';
import { back, errMsg, str } from '@/lib/action';
import { US_STATES } from '@/lib/format';
import { audit } from '@/server/audit';

const PATH = '/admin/resorts';

export async function createResort(fd: FormData) {
  const { user } = await requireRole('admin', PATH);
  const schema = z.object({ name: z.string().min(2), brand: z.string(), city: z.string().min(1), state: z.enum(US_STATES), timezone: z.string().min(3), website_url: z.string().url().or(z.literal('')) });
  const parsed = schema.safeParse(Object.fromEntries(['name','brand','city','state','timezone','website_url'].map((k) => [k, str(fd, k)])));
  if (!parsed.success) back(PATH, { error: 'Please check the resort form' });
  const d = parsed.data;
  const { data, error } = await createClient().from('resorts').insert({
    name: d.name, brand: d.brand || null, city: d.city, state: d.state, timezone: d.timezone, website_url: d.website_url || null, is_verified: true, created_by: user.id,
  }).select('id').single();
  if (error) back(PATH, { error: errMsg(error) });
  await audit({ actorId: user.id, action: 'resort.create', entityType: 'resort', entityId: data.id, after: d });
  back(PATH, { ok: `Added ${d.name}` });
}

export async function setResortVerified(fd: FormData) {
  const { user } = await requireRole('admin', PATH);
  const id = str(fd, 'id');
  const verified = str(fd, 'verified') === '1';
  const { error } = await createClient().from('resorts').update({ is_verified: verified }).eq('id', id);
  if (error) back(PATH, { error: errMsg(error) });
  await audit({ actorId: user.id, action: verified ? 'resort.verify' : 'resort.unverify', entityType: 'resort', entityId: id });
  back(PATH, { ok: verified ? 'Resort verified' : 'Resort marked unverified' });
}
