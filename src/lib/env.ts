import { z } from 'zod';

const server = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_CONNECT_WEBHOOK_SECRET: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().default('Timesplit <no-reply@example.com>'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
});

/** Validated at first import on the server. Optional keys are only required by the features that use them. */
export const env = server.parse(process.env);

export function requireEnv<K extends keyof typeof env>(key: K): NonNullable<(typeof env)[K]> {
  const v = env[key];
  if (v === undefined || v === null) throw new Error(`Missing required env var ${key}`);
  return v as NonNullable<(typeof env)[K]>;
}
