import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email';
import { inAppCopy, templates, type NotificationType } from '@/server/email/templates';
import type { Json } from '@/types/database';

/**
 * Record an in-app notification and send the matching email through Resend.
 * Email failures are logged, never thrown: the in-app row is the source of truth and
 * a retry job can pick up rows with emailed_at IS NULL.
 */
export async function notify<T extends NotificationType>(userId: string, type: T, data: Parameters<(typeof templates)[T]>[0] extends undefined ? Record<string, never> : NonNullable<Parameters<(typeof templates)[T]>[0]>) {
  const admin = createAdminClient();
  const copy = inAppCopy(type, data as Record<string, unknown>);
  const { data: row, error } = await admin.from('notifications')
    .insert({ user_id: userId, type, title: copy.title, body: copy.body, data: data as Json, channels: ['in_app', 'email'] })
    .select('id').single();
  if (error) { console.error('notify insert failed', type, error.message); return; }

  if (!process.env.RESEND_API_KEY) return;   // local dev without email configured
  const { data: profile } = await admin.from('profiles').select('email').eq('id', userId).maybeSingle();
  if (!profile?.email) return;
  try {
    const email = (templates[type] as (d: unknown) => ReturnType<(typeof templates)[T]>)(data);
    const id = await sendEmail({ to: profile.email, ...email });
    await admin.from('notifications').update({ emailed_at: new Date().toISOString(), email_provider_id: id }).eq('id', row.id);
  } catch (e) {
    console.error('notify email failed', type, e);
  }
}
