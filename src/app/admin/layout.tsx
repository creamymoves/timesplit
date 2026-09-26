import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireRole } from '@/lib/auth/roles';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireRole('admin', '/admin');
  return (
    <>
      <div className="subnav">
        <Link href="/admin">Overview</Link>
        <Link href="/admin/verifications">Verification queue</Link>
        <Link href="/admin/listings">Listings</Link>
        <Link href="/admin/resorts">Resorts</Link>
        <Link href="/admin/users">Users</Link>
      </div>
      {children}
    </>
  );
}
