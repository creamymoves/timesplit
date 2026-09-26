'use server';
import { z } from 'zod';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';
import { back, errMsg, str } from '@/lib/action';
import { AMENITIES, CANCELLATION_POLICIES, UNIT_TYPES } from '@/lib/format';
import { IMAGE_TYPES, MAX_IMAGE_BYTES, extFor, splitPath } from '@/lib/storage';

const listingSchema = z.object({
  title: z.string().min(3).max(120),
  resort_id: z.string().uuid(),
  unit_type: z.enum(UNIT_TYPES),
  bedrooms: z.coerce.number().int().min(0).max(10),
  bathrooms: z.coerce.number().min(0).max(10),
  sleeps: z.coerce.number().int().min(1).max(30),
  description: z.string().max(4000),
  amenities: z.array(z.enum(AMENITIES)),
  house_rules: z.string().max(2000),
  cancellation_policy: z.enum(CANCELLATION_POLICIES),
});

function parseListing(fd: FormData) {
  return listingSchema.safeParse({
    title: str(fd, 'title'), resort_id: str(fd, 'resort_id'), unit_type: str(fd, 'unit_type'),
    bedrooms: str(fd, 'bedrooms'), bathrooms: str(fd, 'bathrooms'), sleeps: str(fd, 'sleeps'),
    description: str(fd, 'description'), amenities: fd.getAll('amenities').map(String),
    house_rules: str(fd, 'house_rules'), cancellation_policy: str(fd, 'cancellation_policy'),
  });
}
const issues = (e: z.ZodError) => 'Please check: ' + e.issues.map((i) => i.path.join('.')).join(', ');

export async function createListing(fd: FormData) {
  const { user } = await requireRole('owner');
  const parsed = parseListing(fd);
  if (!parsed.success) back('/owner/listings/new', { error: issues(parsed.error) });
  const supabase = createClient();
  const { data, error } = await supabase.from('listings')
    .insert({ ...parsed.data, description: parsed.data.description || null, house_rules: parsed.data.house_rules || null, owner_id: user.id, status: 'draft' })
    .select('id').single();
  if (error) back('/owner/listings/new', { error: errMsg(error) });
  redirect(`/owner/listings/${data.id}?ok=${encodeURIComponent('Draft saved. Add photos, then publish.')}`);
}

export async function updateListing(fd: FormData) {
  const { user } = await requireRole('owner');
  const id = str(fd, 'id');
  const parsed = parseListing(fd);
  if (!parsed.success) back(`/owner/listings/${id}`, { error: issues(parsed.error) });
  const supabase = createClient();
  const { error } = await supabase.from('listings')
    .update({ ...parsed.data, description: parsed.data.description || null, house_rules: parsed.data.house_rules || null })
    .eq('id', id).eq('owner_id', user.id);
  if (error) back(`/owner/listings/${id}`, { error: errMsg(error) });
  back(`/owner/listings/${id}`, { ok: 'Listing saved' });
}

const statusSchema = z.enum(['draft', 'active', 'paused', 'archived']);
export async function setListingStatus(fd: FormData) {
  const { user } = await requireRole('owner');
  const id = str(fd, 'id');
  const status = statusSchema.safeParse(str(fd, 'status'));
  if (!status.success) back(`/owner/listings/${id}`, { error: 'Invalid status' });
  const supabase = createClient();
  if (status.data === 'active') {
    const { count } = await supabase.from('listing_photos').select('id', { count: 'exact', head: true }).eq('listing_id', id);
    if (!count) back(`/owner/listings/${id}`, { error: 'Add at least one photo before publishing' });
  }
  // The DB trigger enforces the verification gate; we just surface its message.
  const { error } = await supabase.from('listings').update({ status: status.data }).eq('id', id).eq('owner_id', user.id);
  if (error) back(`/owner/listings/${id}`, { error: errMsg(error) });
  if (status.data === 'archived') back('/owner/listings', { ok: 'Listing archived' });
  back(`/owner/listings/${id}`, { ok: status.data === 'active' ? 'Listing is live' : `Listing ${status.data}` });
}

export async function uploadPhoto(fd: FormData) {
  const { user } = await requireRole('owner');
  const listingId = str(fd, 'listing_id');
  const path = `/owner/listings/${listingId}`;
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) back(path, { error: 'Choose an image' });
  if (!IMAGE_TYPES.includes(file.type)) back(path, { error: 'JPEG, PNG or WebP only' });
  if (file.size > MAX_IMAGE_BYTES) back(path, { error: 'Image is larger than 10 MB' });
  const supabase = createClient();
  const { data: l } = await supabase.from('listings').select('id').eq('id', listingId).eq('owner_id', user.id).maybeSingle();
  if (!l) back('/owner/listings', { error: 'Listing not found' });
  const { count } = await supabase.from('listing_photos').select('id', { count: 'exact', head: true }).eq('listing_id', listingId);
  if ((count ?? 0) >= 20) back(path, { error: 'Maximum 20 photos per listing' });
  const key = `${user.id}/${listingId}/${crypto.randomUUID()}.${extFor(file.type)}`;
  const up = await supabase.storage.from('listing-photos').upload(key, file, { contentType: file.type });
  if (up.error) back(path, { error: errMsg(up.error) });
  const { error } = await supabase.from('listing_photos').insert({
    listing_id: listingId, storage_path: `listing-photos/${key}`, caption: str(fd, 'caption') || null, sort_order: count ?? 0,
  });
  if (error) back(path, { error: errMsg(error) });
  back(path, { ok: 'Photo added' });
}

export async function deletePhoto(fd: FormData) {
  await requireRole('owner');
  const listingId = str(fd, 'listing_id');
  const photoId = str(fd, 'photo_id');
  const supabase = createClient();
  const { data: p } = await supabase.from('listing_photos').select('storage_path').eq('id', photoId).eq('listing_id', listingId).maybeSingle();
  if (!p) back(`/owner/listings/${listingId}`, { error: 'Photo not found' });
  const { error } = await supabase.from('listing_photos').delete().eq('id', photoId);   // RLS: owner only
  if (error) back(`/owner/listings/${listingId}`, { error: errMsg(error) });
  const { bucket, key } = splitPath(p.storage_path);
  await supabase.storage.from(bucket).remove([key]);
  back(`/owner/listings/${listingId}`, { ok: 'Photo removed' });
}
