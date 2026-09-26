import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Empty, Flash } from '@/components/ui';
import { US_STATES } from '@/lib/format';
import { createResort, setResortVerified } from './actions';

export const metadata: Metadata = { title: 'Resorts · Admin' };

export default async function AdminResorts({ searchParams }: { searchParams: { ok?: string; error?: string; verified?: string } }) {
  const supabase = createClient();
  let q = supabase.from('resorts').select('id, name, brand, city, state, is_verified, created_at, created_by').order('is_verified').order('name').limit(200);
  if (searchParams.verified === '0') q = q.eq('is_verified', false);
  const { data: rows } = await q;
  return (
    <>
      <div className="page-head"><h1>Resorts</h1></div>
      <Flash searchParams={searchParams} />
      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Add a resort</summary>
        <form action={createResort} className="form" style={{ marginTop: '1rem' }}>
          <div className="fields">
            <label>Name <input name="name" required /></label>
            <label>Brand <input name="brand" /></label>
            <label>City <input name="city" required /></label>
            <label>State <select name="state" required defaultValue=""><option value="" disabled>…</option>{US_STATES.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label>Timezone <input name="timezone" defaultValue="America/New_York" /></label>
            <label>Website <input name="website_url" type="url" /></label>
          </div>
          <div className="row"><button className="btn" type="submit">Create verified resort</button></div>
        </form>
      </details>
      <div style={{ height: '1rem' }} />
      {rows?.length ? (
        <table className="table">
          <thead><tr><th>Resort</th><th>Location</th><th>Verified</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/resorts/${r.id}`}>{r.name}</Link>{r.brand ? <div className="muted small">{r.brand}</div> : null}</td>
                <td>{r.city}, {r.state}</td>
                <td>{r.is_verified ? 'Yes' : <span className="badge warn">owner-submitted</span>}</td>
                <td>
                  <form action={setResortVerified}>
                    <input type="hidden" name="id" value={r.id} /><input type="hidden" name="verified" value={r.is_verified ? '0' : '1'} />
                    <button className="btn secondary sm" type="submit">{r.is_verified ? 'Unverify' : 'Mark verified'}</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <Empty>No resorts.</Empty>}
    </>
  );
}
