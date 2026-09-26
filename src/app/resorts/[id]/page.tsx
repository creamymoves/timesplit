import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ListingCard, LISTING_CARD_SELECT, toCard } from '@/components/ListingCard';
import { Empty } from '@/components/ui';

export default async function ResortPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: r } = await supabase.from('resorts').select('*').eq('id', params.id).maybeSingle();
  if (!r) notFound();
  const { data: listings } = await supabase
    .from('listings').select(LISTING_CARD_SELECT).eq('resort_id', r.id).eq('status', 'active').order('created_at', { ascending: false });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{r.name}</h1>
          <p className="muted">{r.brand ? `${r.brand} · ` : ''}{[r.address_line1, r.city, r.state, r.postal_code].filter(Boolean).join(', ')}</p>
        </div>
        {r.website_url ? <a className="btn secondary" href={r.website_url} target="_blank" rel="noreferrer">Resort website</a> : null}
      </div>
      <h2>Available units</h2>
      {listings?.length ? <div className="grid">{listings.map((l) => <ListingCard key={l.id} l={toCard(l)} />)}</div> : <Empty>No active listings at this resort yet.</Empty>}
    </>
  );
}
