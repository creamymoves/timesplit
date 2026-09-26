import Link from 'next/link';
import { requireUser } from '@/lib/auth/roles';
import { signOut } from '@/app/login/actions';
import { becomeOwner } from './actions';

export default async function Dashboard({ searchParams }: { searchParams: { error?: string } }) {
  const { user, roles, ownerStatus } = await requireUser();
  return (
    <main>
      <h1>Dashboard</h1>
      {searchParams.error === 'forbidden' ? <p role="alert">You do not have access to that page.</p> : null}
      <p>Signed in as {user.email}</p>
      <p>Roles: {roles.join(', ')}</p>
      {roles.includes('owner') ? (
        <p>
          Owner verification: <strong>{ownerStatus}</strong>{' '}
          {ownerStatus !== 'approved' ? <Link href="/owner/verify">Continue verification</Link> : null}
        </p>
      ) : (
        <form action={becomeOwner}>
          <button type="submit">List a timeshare (become an owner)</button>
        </form>
      )}
      {roles.includes('admin') ? <Link href="/admin">Admin</Link> : null}
      <form action={signOut}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
