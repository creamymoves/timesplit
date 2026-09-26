import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Admin' };

export default async function AdminHome() {
  const supabase = createClient();
  const count = (q: PromiseLike<{ count: number | null }>) => q.then((r) => r.count ?? 0);
  const [pending, owners, active, unverifiedResorts, users] = await Promise.all([
    count(supabase.from('owner_verifications').select('id', { count: 'exact', head: true }).eq('status', 'pending_review')),
    count(supabase.from('user_roles').select('user_id', { count: 'exact', head: true }).eq('role', 'owner')),
    count(supabase.from('listings').select('id', { count: 'exact', head: true }).eq('status', 'active')),
    count(supabase.from('resorts').select('id', { count: 'exact', head: true }).eq('is_verified', false)),
    count(supabase.from('profiles').select('id', { count: 'exact', head: true })),
  ]);
  const stats = [
    { label: 'Verifications waiting', value: pending, href: '/admin/verifications' },
    { label: 'Owners', value: owners, href: '/admin/users?role=owner' },
    { label: 'Active listings', value: active, href: '/admin/listings' },
    { label: 'Unverified resorts', value: unverifiedResorts, href: '/admin/resorts?verified=0' },
    { label: 'Users', value: users, href: '/admin/users' },
  ];
  return (
    <>
      <div className="page-head"><h1>Admin</h1></div>
      <div className="grid">
        {stats.map((s) => (
          <Link key={s.label} href={s.href as '/admin'} className="card stat"><b>{s.value}</b><span className="muted small">{s.label}</span></Link>
        ))}
      </div>
    </>
  );
}
