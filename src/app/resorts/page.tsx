import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { US_STATES } from '@/lib/format';
import { Empty } from '@/components/ui';

export const metadata: Metadata = { title: 'Resorts' };

export default async function ResortsPage({ searchParams }: { searchParams: { q?: string; state?: string } }) {
  const supabase = createClient();
  let query = supabase.from('resorts').select('id, name, brand, city, state, is_verified').order('name').limit(100);
  if (searchParams.q) query = query.ilike('name', `%${searchParams.q}%`);
  if (searchParams.state) query = query.eq('state', searchParams.state);
  const { data: resorts } = await query;

  return (
    <>
      <div className="page-head"><h1>Resorts</h1></div>
      <form className="card row" method="get">
        <input name="q" placeholder="Search by name" defaultValue={searchParams.q ?? ''} style={{ maxWidth: 320 }} />
        <select name="state" defaultValue={searchParams.state ?? ''} style={{ maxWidth: 140 }}>
          <option value="">Any state</option>
          {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn secondary" type="submit">Search</button>
      </form>
      <div style={{ height: '1rem' }} />
      {resorts?.length ? (
        <table className="table">
          <thead><tr><th>Resort</th><th>Brand</th><th>Location</th><th></th></tr></thead>
          <tbody>
            {resorts.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/resorts/${r.id}`}>{r.name}</Link></td>
                <td>{r.brand ?? '—'}</td>
                <td>{r.city}, {r.state}</td>
                <td className="small muted">{r.is_verified ? 'Verified' : 'Owner-submitted'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>No resorts match.</Empty>
      )}
    </>
  );
}
