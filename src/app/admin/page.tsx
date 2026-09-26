import { requireRole } from '@/lib/auth/roles';

export default async function AdminHome() {
  await requireRole('admin', '/admin');
  return (
    <main>
      <h1>Admin</h1>
      <p>Verification queue, confirmation review and payout controls land in the next phase.</p>
    </main>
  );
}
