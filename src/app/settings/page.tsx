import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';
import { Flash } from '@/components/ui';
import { US_STATES } from '@/lib/format';
import { publicUrl } from '@/lib/storage';
import { updateProfile, uploadAvatar } from './actions';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const { user } = await requireUser('/settings');
  const supabase = createClient();
  const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (!p) return <p>Profile not found.</p>;
  const avatar = publicUrl(p.avatar_path);

  return (
    <>
      <div className="page-head"><h1>Settings</h1></div>
      <Flash searchParams={searchParams} />
      <div className="split">
        <form action={updateProfile} className="card form">
          <h2>Profile</h2>
          <label>Email <input value={p.email} disabled /></label>
          <label>Full name <input name="full_name" defaultValue={p.full_name ?? ''} maxLength={120} required /></label>
          <div className="fields">
            <label>Phone <input name="phone" type="tel" defaultValue={p.phone ?? ''} placeholder="+1 555 555 5555" /></label>
            <label>State
              <select name="us_state" defaultValue={p.us_state ?? ''}>
                <option value="">Select…</option>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" name="terms" defaultChecked={!!p.terms_accepted_at} required />
            I agree to the terms of service{p.terms_accepted_at ? ` (accepted ${new Date(p.terms_accepted_at).toLocaleDateString()})` : ''}
          </label>
          <div className="row"><button className="btn" type="submit">Save</button></div>
        </form>
        <form action={uploadAvatar} className="card form">
          <h2>Photo</h2>
          <div className="photo" style={{ maxWidth: 160, aspectRatio: '1' }}>
            {avatar ? <img src={avatar} alt="" /> : null}
          </div>
          <label>Upload <input type="file" name="file" accept="image/jpeg,image/png,image/webp" required /></label>
          <div className="row"><button className="btn secondary" type="submit">Upload</button></div>
        </form>
      </div>
    </>
  );
}
