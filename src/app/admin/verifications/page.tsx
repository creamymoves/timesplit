import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Badge, Empty, Flash } from '@/components/ui';
import { relTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Verification queue' };

export default async function VerificationQueue({ searchParams }: { searchParams: { ok?: string; error?: string; all?: string } }) {
  const supabase = createClient();
  let q = supabase.from('owner_verifications').select('id, status, submitted_at, created_at, identity_status, ownership_doc_type, profiles!owner_verifications_owner_id_fkey(full_name, email), resorts(name)')
    .order('submitted_at', { ascending: true, nullsFirst: false }).limit(100);
  if (!searchParams.all) q = q.eq('status', 'pending_review');
  const { data: rows, error } = await q;
  return (
    <>
      <div className="page-head">
        <h1>Verification queue</h1>
        <Link className="btn secondary sm" href={searchParams.all ? '/admin/verifications' : '/admin/verifications?all=1'}>{searchParams.all ? 'Pending only' : 'Show all'}</Link>
      </div>
      <Flash searchParams={searchParams} />
      {error ? <div className="alert error">{error.message}</div> : null}
      {rows?.length ? (
        <table className="table">
          <thead><tr><th>Owner</th><th>Resort</th><th>Document</th><th>Identity</th><th>Status</th><th>Submitted</th></tr></thead>
          <tbody>
            {rows.map((v) => {
              const p = Array.isArray(v.profiles) ? v.profiles[0] : v.profiles;
              const r = Array.isArray(v.resorts) ? v.resorts[0] : v.resorts;
              return (
                <tr key={v.id}>
                  <td><Link href={`/admin/verifications/${v.id}`}>{p?.full_name ?? p?.email ?? 'Unknown'}</Link><div className="muted small">{p?.email}</div></td>
                  <td>{r?.name ?? '—'}</td>
                  <td>{v.ownership_doc_type ?? '—'}</td>
                  <td><Badge value={v.identity_status} /></td>
                  <td><Badge value={v.status} /></td>
                  <td className="muted small">{v.submitted_at ? relTime(v.submitted_at) : relTime(v.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <Empty>Queue is empty.</Empty>}
    </>
  );
}
