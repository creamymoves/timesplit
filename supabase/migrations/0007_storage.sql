-- 0007_storage.sql
-- Buckets and object policies. Path convention: <bucket>/<owner user id>/... so ownership is
-- derivable from the first path segment with storage.foldername(name)[1].

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('listing-photos',       'listing-photos',       true,  10485760, array['image/jpeg','image/png','image/webp']),
  ('avatars',              'avatars',              true,   2097152, array['image/jpeg','image/png','image/webp']),
  ('ownership-docs',       'ownership-docs',       false, 26214400, array['application/pdf','image/jpeg','image/png']),
  ('resort-confirmations', 'resort-confirmations', false, 26214400, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;

-- listing-photos: public read; owners write under their own folder.
create policy "listing photos are public" on storage.objects for select
  using (bucket_id = 'listing-photos');
create policy "owners upload own listing photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text and public.has_role('owner'));
create policy "owners manage own listing photos" on storage.objects for update to authenticated
  using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owners delete own listing photos" on storage.objects for delete to authenticated
  using (bucket_id = 'listing-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- avatars: public read; users write their own folder.
create policy "avatars are public" on storage.objects for select using (bucket_id = 'avatars');
create policy "users upload own avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users update own avatar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users delete own avatar" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ownership-docs: private. Owner uploads/reads own; admins read all. No client updates/deletes (retention).
create policy "owner uploads ownership doc" on storage.objects for insert to authenticated
  with check (bucket_id = 'ownership-docs' and (storage.foldername(name))[1] = auth.uid()::text and public.has_role('owner'));
create policy "owner or admin reads ownership doc" on storage.objects for select to authenticated
  using (bucket_id = 'ownership-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- resort-confirmations: private. Owner uploads under <owner_id>/<booking_id>/; owner, that booking's
-- renter, and admins can read.
create policy "owner uploads resort confirmation" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'resort-confirmations'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.bookings b
      where b.id::text = (storage.foldername(name))[2] and b.owner_id = auth.uid()
    )
  );
create policy "parties read resort confirmation" on storage.objects for select to authenticated
  using (
    bucket_id = 'resort-confirmations'
    and (
      public.is_admin()
      or exists (
        select 1 from public.bookings b
        where b.id::text = (storage.foldername(name))[2]
          and auth.uid() in (b.owner_id, b.renter_id)
      )
    )
  );
