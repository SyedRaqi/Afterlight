-- Preserve submission reference order when approved submissions become drafts.
create or replace function public.approve_submission(submission_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  item public.submissions%rowtype;
  article_uuid uuid;
  article_slug text;
begin
  if not public.is_editor() then
    raise exception 'Editorial access is required to review submissions';
  end if;
  select * into item
  from public.submissions
  where id = approve_submission.submission_id
  for update;
  if not found or item.status <> 'pending' then
    raise exception 'This submission is no longer awaiting review';
  end if;

  if exists (
    select 1 from public.submission_references
    where submission_references.submission_id = item.id
      and verification_status <> 'verified'
  ) then
    raise exception 'Verify every reference before approving this submission';
  end if;

  if item.classification in ('FACT', 'RESEARCH', 'PREDICTION')
    and not exists (
      select 1 from public.submission_references
      where submission_references.submission_id = item.id
        and verification_status = 'verified'
        and verified_by is not null
        and verified_at is not null
    ) then
    raise exception 'Fact, research, and prediction notes require a verified source';
  end if;

  insert into public.editorial_reviews (submission_id, reviewer_id, decision)
  values (item.id, (select auth.uid()), 'approved');

  article_slug := trim(both '-' from regexp_replace(lower(item.title), '[^a-z0-9]+', '-', 'g'));
  if article_slug = '' then article_slug := 'field-note'; end if;
  article_slug := left(article_slug, 110) || '-' || left(item.id::text, 8);

  insert into public.articles (
    submission_id, author_id, category_id, title, slug, summary, body,
    classification, hero_image_url, status
  ) values (
    item.id, item.author_id, item.category_id, item.title, article_slug, item.summary,
    coalesce(nullif(btrim(item.evidence), ''), ''), item.classification, item.hero_image_url,
    'draft'
  )
  returning id into article_uuid;

  insert into public.sources (article_id, title, url, verification_status, verified_by, verified_at)
  select article_uuid, 'Reference ' || source.ordinality, source.url,
    submission_reference.verification_status,
    submission_reference.verified_by,
    submission_reference.verified_at
  from unnest(item.reference_urls) with ordinality as source(url, ordinality)
  join public.submission_references as submission_reference
    on submission_reference.submission_id = item.id
    and submission_reference.url = source.url
  order by source.ordinality;

  update public.submissions set status = 'approved', updated_at = now() where id = item.id;
  insert into public.notifications (user_id, kind, title, message)
  values (
    item.author_id,
    'submission_approved',
    'Your idea passed its first review',
    'An editor approved your submission. The note is being prepared for publication.'
  );

  return article_uuid;
end;
$$;

-- Retain the existing RPC access boundary explicitly.
revoke all on function public.approve_submission(uuid) from public, anon;
grant execute on function public.approve_submission(uuid) to authenticated;
