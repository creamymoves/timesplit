import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { ListingCard, LISTING_CARD_SELECT, toCard } from '@/components/ListingCard';
import { Empty } from '@/components/ui';
import { UNIT_LABEL, UNIT_TYPES, US_STATES } from '@/lib/format';
import type { Enums } from '@/types/database';

export const metadata: Metadata = { title: 'Browse listings' };

export default async function ListingsPage({ searchParams }: { searchParams: { state?: string; unit?: string; sleeps?: string; q?: string } }) {
  const supabase = createClient();
  let query = supabase.from('listings').select(`${LISTING_CARD_SELECT}, resorts!inner(state, name)`).eq('status', 'active').order('created_at', { ascending: false }).limit(60);
  if (searchParams.state) query = query.eq('resorts.state', searchParams.state);
  if (searchParams.unit && (UNIT_TYPES as readonly string[]).includes(searchParams.unit)) query = query.eq('unit_type', searchParams.unit as Enums<'unit_type'>);
  if (searchParams.sleeps && Number(searchParams.sleeps) > 0) query = query.gte('sleeps', Number(searchParams.sleeps));
  if (searchParams.q) query = query.or(`title.ilike.%${searchParams.q}%,resorts.name.ilike.%${searchParams.q}%`);
  const { data: rows } = await query;

  return (
    <>
      <div className="page-head"><h1>Browse listings</h1></div>
      <form className="card row" method="get">
        <input name="q" placeholder="Resort or title" defaultValue={searchParams.q ?? ''} style={{ maxWidth: 260 }} />
        <select name="state" defaultValue={searchParams.state ?? ''} style={{ maxWidth: 130 }}>
          <option value="">Any state</option>
          {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select name="unit" defaultValue={searchParams.unit ?? ''} style={{ maxWidth: 170 }}>
          <option value="">Any unit</option>
          {UNIT_TYPES.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
        </select>
        <input name="sleeps" type="number" min={1} max={30} placeholder="Sleeps" defaultValue={searchParams.sleeps ?? ''} style={{ maxWidth: 110 }} />
        <button className="btn secondary" type="submit">Filter</button>
      </form>
      <div style={{ height: '1rem' }} />
      {rows?.length ? <div className="grid">{rows.map((l) => <ListingCard key={l.id} l={toCard(l)} />)}</div> : <Empty>No listings match those filters.</Empty>}
    </>
  );
}
