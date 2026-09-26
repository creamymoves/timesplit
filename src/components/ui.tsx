import type { ReactNode } from 'react';

export function Alert({ kind, children }: { kind?: 'error' | 'success'; children: ReactNode }) {
  return <div className={`alert ${kind ?? ''}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

const TONE: Record<string, string> = {
  approved: 'ok', active: 'ok', verified: 'ok', confirmed: 'ok', released: 'ok',
  pending_review: 'warn', in_progress: 'warn', submitted: 'warn', paused: 'warn', draft: '', held: 'warn',
  rejected: 'danger', removed_by_admin: 'danger', blocked: 'danger', declined: 'danger',
};
export function Badge({ value }: { value: string }) {
  return <span className={`badge ${TONE[value] ?? ''}`}>{value.replaceAll('_', ' ')}</span>;
}

/** Reads ?ok= / ?error= from a page's searchParams and renders a flash. */
export function Flash({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  if (searchParams.error) return <Alert kind="error">{searchParams.error}</Alert>;
  if (searchParams.ok) return <Alert kind="success">{searchParams.ok}</Alert>;
  return null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card muted">{children}</div>;
}
