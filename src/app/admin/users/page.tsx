import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { Badge, Empty, Flash } from '@/components/ui';
import { shortDate } from '@/lib/format';
import { setRole } from './actions';

export const metadata: Metadata = { title: 'Users · Admin' };

export default async function AdminUsers({ searchParams }: { searchParams: { ok?: string; error?: string; q?: string; role?: string } }) {
  const supabase = createClient();
  let q = supabase.from('profiles').select('id, email, full_name, owner_verification_status, created_at, user_roles!user_roles_user_id_fkey(role)').order('created_at', { ascending: false }).limit(200);
  if (searchParams.q) q = q.or(`email.ilike.%${searchParams.q}%,full_name.ilike.%${searchParams.q}%`);
  const { data: rows } = await q;
  const filtered = searchParams.role ? rows?.filter((p) => p.user_roles.some((r) => r.role === searchParams.role)) : rows;
  return (
    <>
      <div className="page-head">
        <h1>Users</h1>
        <form className="row" method="get"><input name="q" placeholder="Search email or name" defaultValue={searchParams.q ?? ''} /><button className="btn secondary sm" type="submit">Search</button></form>
      </div>
      <Flash searchParams={searchParams} />
      {filtered?.length ? (
        <table className="table">
          <thead><tr><th>User</th><th>Roles</th><th>Owner status</th><th>Joined</th><th>Admin role</th></tr></thead>
          <tbody>
            {filtered.map((p) => {
              const roles = p.user_roles.map((r) => r.role);
              const isAdmin = roles.includes('admin');
              return (
                <tr key={p.id}>
                  <td>{p.full_name ?? '—'}<div className="muted small">{p.email}</div></td>
                  <td className="row">{roles.map((r) => <Badge key={r} value={r} />)}</td>
                  <td>{roles.includes('owner') ? <Badge value={p.owner_verification_status} /> : '—'}</td>
                  <td className="muted small">{shortDate(p.created_at)}</td>
                  <td>
                    <form action={setRole}>
                      <input type="hidden" name="user_id" value={p.id} /><input type="hidden" name="role" value="admin" /><input type="hidden" name="grant" value={isAdmin ? '0' : '1'} />
                      <button className={`btn sm ${isAdmin ? 'danger' : 'secondary'}`} type="submit">{isAdmin ? 'Revoke admin' : 'Make admin'}</button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <Empty>No users match.</Empty>}
    </>
  );
}
