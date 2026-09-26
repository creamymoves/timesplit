'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/roles';

/** Self-service opt-in to the owner role (public.become_owner). Verification is a separate gate. */
export async function becomeOwner() {
  await requireUser();
  const supabase = createClient();
  const { error } = await supabase.rpc('become_owner');
  if (error) throw new Error(error.message);
  revalidatePath('/dashboard');
}
