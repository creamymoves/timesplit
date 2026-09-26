import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';
import { Badge, Flash } from '@/components/ui';
import { becomeOwner } from './actions';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function Dashboard({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const { user, roles, ownerStatus } = await requireUser();
  const supabase = createClient();
  const { data: profile } = await supabase.from('profiles').select('full_name, terms_accepted_at').eq('id', user.id).maybeSingle();
  const isOwner = roles.includes('owner');
  return (
    <>
      <div className="page-head"><h1>Hi {profile?.full_name?.split(' ')[0] ?? 'there'}</h1></div>
      {searchParams.error === 'forbidden' ? <div className="alert error">You do not have access to that page.</div> : <Flash searchParams={searchParams} />}
      {!profile?.full_name || !profile.terms_accepted_at ? (
        <div className="alert">Finish setting up your account: <Link href="/settings">add your name and accept the terms</Link>.</div>
      ) : null}
      <div className="grid" style={{ marginTop: '1rem' }}>
        <div className="card stack">
          <h2>Renting</h2>
          <p className="muted small">Your booking requests and trips will show here once booking opens.</p>
          <Link className="btn secondary" href="/listings">Browse listings</Link>
        </div>
        <div className="card stack">
          <h2>Owning</h2>
          {isOwner ? (
            <>
              <p className="small">Verification: <Badge value={ownerStatus} /></p>
              <div className="row">
                <Link className="btn" href="/owner/listings">My listings</Link>
                {ownerStatus !== 'approved' ? <Link className="btn secondary" href="/owner/verify">Get verified</Link> : null}
              </div>
            </>
          ) : (
            <>
              <p className="muted small">List a week you can&apos;t use. You set the price; we handle payment and verification.</p>
              <form action={becomeOwner}><button className="btn" type="submit">Start listing</button></form>
            </>
          )}
        </div>
        <div className="card stack">
          <h2>Account</h2>
          <p className="small muted">{user.email}</p>
          <div className="row"><Link className="btn secondary" href="/settings">Settings</Link><Link className="btn secondary" href="/notifications">Inbox</Link></div>
        </div>
      </div>
    </>
  );
}
