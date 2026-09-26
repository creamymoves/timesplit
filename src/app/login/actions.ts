'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';

const schema = z.object({ email: z.string().email(), next: z.string().startsWith('/').default('/dashboard') });

export async function signInWithEmail(formData: FormData) {
  const parsed = schema.safeParse({ email: formData.get('email'), next: formData.get('next') });
  if (!parsed.success) redirect('/login?error=Invalid+email');
  const { email, next } = parsed.data;
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect('/login?sent=1');
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect('/');
}
