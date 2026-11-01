alter table public.articles
  add column introduction text,
  add column background text,
  add column current_understanding text,
  add column future_possibilities text,
  add column limitations text;

update public.sources
set verification_status = 'pending',
    verified_by = null,
    verified_at = null
where verification_status = 'verified'
  and (verified_by is null or verified_at is null);

alter table public.sources
  alter column verification_status set default 'pending',
  add constraint sources_verification_metadata_check check (
    (verification_status = 'verified') = (verified_by is not null and verified_at is not null)
  );

create or replace function public.guard_verified_sources()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.verification_status = 'verified'
    and (select auth.uid()) is not null
    and (
      not public.is_editor()
      or new.verified_by is distinct from (select auth.uid())
    ) then
    raise exception 'An editor can only verify a source as themselves';
  end if;
  return new;
end;
$$;

create trigger sources_guard_verification
  before insert or update on public.sources
  for each row execute function public.guard_verified_sources();

drop policy "Editors update submissions" on public.submissions;
revoke update on public.submissions from authenticated;

drop policy "Editors update reference verification" on public.submission_references;
revoke update on public.submission_references from authenticated;
grant update (verification_status, verified_by, verified_at)
  on public.submission_references to authenticated;
create policy "Editors update reference verification"
  on public.submission_references for update to authenticated
  using (public.is_editor()) with check (public.is_editor());

drop policy "Editors manage sources" on public.sources;
revoke insert, update, delete on public.sources from authenticated;
grant update (verification_status, verified_by, verified_at)
  on public.sources to authenticated;
create policy "Editors verify article sources"
  on public.sources for update to authenticated
  using (public.is_editor()) with check (public.is_editor());

drop policy "Sources follow article visibility" on public.sources;
create policy "Verified sources on published articles are public"
  on public.sources for select
  using (
    (verification_status = 'verified' and exists (
      select 1 from public.articles
      where articles.id = article_id and articles.status = 'published'
    ))
    or public.is_editor()
  );

drop policy "Editors manage categories" on public.categories;
create policy "Editors update categories"
  on public.categories for update to authenticated
  using (public.is_editor()) with check (public.is_editor());
create policy "Editors create categories"
  on public.categories for insert to authenticated
  with check (public.is_editor());
revoke delete on public.categories from authenticated;

revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'article-images',
  'article-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Article images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'article-images');

create policy "Members upload images into their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'article-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Members remove images from their own folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'article-images'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.is_editor()
    )
  );
