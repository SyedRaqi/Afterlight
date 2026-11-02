-- Restrict direct comment edits to content fields. Moderation state changes
-- are available only through the editor-checked RPC below.
drop policy if exists "Authors and editors moderate comments" on public.comments;
create policy "Authors and editors edit comment text"
  on public.comments for update to authenticated
  using (author_id = (select auth.uid()) or public.is_editor())
  with check (author_id = (select auth.uid()) or public.is_editor());

revoke update on public.comments from public, anon, authenticated;
grant update (body) on public.comments to authenticated;

create or replace function public.moderate_comment(
  p_comment_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_editor() then
    raise exception 'Editorial access is required to moderate comments';
  end if;
  if p_status is null or p_status not in ('visible', 'hidden', 'removed') then
    raise exception 'Choose a valid comment status';
  end if;

  update public.comments
  set status = p_status,
      updated_at = now()
  where id = p_comment_id;

  if not found then
    raise exception 'The requested comment does not exist';
  end if;
end;
$$;

revoke all on function public.moderate_comment(uuid, text) from public, anon;
grant execute on function public.moderate_comment(uuid, text) to authenticated;

-- Verified references are copied to article sources during approval. Preserve
-- their original verifier while still requiring an authorized editor and
-- matching, previously verified submission-reference provenance.
create or replace function public.guard_verified_sources()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE'
    and old.verification_status = 'verified'
    and new.verification_status <> 'verified'
    and exists (
      select 1 from public.articles
      where id = old.article_id and status = 'published'
    ) then
    raise exception 'A verified source on a published article cannot be unverified';
  end if;

  if new.verification_status = 'verified'
    and (select auth.uid()) is not null
    and (
      not public.is_editor()
      or (
        new.verified_by is distinct from (select auth.uid())
        and not (
          tg_op = 'INSERT'
          and exists (
            select 1
            from public.articles
            join public.submission_references
              on submission_references.submission_id = articles.submission_id
            where articles.id = new.article_id
              and submission_references.url = new.url
              and submission_references.verification_status = 'verified'
              and submission_references.verified_by = new.verified_by
              and submission_references.verified_at = new.verified_at
          )
        )
      )
    ) then
    raise exception 'Only an editor may verify a source, and verification provenance must be preserved';
  end if;
  return new;
end;
$$;

-- This bucket was created by migration 002. Keep its upload restrictions while
-- switching it to private access.
update storage.buckets
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
where id = 'article-images';

-- Recognize current object paths and legacy public or signed URLs from
-- Supabase-hosted projects or the standard local Supabase host. External image
-- URLs are not interpreted as Storage paths.
create or replace function public.article_image_storage_path(p_image_reference text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_image_reference ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|avif)$'
      then p_image_reference
    when p_image_reference ~* '^https?://(?:[a-z0-9-]+\.supabase\.co|localhost|127\.0\.0\.1)(?::[0-9]+)?/storage/v1/object/(?:public|sign)/article-images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|avif)(\?[^[:space:]]+)?$'
      then split_part(regexp_replace(p_image_reference, '^https?://[^/]+/storage/v1/object/(public|sign)/article-images/', '', 'i'), '?', 1)
    else null
  end
$$;

-- Drop the old URL-only checks before rewriting legacy submission references.
alter table public.submissions
  drop constraint if exists submissions_hero_image_url_check;
alter table public.articles
  drop constraint if exists articles_hero_image_url_check;

-- Convert a legacy submission URL only when its path identifies an existing
-- object owned by the submission author. External, foreign, or missing-object
-- URLs are cleared because submission images must remain private in this app.
update public.submissions as submissions
set hero_image_url = public.article_image_storage_path(submissions.hero_image_url)
where submissions.hero_image_url ~* '^https?://'
  and public.article_image_storage_path(submissions.hero_image_url) is not null
  and exists (
    select 1 from storage.objects
    where storage.objects.bucket_id = 'article-images'
      and storage.objects.name = public.article_image_storage_path(submissions.hero_image_url)
      and (storage.foldername(storage.objects.name))[1] = submissions.author_id::text
  );

update public.submissions
set hero_image_url = null
where hero_image_url ~* '^https?://';

-- Revision rows preserve previously published article imagery. Normalize old
-- Supabase Storage URLs when the referenced object is still present.
update public.article_revisions as revisions
set hero_image_url = public.article_image_storage_path(revisions.hero_image_url)
where revisions.hero_image_url ~* '^https?://'
  and public.article_image_storage_path(revisions.hero_image_url) is not null
  and exists (
    select 1 from storage.objects
    where storage.objects.bucket_id = 'article-images'
      and storage.objects.name = public.article_image_storage_path(revisions.hero_image_url)
  );

alter table public.submissions
  add constraint submissions_hero_image_path_check
    check (
      hero_image_url is null
      or hero_image_url ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|avif)$'
    );

