import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Badge, Empty, Flash } from '@/components/ui';
import { shortDate } from '@/lib/format';
import { removeListing, restoreListing } from './actions';

export const metadata: Metadata = { title: 'Listings · Admin' };

export default async function AdminListings({ searchParams }: { searchParams: { ok?: string; error?: string; status?: string } }) {
  const supabase = createClient();
  let q = supabase.from('listings').select('id, title, status, created_at, admin_notes, resorts(name, state), profiles!listings_owner_id_fkey(full_name, email)').order('created_at', { ascending: false }).limit(200);
  if (searchParams.status) q = q.eq('status', searchParams.status as 'active');
  const { data: rows } = await q;
  return (
    <>
      <div className="page-head">
        <h1>Listings</h1>
        <div className="row small">
          <Link href="/admin/listings">All</Link><Link href="/admin/listings?status=active">Active</Link><Link href="/admin/listings?status=removed_by_admin">Removed</Link>
        </div>
      </div>
      <Flash searchParams={searchParams} />
      {rows?.length ? (
        <table className="table">
          <thead><tr><th>Listing</th><th>Owner</th><th>Status</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {rows.map((l) => {
              const r = Array.isArray(l.resorts) ? l.resorts[0] : l.resorts;
              const p = Array.isArray(l.profiles) ? l.profiles[0] : l.profiles;
              return (
                <tr key={l.id}>
                  <td><Link href={`/listings/${l.id}`}>{l.title}</Link><div className="muted small">{r ? `${r.name}, ${r.state}` : ''}</div></td>
                  <td>{p?.full_name ?? p?.email}</td>
                  <td><Badge value={l.status} />{l.admin_notes ? <div className="muted small">{l.admin_notes}</div> : null}</td>
                  <td className="muted small">{shortDate(l.created_at)}</td>
                  <td>
                    {l.status === 'removed_by_admin' ? (
                      <form action={restoreListing}><input type="hidden" name="id" value={l.id} /><button className="btn secondary sm" type="submit">Restore as paused</button></form>
                    ) : (
                      <form action={removeListing} className="row">
                        <input type="hidden" name="id" value={l.id} />
                        <input name="reason" placeholder="Reason" required style={{ maxWidth: 200 }} />
                        <button className="btn danger sm" type="submit">Remove</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <Empty>No listings.</Empty>}
    </>
  );
}
