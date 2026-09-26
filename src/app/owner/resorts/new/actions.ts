'use server';
import { z } from 'zod';
import { redirect } from 'next/navigation';
import { requireVerifiedOwner } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';
import { back, errMsg, str } from '@/lib/action';
import { US_STATES } from '@/lib/format';

const schema = z.object({
  name: z.string().min(2).max(160),
  brand: z.string().max(120),
  address_line1: z.string().max(200),
  city: z.string().min(1).max(120),
  state: z.enum(US_STATES),
  postal_code: z.string().max(10),
  website_url: z.string().url().or(z.literal('')),
});

export async function proposeResort(fd: FormData) {
  const { user } = await requireVerifiedOwner('/owner/resorts/new');
  const parsed = schema.safeParse(Object.fromEntries(['name','brand','address_line1','city','state','postal_code','website_url'].map((k) => [k, str(fd, k)])));
  if (!parsed.success) back('/owner/resorts/new', { error: 'Please check: ' + parsed.error.issues.map((i) => i.path.join('.')).join(', ') });
  const d = parsed.data;
  const supabase = createClient();
  const { data, error } = await supabase.from('resorts').insert({
    name: d.name, brand: d.brand || null, address_line1: d.address_line1 || null, city: d.city, state: d.state,
    postal_code: d.postal_code || null, website_url: d.website_url || null, is_verified: false, created_by: user.id,
  }).select('id').single();
  if (error) back('/owner/resorts/new', { error: errMsg(error) });
  redirect(`/resorts/${data.id}`);
}
