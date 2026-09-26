import { requireRole } from '@/lib/auth/roles';

export default async function OwnerVerifyPage() {
  const { ownerStatus } = await requireRole('owner', '/owner/verify');
  return (
    <main>
      <h1>Owner verification</h1>
      <p>Status: {ownerStatus}</p>
      <p>Ownership document upload and Stripe Identity are wired up in the next phase.</p>
    </main>
  );
}
