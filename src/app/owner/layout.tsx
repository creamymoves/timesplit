import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireRole } from '@/lib/auth/roles';
import { Badge } from '@/components/ui';

export default async function OwnerLayout({ children }: { children: ReactNode }) {
  const s = await requireRole('owner', '/owner/listings');
  return (
    <>
      <div className="subnav">
        <Link href="/owner/listings">Listings</Link>
        <Link href="/owner/verify">Verification <Badge value={s.ownerStatus} /></Link>
        <Link href="/owner/payouts">Payouts</Link>
      </div>
      {children}
    </>
  );
}