alter table public.articles
  add constraint articles_hero_image_path_check
    check (
      hero_image_url is null
      or public.article_image_storage_path(hero_image_url) is not null
      or hero_image_url ~* '^https?://[^[:space:]]+$'
    );

alter table public.article_revisions
  add constraint article_revisions_hero_image_path_check
    check (
      hero_image_url is null
      or public.article_image_storage_path(hero_image_url) is not null
      or hero_image_url ~* '^https?://[^[:space:]]+$'
    );

create or replace function public.validate_submission_image_path()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.hero_image_url is not null
    and new.hero_image_url !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|avif)$' then
    raise exception 'Submission images must use a supported private Storage object path';
  end if;
  if new.hero_image_url is not null
    and (select auth.uid()) is not null
    and split_part(new.hero_image_url, '/', 1) <> (select auth.uid())::text then
    raise exception 'Submission images must be stored in your own folder';
  end if;
  return new;
end;
$$;

create trigger submissions_validate_image_path
  before insert or update of hero_image_url on public.submissions
  for each row execute function public.validate_submission_image_path();

drop policy if exists "Article images are publicly readable" on storage.objects;
drop policy if exists "Members upload images into their own folder" on storage.objects;
drop policy if exists "Members remove images from their own folder" on storage.objects;

create policy "Owners editors and published articles can read images"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'article-images'
    and (
      (
        (select auth.uid()) is not null
        and (
          (storage.foldername(name))[1] = (select auth.uid())::text
          or public.is_editor()
        )
      )
      or exists (
        select 1 from public.articles
        where public.article_image_storage_path(articles.hero_image_url) = storage.objects.name
          and articles.status = 'published'
      )
      or exists (
        select 1
        from public.article_revisions
        join public.articles on articles.id = article_revisions.article_id
        where public.article_image_storage_path(article_revisions.hero_image_url) = storage.objects.name
          and articles.status = 'published'
      )
    )
  );

create policy "Members upload images into their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'article-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Owners and editors remove unreferenced images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'article-images'
    and (
      public.is_editor()
      or (storage.foldername(name))[1] = (select auth.uid())::text
    )
    and not exists (
      select 1 from public.articles
      where public.article_image_storage_path(articles.hero_image_url) = storage.objects.name
        and articles.status = 'published'
      )
    and not exists (
      select 1
      from public.article_revisions
      join public.articles on articles.id = article_revisions.article_id
      where public.article_image_storage_path(article_revisions.hero_image_url) = storage.objects.name
        and articles.status = 'published'
    )
  );

-- Keep the existing author resubmission RPC compatible with path-based image
-- references. Authors may retain their own existing uploaded path or remove it.
create or replace function public.update_submission_review(
  submission_id uuid,
  new_title text,
  new_summary text,
  new_category_id uuid,
  new_classification text,
  new_evidence text,
  new_reference_urls text[],
  new_hero_image_url text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  item public.submissions%rowtype;
  reference_url text;
begin
  select * into item
  from public.submissions
  where id = update_submission_review.submission_id
  for update;
  if not found or item.author_id <> (select auth.uid()) then
    raise exception 'You can only revise your own submission';
  end if;
  if item.status <> 'changes_requested' then
    raise exception 'This submission is not awaiting a revision';
  end if;
  if char_length(btrim(new_title)) not between 8 and 140 then
    raise exception 'The title must be between 8 and 140 characters';
  end if;
  if char_length(btrim(new_summary)) not between 40 and 3500 then
    raise exception 'The description must be between 40 and 3500 characters';
  end if;
  if new_classification not in ('FACT', 'RESEARCH', 'PREDICTION', 'POSSIBILITY', 'IMAGINATION') then
    raise exception 'Choose a valid information classification';
  end if;
  if new_evidence is not null and char_length(new_evidence) > 5000 then
    raise exception 'Evidence and context must be 5000 characters or fewer';
  end if;
  if new_hero_image_url is not null
    and new_hero_image_url is distinct from item.hero_image_url then
    raise exception 'Keep the existing image or remove it before resubmitting';
  end if;

  foreach reference_url in array coalesce(new_reference_urls, '{}'::text[]) loop
    if reference_url !~ '^https?://' then
      raise exception 'References must use an http or https URL';
    end if;
  end loop;

  if not exists (select 1 from public.categories where id = new_category_id and is_active) then
    raise exception 'Choose an active category';
  end if;

  update public.submissions
  set title = btrim(new_title),
      summary = btrim(new_summary),
      category_id = new_category_id,
      classification = new_classification,
      evidence = nullif(btrim(coalesce(new_evidence, '')), ''),
      reference_urls = coalesce(new_reference_urls, '{}'::text[]),
      hero_image_url = new_hero_image_url,
      status = 'pending',
      updated_at = now()
  where id = item.id;
end;
$$;
