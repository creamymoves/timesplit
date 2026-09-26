import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireRole } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';
import { ListingFields } from '@/components/ListingForm';
import { Badge, Flash } from '@/components/ui';
import { publicUrl } from '@/lib/storage';
import { deletePhoto, setListingStatus, updateListing, uploadPhoto } from '../actions';

export default async function EditListing({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  const { user, ownerStatus } = await requireRole('owner');
  const supabase = createClient();
  const [{ data: l }, { data: resorts }] = await Promise.all([
    supabase.from('listings').select('*, listing_photos(id, storage_path, caption, sort_order)').eq('id', params.id).eq('owner_id', user.id).maybeSingle(),
    supabase.from('resorts').select('id, name, city, state').order('name'),
  ]);
  if (!l) notFound();
  const photos = [...(l.listing_photos ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const canPublish = ownerStatus === 'approved' && photos.length > 0 && l.status !== 'removed_by_admin';

  return (
    <>
      <div className="page-head">
        <div><h1>{l.title}</h1><Badge value={l.status} /></div>
        <div className="row">
          <Link className="btn secondary" href={`/listings/${l.id}`}>Preview</Link>
          {l.status === 'active' ? (
            <form action={setListingStatus}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="status" value="paused" /><button className="btn secondary" type="submit">Pause</button></form>
          ) : (
            <form action={setListingStatus}>
              <input type="hidden" name="id" value={l.id} /><input type="hidden" name="status" value="active" />
              <button className="btn" type="submit" disabled={!canPublish} title={canPublish ? '' : 'Needs approved verification and at least one photo'}>Publish</button>
            </form>
          )}
        </div>
      </div>
      <Flash searchParams={searchParams} />
      {l.status === 'removed_by_admin' ? <div className="alert error">This listing was removed by an admin. {l.admin_notes}</div> : null}
      {!canPublish && l.status !== 'active' ? (
        <div className="alert">
          To publish: {ownerStatus !== 'approved' ? <>complete <Link href="/owner/verify">owner verification</Link></> : null}
          {ownerStatus !== 'approved' && photos.length === 0 ? ' and ' : ''}
          {photos.length === 0 ? 'add at least one photo' : ''}.
        </div>
      ) : null}
      <div className="split" style={{ marginTop: '1rem' }}>
        <form action={updateListing} className="card form">
          <input type="hidden" name="id" value={l.id} />
          <ListingFields l={l} resorts={resorts ?? []} />
          <div className="row"><button className="btn" type="submit">Save changes</button></div>
        </form>
        <div className="stack">
          <div className="card stack">
            <h2>Photos</h2>
            <div className="photo-grid">
              {photos.map((p) => (
                <div className="photo" key={p.id}>
                  <img src={publicUrl(p.storage_path) ?? ''} alt={p.caption ?? ''} />
                  <form action={deletePhoto}>
                    <input type="hidden" name="listing_id" value={l.id} /><input type="hidden" name="photo_id" value={p.id} />
                    <button className="btn danger sm" type="submit" aria-label="Delete photo">×</button>
                  </form>
                </div>
              ))}
            </div>
            <form action={uploadPhoto} className="form">
              <input type="hidden" name="listing_id" value={l.id} />
              <label>Add photo <input type="file" name="file" accept="image/jpeg,image/png,image/webp" required /></label>
              <label>Caption <input name="caption" maxLength={140} /></label>
              <div className="row"><button className="btn secondary" type="submit">Upload</button></div>
            </form>
          </div>
          <div className="card">
            <h2>Dates and pricing</h2>
            <p className="muted small">Availability windows and nightly rates arrive in the next release.</p>
          </div>
          {l.status === 'draft' ? (
            <form action={setListingStatus} className="card">
              <input type="hidden" name="id" value={l.id} /><input type="hidden" name="status" value="archived" />
              <button className="btn danger sm" type="submit">Archive draft</button>
            </form>
          ) : null}
        </div>
      </div>
    </>
  );
}
