'use server';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';

export async function markAllRead() {
  const { user } = await requireUser('/notifications');
  await createClient().from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', user.id).is('read_at', null);
  revalidatePath('/notifications');
}
