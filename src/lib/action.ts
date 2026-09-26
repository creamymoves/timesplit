import 'server-only';
import { redirect } from 'next/navigation';

/** Redirect back to a page with a flash message in the query string. */
export function back(path: string, msg: { ok?: string; error?: string }): never {
  const p = new URLSearchParams();
  if (msg.ok) p.set('ok', msg.ok);
  if (msg.error) p.set('error', msg.error);
  redirect(`${path}?${p.toString()}`);
}

/** Turn a thrown error or Supabase error into a user-facing string. */
export function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return 'Something went wrong';
}

export const str = (fd: FormData, k: string) => (fd.get(k)?.toString() ?? '').trim();
export const num = (fd: FormData, k: string) => Number(fd.get(k) ?? NaN);
