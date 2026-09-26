import type { Metadata } from 'next';
import Link from 'next/link';
import { requireRole } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';
import { Badge, Empty, Flash } from '@/components/ui';
import { UNIT_LABEL, shortDate } from '@/lib/format';

export const metadata: Metadata = { title: 'My listings' };

export default async function OwnerListings({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const { user, ownerStatus } = await requireRole('owner');
  const supabase = createClient();
  const { data: rows } = await supabase
    .from('listings').select('id, title, status, unit_type, sleeps, updated_at, resorts(name, state)')
    .eq('owner_id', user.id).neq('status', 'archived').order('updated_at', { ascending: false });

  return (
    <>
      <div className="page-head">
        <h1>My listings</h1>
        <Link className="btn" href="/owner/listings/new">New listing</Link>
      </div>
      <Flash searchParams={searchParams} />
      {ownerStatus !== 'approved' ? (
        <div className="alert">You can draft listings now. Publishing unlocks once your <Link href="/owner/verify">owner verification</Link> is approved.</div>
      ) : null}
      <div style={{ height: '1rem' }} />
      {rows?.length ? (
        <table className="table">
          <thead><tr><th>Title</th><th>Resort</th><th>Unit</th><th>Status</th><th>Updated</th></tr></thead>
          <tbody>
            {rows.map((l) => {
              const r = Array.isArray(l.resorts) ? l.resorts[0] : l.resorts;
              return (
                <tr key={l.id}>
                  <td><Link href={`/owner/listings/${l.id}`}>{l.title}</Link></td>
                  <td>{r ? `${r.name}, ${r.state}` : '—'}</td>
                  <td>{UNIT_LABEL[l.unit_type]} · sleeps {l.sleeps}</td>
                  <td><Badge value={l.status} /></td>
                  <td className="muted small">{shortDate(l.updated_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <Empty>No listings yet. Create your first one.</Empty>
      )}
    </>
  );
}
