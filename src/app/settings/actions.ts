'use server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';
import { back, errMsg, str } from '@/lib/action';
import { US_STATES } from '@/lib/format';
import { IMAGE_TYPES, MAX_IMAGE_BYTES, extFor } from '@/lib/storage';

const schema = z.object({
  full_name: z.string().min(1).max(120),
  phone: z.string().max(30).optional().or(z.literal('')),
  us_state: z.enum(US_STATES).or(z.literal('')),
  terms: z.literal('on'),
});

export async function updateProfile(fd: FormData) {
  const { user } = await requireUser('/settings');
  const parsed = schema.safeParse({ full_name: str(fd, 'full_name'), phone: str(fd, 'phone'), us_state: str(fd, 'us_state'), terms: fd.get('terms') });
  if (!parsed.success) back('/settings', { error: 'Please check the form: ' + parsed.error.issues.map((i) => i.path.join('.')).join(', ') });
  const d = parsed.data;
  const supabase = createClient();
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: d.full_name, phone: d.phone || null, us_state: d.us_state || null, terms_accepted_at: new Date().toISOString() })
    .eq('id', user.id);
  if (error) back('/settings', { error: errMsg(error) });
  back('/settings', { ok: 'Profile saved' });
}

export async function uploadAvatar(fd: FormData) {
  const { user } = await requireUser('/settings');
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) back('/settings', { error: 'Choose an image' });
  if (!IMAGE_TYPES.includes(file.type)) back('/settings', { error: 'JPEG, PNG or WebP only' });
  if (file.size > MAX_IMAGE_BYTES) back('/settings', { error: 'Image is larger than 10 MB' });
  const key = `${user.id}/avatar-${Date.now()}.${extFor(file.type)}`;
  const supabase = createClient();
  const up = await supabase.storage.from('avatars').upload(key, file, { contentType: file.type, upsert: false });
  if (up.error) back('/settings', { error: errMsg(up.error) });
  const { error } = await supabase.from('profiles').update({ avatar_path: `avatars/${key}` }).eq('id', user.id);
  if (error) back('/settings', { error: errMsg(error) });
  back('/settings', { ok: 'Photo updated' });
}
