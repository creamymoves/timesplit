import type { Metadata } from 'next';
import { requireRole } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';
import { ListingFields } from '@/components/ListingForm';
import { Flash } from '@/components/ui';
import { createListing } from '../actions';

export const metadata: Metadata = { title: 'New listing' };

export default async function NewListing({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireRole('owner');
  const supabase = createClient();
  const { data: resorts } = await supabase.from('resorts').select('id, name, city, state').order('name');
  return (
    <>
      <div className="page-head"><h1>New listing</h1></div>
      <Flash searchParams={searchParams} />
      <form action={createListing} className="card form">
        <ListingFields resorts={resorts ?? []} />
        <p className="muted small">Can&apos;t find your resort? <a href="/owner/resorts/new">Add it</a> and it will appear here.</p>
        <div className="row"><button className="btn" type="submit">Save draft</button></div>
      </form>
    </>
  );
}
