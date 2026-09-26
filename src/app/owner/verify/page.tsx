import type { Metadata } from 'next';
import { requireRole } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';
import { Badge, Flash } from '@/components/ui';
import { shortDate } from '@/lib/format';
import { startVerification, uploadOwnershipDoc } from './actions';

export const metadata: Metadata = { title: 'Owner verification' };

const DOC_TYPES = ['Deed or ownership certificate', 'Points statement', 'Maintenance fee bill', 'Resort account screenshot', 'Other'];

export default async function OwnerVerifyPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const { user, ownerStatus } = await requireRole('owner', '/owner/verify');
  const supabase = createClient();
  const [{ data: attempts }, { data: resorts }] = await Promise.all([
    supabase.from('owner_verifications').select('*, resorts(name)').eq('owner_id', user.id).order('created_at', { ascending: false }),
    supabase.from('resorts').select('id, name, state').order('name'),
  ]);
  const open = attempts?.find((a) => a.status === 'in_progress' || a.status === 'pending_review');
  const openResort = open && (Array.isArray(open.resorts) ? open.resorts[0] : open.resorts);

  return (
    <>
      <div className="page-head"><div><h1>Owner verification</h1><Badge value={ownerStatus} /></div></div>
      <Flash searchParams={searchParams} />
      <p className="muted">
        We verify every owner before their listings go live: proof that you own the timeshare, an identity check, and a quick review by our team.
      </p>

      {ownerStatus === 'approved' ? (
        <div className="alert success">You&apos;re verified. Your listings can be published.</div>
      ) : !open ? (
        <form action={startVerification} className="card form">
          <h2>Step 1 · Start</h2>
          {attempts?.some((a) => a.status === 'rejected') ? (
            <div className="alert error">Your last attempt was rejected: {attempts.find((a) => a.status === 'rejected')?.rejection_reason}</div>
          ) : null}
          <p className="small">You&apos;ll upload one ownership document and complete an identity check. Most reviews finish within two business days.</p>
          <div className="row"><button className="btn" type="submit">Begin verification</button></div>
        </form>
      ) : (
        <div className="stack">
          <div className="card stack">
            <h2>Step 1 · Ownership document <Badge value={open.ownership_doc_path ? 'submitted' : 'missing'} /></h2>
            {open.ownership_doc_path ? (
              <p className="small">Uploaded {open.ownership_doc_uploaded_at ? shortDate(open.ownership_doc_uploaded_at) : ''} · {open.ownership_doc_type}{openResort ? ` · ${openResort.name}` : ''}</p>
            ) : null}
            {open.status === 'in_progress' ? (
              <form action={uploadOwnershipDoc} className="form">
                <input type="hidden" name="verification_id" value={open.id} />
                <div className="fields">
                  <label>Document type
                    <select name="doc_type" defaultValue={open.ownership_doc_type ?? DOC_TYPES[0]}>{DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                  </label>
                  <label>Resort
                    <select name="resort_id" defaultValue={open.resort_id ?? ''}>
                      <option value="">Select…</option>
                      {resorts?.map((r) => <option key={r.id} value={r.id}>{r.name}, {r.state}</option>)}
                    </select>
                  </label>
                </div>
                <label>File (PDF, JPEG or PNG, up to 25 MB) <input type="file" name="file" accept="application/pdf,image/jpeg,image/png" required /></label>
                <div className="row"><button className="btn secondary" type="submit">{open.ownership_doc_path ? 'Replace document' : 'Upload document'}</button></div>
              </form>
            ) : null}
          </div>
          <div className="card">
            <h2>Step 2 · Identity check <Badge value={open.identity_status} /></h2>
            <p className="small muted">Stripe Identity (government ID plus selfie). This step is enabled with the payments release; you&apos;ll get an email when it&apos;s ready.</p>
            <button className="btn secondary" disabled>Start identity check</button>
          </div>
          <div className="card">
            <h2>Step 3 · Review <Badge value={open.status} /></h2>
            {open.status === 'pending_review' ? (
              <p className="small">Submitted {open.submitted_at ? shortDate(open.submitted_at) : ''}. We&apos;ll email you when the review is done.</p>
            ) : (
              <p className="small muted">Submission unlocks when steps 1 and 2 are complete.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
