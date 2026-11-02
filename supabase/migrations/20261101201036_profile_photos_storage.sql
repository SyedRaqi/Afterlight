insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photos',
  'profile-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Public bucket downloads work by URL. These policies restrict all writes and
-- authenticated replacement checks to the caller's own avatar object.
create policy "Users upload their own profile photo"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and storage.filename(name) ~* '^avatar\.(jpg|png|webp)$'
  );

create policy "Users read their own profile photo for replacement"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and storage.filename(name) ~* '^avatar\.(jpg|png|webp)$'
  );

create policy "Users replace their own profile photo"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and storage.filename(name) ~* '^avatar\.(jpg|png|webp)$'
  )
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and storage.filename(name) ~* '^avatar\.(jpg|png|webp)$'
  );

create policy "Users delete their own profile photo"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and storage.filename(name) ~* '^avatar\.(jpg|png|webp)$'
  );
