import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';
import { Empty } from '@/components/ui';
import { relTime } from '@/lib/format';
import { markAllRead } from './actions';

export const metadata: Metadata = { title: 'Inbox' };

export default async function Notifications() {
  const { user } = await requireUser('/notifications');
  const supabase = createClient();
  const { data: rows } = await supabase.from('notifications').select('id, title, body, created_at, read_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50);
  const unread = rows?.filter((r) => !r.read_at).length ?? 0;
  return (
    <>
      <div className="page-head">
        <h1>Inbox {unread ? <span className="badge warn">{unread} new</span> : null}</h1>
        {unread ? <form action={markAllRead}><button className="btn secondary sm" type="submit">Mark all read</button></form> : null}
      </div>
      {rows?.length ? (
        <div className="stack">
          {rows.map((n) => (
            <div key={n.id} className="card" style={{ opacity: n.read_at ? 0.7 : 1 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>{n.title}</b><span className="muted small">{relTime(n.created_at)}</span>
              </div>
              {n.body ? <p className="small" style={{ margin: '.25rem 0 0' }}>{n.body}</p> : null}
            </div>
          ))}
        </div>
      ) : <Empty>Nothing here yet.</Empty>}
    </>
  );
}
