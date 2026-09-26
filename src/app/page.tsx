import Link from 'next/link';
import { getSessionUser } from '@/lib/auth/roles';

export default async function Home() {
  const session = await getSessionUser();
  return (
    <main>
      <h1>Timesplit</h1>
      <p>Timeshare rentals from verified owners. US only.</p>
      {session ? <Link href="/dashboard">Go to dashboard</Link> : <Link href="/login">Sign in</Link>}
    </main>
  );
}
