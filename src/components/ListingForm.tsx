import { AMENITIES, CANCELLATION_POLICIES, POLICY_LABEL, UNIT_LABEL, UNIT_TYPES } from '@/lib/format';
import type { Listing } from '@/types/database';

export function ListingFields({ l, resorts }: { l?: Listing; resorts: { id: string; name: string; city: string; state: string }[] }) {
  return (
    <>
      <label>Title <input name="title" defaultValue={l?.title ?? ''} maxLength={120} required placeholder="Oceanfront 2BR, Marriott Grande Vista" /></label>
      <label>Resort
        <select name="resort_id" defaultValue={l?.resort_id ?? ''} required>
          <option value="" disabled>Select a resort…</option>
          {resorts.map((r) => <option key={r.id} value={r.id}>{r.name} — {r.city}, {r.state}</option>)}
        </select>
      </label>
      <div className="fields">
        <label>Unit type
          <select name="unit_type" defaultValue={l?.unit_type ?? '1br'} required>
            {UNIT_TYPES.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
          </select>
        </label>
        <label>Bedrooms <input name="bedrooms" type="number" min={0} max={10} defaultValue={l?.bedrooms ?? 1} required /></label>
        <label>Bathrooms <input name="bathrooms" type="number" min={0} max={10} step={0.5} defaultValue={l?.bathrooms ?? 1} required /></label>
        <label>Sleeps <input name="sleeps" type="number" min={1} max={30} defaultValue={l?.sleeps ?? 4} required /></label>
      </div>
      <label>Description <textarea name="description" defaultValue={l?.description ?? ''} maxLength={4000} /></label>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 500, fontSize: '.925rem', marginBottom: '.3rem' }}>Amenities</legend>
        <div className="fields" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          {AMENITIES.map((a) => (
            <label className="check" key={a}><input type="checkbox" name="amenities" value={a} defaultChecked={l?.amenities.includes(a)} />{a}</label>
          ))}
        </div>
      </fieldset>
      <label>House rules <textarea name="house_rules" defaultValue={l?.house_rules ?? ''} maxLength={2000} /></label>
      <label>Cancellation policy
        <select name="cancellation_policy" defaultValue={l?.cancellation_policy ?? 'moderate'}>
          {CANCELLATION_POLICIES.map((p) => <option key={p} value={p}>{POLICY_LABEL[p]}</option>)}
        </select>
      </label>
    </>
  );
}
