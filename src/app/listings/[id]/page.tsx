import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/roles';
import { POLICY_LABEL, UNIT_LABEL } from '@/lib/format';
import { publicUrl } from '@/lib/storage';
import { Badge } from '@/components/ui';

export default async function ListingPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [{ data: l }, session] = await Promise.all([
    supabase.from('listings').select('*, resorts(*), listing_photos(storage_path, caption, sort_order)').eq('id', params.id).maybeSingle(),
    getSessionUser(),
  ]);
  if (!l) notFound();
  const resort = Array.isArray(l.resorts) ? l.resorts[0] : l.resorts;
  const photos = [...(l.listing_photos ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const { data: owner } = await supabase.from('public_profiles').select('full_name, avatar_path, owner_verification_status, created_at').eq('id', l.owner_id).maybeSingle();
  const isOwner = session?.user.id === l.owner_id;

  return (
    <>
      {l.status !== 'active' ? <div className="alert">This listing is <b>{l.status.replaceAll('_', ' ')}</b> and only visible to you.</div> : null}
      <div className="page-head">
        <div>
          <h1>{l.title}</h1>
          <p className="muted">
            {resort ? <Link href={`/resorts/${resort.id}`}>{resort.name}</Link> : null}
            {resort ? ` · ${resort.city}, ${resort.state}` : ''}
          </p>
        </div>
        {isOwner ? <Link className="btn secondary" href={`/owner/listings/${l.id}`}>Edit listing</Link> : null}
      </div>
      <div className="hero">{photos[0] ? <img src={publicUrl(photos[0].storage_path) ?? ''} alt={photos[0].caption ?? ''} /> : null}</div>
      {photos.length > 1 ? (
        <div className="photo-grid" style={{ marginTop: '.5rem' }}>
          {photos.slice(1).map((p) => <div className="photo" key={p.storage_path}><img src={publicUrl(p.storage_path) ?? ''} alt={p.caption ?? ''} /></div>)}
        </div>
      ) : null}
      <div className="split" style={{ marginTop: '1.5rem' }}>
        <div className="stack">
          <div className="card">
            <div className="row">
              <span>{UNIT_LABEL[l.unit_type]}</span><span>·</span>
              <span>{l.bedrooms} bd</span><span>·</span>
              <span>{l.bathrooms} ba</span><span>·</span>
              <span>Sleeps {l.sleeps}</span>
            </div>
          </div>
          {l.description ? <div className="card"><h2>About this unit</h2><p style={{ whiteSpace: 'pre-wrap' }}>{l.description}</p></div> : null}
          {l.amenities.length ? <div className="card"><h2>Amenities</h2><div className="row">{l.amenities.map((a) => <span className="badge" key={a}>{a}</span>)}</div></div> : null}
          {l.house_rules ? <div className="card"><h2>House rules</h2><p style={{ whiteSpace: 'pre-wrap' }}>{l.house_rules}</p></div> : null}
        </div>
        <div className="stack">
          <div className="card">
            <h2>Dates and pricing</h2>
            <p className="muted">Availability and booking requests open in the next release.</p>
            <p className="small">Cancellation policy: <b>{POLICY_LABEL[l.cancellation_policy]}</b></p>
          </div>
          <div className="card">
            <h2>Owner</h2>
            <div className="row">
              <div className="photo" style={{ width: 48, aspectRatio: '1', borderRadius: '50%' }}>
                {owner?.avatar_path ? <img src={publicUrl(owner.avatar_path) ?? ''} alt="" /> : null}
              </div>
              <div>
                <div>{owner?.full_name ?? 'Owner'}</div>
                {owner?.owner_verification_status === 'approved' ? <Badge value="verified" /> : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
