import type { Metadata } from 'next';
import { requireVerifiedOwner } from '@/lib/auth/roles';
import { Flash } from '@/components/ui';
import { US_STATES } from '@/lib/format';
import { proposeResort } from './actions';

export const metadata: Metadata = { title: 'Add a resort' };

export default async function NewResort({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireVerifiedOwner('/owner/resorts/new');
  return (
    <>
      <div className="page-head"><h1>Add a resort</h1></div>
      <p className="muted">Owner-submitted resorts are marked unverified until an admin checks them. You can list against it right away.</p>
      <Flash searchParams={searchParams} />
      <form action={proposeResort} className="card form">
        <label>Resort name <input name="name" required maxLength={160} /></label>
        <label>Brand <input name="brand" placeholder="Marriott Vacation Club, Hilton Grand Vacations, …" maxLength={120} /></label>
        <label>Address <input name="address_line1" maxLength={200} /></label>
        <div className="fields">
          <label>City <input name="city" required maxLength={120} /></label>
          <label>State
            <select name="state" required defaultValue="">
              <option value="" disabled>Select…</option>
              {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>ZIP <input name="postal_code" maxLength={10} /></label>
        </div>
        <label>Website <input name="website_url" type="url" placeholder="https://" /></label>
        <div className="row"><button className="btn" type="submit">Submit resort</button></div>
      </form>
    </>
  );
}
