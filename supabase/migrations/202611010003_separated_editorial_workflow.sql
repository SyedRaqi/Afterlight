alter table public.submissions
  drop constraint submissions_status_check,
  add constraint submissions_status_check
    check (status in ('pending', 'approved', 'published', 'changes_requested', 'rejected'));

alter table public.editorial_reviews
  drop constraint editorial_reviews_submission_id_key,
  drop constraint editorial_reviews_decision_check,
  add constraint editorial_reviews_decision_check
    check (decision in ('approved', 'returned'));

alter table public.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('submission_approved', 'submission_published', 'submission_returned', 'editorial_update'));

create or replace function public.require_editorial_review_before_publish()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  source_count bigint;
begin
  if new.status = 'published' then
    perform 1
    from public.sources
    where article_id = new.id
    for update;

    if not exists (
      select 1 from public.editorial_reviews
      where submission_id = new.submission_id and decision = 'approved'
    ) then
      raise exception 'An approved editorial review is required before publication';
    end if;

    if not exists (
      select 1 from public.submissions
      where id = new.submission_id and status = 'approved'
    ) then
      raise exception 'The submission must be approved and in the editorial draft stage';
    end if;

    if char_length(btrim(coalesce(new.introduction, ''))) < 40
      or char_length(btrim(coalesce(new.future_possibilities, ''))) < 40
      or char_length(btrim(coalesce(new.limitations, ''))) < 20 then
      raise exception 'An introduction, future possibilities, and limitations section are required';
    end if;

    if new.classification in ('FACT', 'RESEARCH', 'PREDICTION')
      and char_length(btrim(coalesce(new.current_understanding, ''))) < 40 then
      raise exception 'Fact, research, and prediction articles need a current-understanding section';
    end if;

    select count(*) into source_count
    from public.sources
    where article_id = new.id
      and verification_status = 'verified'
      and verified_by is not null
      and verified_at is not null;

    if exists (
      select 1 from public.sources
      where article_id = new.id and verification_status <> 'verified'
    ) then
      raise exception 'Review every source attached to the article before publishing';
    end if;

    if new.classification in ('FACT', 'RESEARCH', 'PREDICTION')
      and source_count = 0 then
      raise exception 'Fact, research, and prediction articles need at least one verified source';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger articles_require_editorial_review on public.articles;
create trigger articles_require_editorial_review
  before insert or update on public.articles
  for each row execute function public.require_editorial_review_before_publish();

create or replace function public.guard_verified_submission_references()
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
    raise exception 'An editor can only verify a reference as themselves';
  end if;
  return new;
end;
$$;

create trigger submission_references_guard_verification
  before insert or update on public.submission_references
  for each row execute function public.guard_verified_submission_references();

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
      or new.verified_by is distinct from (select auth.uid())
    ) then
    raise exception 'An editor can only verify a source as themselves';
  end if;
  return new;
end;
$$;

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
    source.verification_status, source.verified_by, source.verified_at
  from public.submission_references as source
  where source.submission_id = item.id;

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

create or replace function public.publish_submission(submission_id uuid)
returns uuid
language sql
security definer
set search_path = pg_catalog, public
as $$
  select public.approve_submission($1)
$$;

create or replace function public.publish_article(article_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  item public.articles%rowtype;
  calculated_reading_minutes integer;
begin
  if not public.is_editor() then
    raise exception 'Editorial access is required to publish articles';
  end if;

  select * into item
  from public.articles
  where id = publish_article.article_id
  for update;
  if not found or item.status <> 'draft' then
    raise exception 'This article is not an unpublished editorial draft';
  end if;
  if not exists (
    select 1 from public.submissions
    where id = item.submission_id and status = 'approved'
  ) then
    raise exception 'Only an approved submission can be published';
  end if;

  calculated_reading_minutes := greatest(1, ceil((
    length(coalesce(item.introduction, '')) +
    length(coalesce(item.background, '')) +
    length(coalesce(item.current_understanding, '')) +
    length(coalesce(item.future_possibilities, '')) +
    length(coalesce(item.limitations, '')) +
    length(item.body)
  )::numeric / 1000)::integer);

  update public.articles
  set status = 'published',
      published_at = now(),
      reading_minutes = least(calculated_reading_minutes, 120)
  where id = item.id;

  update public.submissions
  set status = 'published', updated_at = now()
  where id = item.submission_id;

  insert into public.notifications (user_id, article_id, kind, title, message)
  values (
    item.author_id,
    item.id,
    'submission_published',
    'Your idea is now published',
    'An editor completed the article and published it as a field note.'
  );

  return item.id;
end;
$$;

drop function public.reject_submission(uuid);

create function public.reject_submission(submission_id uuid, review_notes text default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  item public.submissions%rowtype;
  review_uuid uuid;
begin
  if not public.is_editor() then
    raise exception 'Editorial access is required to review submissions';
  end if;
  if char_length(btrim(coalesce(review_notes, ''))) < 20 then
    raise exception 'Give the author at least 20 characters of actionable revision feedback';
  end if;

  select * into item
  from public.submissions
  where id = reject_submission.submission_id
  for update;
  if not found or item.status <> 'pending' then
    raise exception 'This submission is no longer awaiting review';
  end if;

  insert into public.editorial_reviews (submission_id, reviewer_id, decision)
  values (item.id, (select auth.uid()), 'returned')
  returning id into review_uuid;
  update public.editorial_reviews
  set notes = nullif(left(btrim(coalesce(review_notes, '')), 2000), '')
  where id = review_uuid;
  update public.submissions set status = 'changes_requested', updated_at = now() where id = item.id;
  insert into public.notifications (user_id, kind, title, message)
  values (
    item.author_id,
    'submission_returned',
    'An editor has feedback on your idea',
    coalesce(
      nullif(left(btrim(coalesce(review_notes, '')), 420), ''),
      'Your idea needs revision before it can move forward. Sign in to update it.'
    )
  );
end;
$$;

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
  if new_hero_image_url is not null and new_hero_image_url !~ '^https?://' then
    raise exception 'The image URL must use http or https';
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

revoke all on function public.publish_submission(uuid) from public, anon;
revoke all on function public.publish_article(uuid) from public, anon;
revoke all on function public.reject_submission(uuid, text) from public, anon;
revoke all on function public.approve_submission(uuid) from public, anon;
revoke all on function public.publish_submission(uuid) from public, anon;
revoke all on function public.update_submission_review(uuid, text, text, uuid, text, text, text[], text) from public, anon;
grant execute on function public.approve_submission(uuid) to authenticated;
grant execute on function public.publish_submission(uuid) to authenticated;
grant execute on function public.publish_article(uuid) to authenticated;
grant execute on function public.reject_submission(uuid, text) to authenticated;
grant execute on function public.update_submission_review(uuid, text, text, uuid, text, text, text[], text) to authenticated;

create policy "Authors can read reviews on their submissions"
  on public.editorial_reviews for select to authenticated
  using (
    public.is_editor()
    or exists (
      select 1 from public.submissions
      where submissions.id = submission_id
        and submissions.author_id = (select auth.uid())
    )
  );
