import 'server-only';
import { Resend } from 'resend';
import { env, requireEnv } from '@/lib/env';

let _resend: Resend | undefined;

export function resend(): Resend {
  _resend ??= new Resend(requireEnv('RESEND_API_KEY'));
  return _resend;
}

export async function sendEmail(opts: { to: string; subject: string; html: string; text?: string }) {
  const { data, error } = await resend().emails.send({ from: env.EMAIL_FROM, ...opts });
  if (error) throw new Error(`Resend: ${error.message}`);
  return data?.id ?? null;
}
