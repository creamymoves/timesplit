import Link from 'next/link';
import { getSessionUser } from '@/lib/auth/roles';
import { signOut } from '@/app/login/actions';

export async function Nav() {
  const s = await getSessionUser();
  return (
    <header className="nav">
      <div className="nav-inner">
        <Link href="/" className="nav-brand">Timesplit</Link>
        <Link href="/listings">Browse</Link>
        <Link href="/resorts">Resorts</Link>
        <nav className="nav-links">
          {s ? (
            <>
              {s.roles.includes('owner') ? <Link href="/owner/listings">My listings</Link> : null}
              {s.roles.includes('admin') ? <Link href="/admin">Admin</Link> : null}
              <Link href="/notifications">Inbox</Link>
              <Link href="/dashboard">Dashboard</Link>
              <form action={signOut}><button className="btn secondary sm" type="submit">Sign out</button></form>
            </>
          ) : (
            <Link href="/login" className="btn sm">Sign in</Link>
          )}
        </nav>
      </div>
    </header>
  );
}
