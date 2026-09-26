import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Badge, Flash } from '@/components/ui';
import { shortDate } from '@/lib/format';
import { splitPath } from '@/lib/storage';
import { reviewVerification } from '../actions';

export default async function VerificationDetail({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  const supabase = createClient();
  const { data: v } = await supabase.from('owner_verifications')
    .select('*, profiles!owner_verifications_owner_id_fkey(id, full_name, email, phone, us_state, created_at), resorts(name, city, state)')
    .eq('id', params.id).maybeSingle();
  if (!v) notFound();
  const p = Array.isArray(v.profiles) ? v.profiles[0] : v.profiles;
  const r = Array.isArray(v.resorts) ? v.resorts[0] : v.resorts;
  let docUrl: string | null = null;
  if (v.ownership_doc_path) {
    const { bucket, key } = splitPath(v.ownership_doc_path);
    const { data } = await supabase.storage.from(bucket).createSignedUrl(key, 600);   // 10-minute link; RLS lets admins read
    docUrl = data?.signedUrl ?? null;
  }
  const { data: listings } = await supabase.from('listings').select('id, title, status').eq('owner_id', v.owner_id);

  return (
    <>
      <div className="page-head"><div><h1>{p?.full_name ?? p?.email}</h1><Badge value={v.status} /></div></div>
      <Flash searchParams={searchParams} />
      <div className="split">
        <div className="stack">
          <div className="card">
            <h2>Ownership document</h2>
            <p className="small">{v.ownership_doc_type ?? 'Not uploaded'}{r ? ` · ${r.name}, ${r.city}, ${r.state}` : ''}{v.ownership_doc_uploaded_at ? ` · uploaded ${shortDate(v.ownership_doc_uploaded_at)}` : ''}</p>
            {docUrl ? <a className="btn secondary" href={docUrl} target="_blank" rel="noreferrer">Open document</a> : <p className="muted">No document.</p>}
          </div>
          <div className="card">
            <h2>Identity <Badge value={v.identity_status} /></h2>
            <p className="small muted">{v.stripe_identity_session_id ? `Stripe session ${v.stripe_identity_session_id}` : 'Stripe Identity not started (enabled with the payments release).'}</p>
          </div>
          {v.status === 'pending_review' ? (
            <form action={reviewVerification} className="card form">
              <input type="hidden" name="id" value={v.id} />
              <h2>Decision</h2>
              <label>Reason (required for rejection, shown to the owner) <textarea name="reason" maxLength={1000} /></label>
              <label>Internal notes <textarea name="notes" maxLength={2000} defaultValue={v.admin_notes ?? ''} /></label>
              <div className="row">
                <button className="btn" type="submit" name="decision" value="approve">Approve</button>
                <button className="btn danger" type="submit" name="decision" value="reject">Reject</button>
              </div>
            </form>
          ) : v.reviewed_at ? (
            <div className="card"><h2>Decision</h2><p className="small">{v.status} on {shortDate(v.reviewed_at)}{v.rejection_reason ? ` · ${v.rejection_reason}` : ''}</p>{v.admin_notes ? <p className="small muted">{v.admin_notes}</p> : null}</div>
          ) : null}
        </div>
        <div className="stack">
          <div className="card">
            <h2>Owner</h2>
            <p className="small">{p?.email}<br />{p?.phone ?? 'no phone'} · {p?.us_state ?? 'no state'}<br />Joined {p ? shortDate(p.created_at) : ''}</p>
          </div>
          <div className="card">
            <h2>Listings</h2>
            {listings?.length ? <ul className="small">{listings.map((l) => <li key={l.id}><a href={`/listings/${l.id}`}>{l.title}</a> <Badge value={l.status} /></li>)}</ul> : <p className="muted small">None yet.</p>}
          </div>
        </div>
      </div>
    </>
  );
}
