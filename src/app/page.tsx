import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ListingCard, LISTING_CARD_SELECT, toCard } from '@/components/ListingCard';

export default async function Home() {
  const supabase = createClient();
  const { data: rows } = await supabase.from('listings').select(LISTING_CARD_SELECT).eq('status', 'active').order('created_at', { ascending: false }).limit(6);
  return (
    <>
      <section className="card" style={{ padding: '2.5rem 1.5rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '2.2rem' }}>Resort weeks, direct from the owners</h1>
        <p className="muted" style={{ maxWidth: 560, margin: '0 auto 1.25rem' }}>
          Every owner is identity-checked and has proven they own their timeshare. You pay only when the owner accepts, and owners are paid only after you check in.
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link className="btn" href="/listings">Browse listings</Link>
          <Link className="btn secondary" href="/dashboard">List your week</Link>
        </div>
      </section>
      {rows?.length ? (
        <section style={{ marginTop: '2rem' }}>
          <div className="page-head"><h2>Recently listed</h2><Link href="/listings">See all</Link></div>
          <div className="grid">{rows.map((l) => <ListingCard key={l.id} l={toCard(l)} />)}</div>
        </section>
      ) : null}
      <section className="grid" style={{ marginTop: '2rem' }}>
        {[
          ['Request to book', 'Send a request. The owner has 48 hours to accept. Your card is charged only on acceptance.'],
          ['Verified owners', 'Ownership documents plus a government ID check, reviewed by our team before anything goes live.'],
          ['Protected payouts', 'Owners are paid after check-in and after the resort confirmation in your name is on file.'],
        ].map(([t, b]) => <div className="card" key={t}><h3>{t}</h3><p className="muted small">{b}</p></div>)}
      </section>
    </>
  );
}
