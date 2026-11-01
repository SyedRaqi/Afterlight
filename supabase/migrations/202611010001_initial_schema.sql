create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https?://'),
  role text not null default 'member' check (role in ('member', 'contributor', 'editor', 'administrator')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 60),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete restrict,
  category_id uuid not null references public.categories (id) on delete restrict,
  title text not null check (char_length(title) between 8 and 140),
  summary text not null check (char_length(summary) between 40 and 3500),
  classification text not null check (classification in ('FACT', 'RESEARCH', 'PREDICTION', 'POSSIBILITY', 'IMAGINATION')),
  evidence text check (evidence is null or char_length(evidence) <= 5000),
  reference_urls text[] not null default '{}',
  hero_image_url text check (hero_image_url is null or hero_image_url ~ '^https?://'),
  status text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.editorial_reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete restrict,
  decision text not null check (decision in ('approved', 'returned')),
  notes text,
  created_at timestamptz not null default now(),
  unique (submission_id)
);

create table public.submission_references (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  url text not null check (url ~ '^https?://'),
  verification_status text not null default 'pending' check (verification_status in ('pending', 'verified', 'needs_attention')),
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (submission_id, url),
  check ((verification_status = 'verified') = (verified_by is not null and verified_at is not null))
);

create table public.articles (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions (id) on delete restrict,
  author_id uuid not null references public.profiles (id) on delete restrict,
  category_id uuid not null references public.categories (id) on delete restrict,
  title text not null check (char_length(title) between 8 and 140),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  summary text not null,
  body text not null,
  classification text not null check (classification in ('FACT', 'RESEARCH', 'PREDICTION', 'POSSIBILITY', 'IMAGINATION')),
  hero_image_url text check (hero_image_url is null or hero_image_url ~ '^https?://'),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  reading_minutes integer not null default 1 check (reading_minutes between 1 and 120),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'published') = (published_at is not null))
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  url text not null check (url ~ '^https?://'),
  publisher text,
  verification_status text not null default 'verified' check (verification_status in ('pending', 'verified', 'needs_attention')),
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (article_id, url)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete restrict,
  body text not null check (char_length(body) between 3 and 2000),
  status text not null default 'visible' check (status in ('visible', 'hidden', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reactions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  reaction text not null check (reaction in ('curious', 'insightful', 'inspiring')),
  created_at timestamptz not null default now(),
  unique (article_id, user_id, reaction)
);

create table public.bookmarks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  article_id uuid not null references public.articles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, article_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  article_id uuid references public.articles (id) on delete cascade,
  kind text not null check (kind in ('submission_published', 'submission_returned', 'editorial_update')),
  title text not null check (char_length(title) between 1 and 120),
  message text not null check (char_length(message) between 1 and 500),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index submissions_status_created_idx on public.submissions (status, created_at);
create index submissions_author_created_idx on public.submissions (author_id, created_at desc);
create index submission_references_status_idx on public.submission_references (verification_status, created_at);
create index articles_published_idx on public.articles (published_at desc) where status = 'published';
create index articles_category_published_idx on public.articles (category_id, published_at desc) where status = 'published';
create index articles_author_idx on public.articles (author_id);
create index sources_article_idx on public.sources (article_id);
create index comments_article_created_idx on public.comments (article_id, created_at desc) where status = 'visible';
create index reactions_article_idx on public.reactions (article_id);
create index bookmarks_article_idx on public.bookmarks (article_id);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);

insert into public.categories (name, slug, description) values
  ('Technology', 'technology', 'Tools, computing, and emerging technologies.'),
  ('Environment', 'environment', 'Climate, ecosystems, and the living world.'),
  ('Space', 'space', 'Astronomy, exploration, and life beyond Earth.'),
  ('Education', 'education', 'Learning, knowledge, and how we teach.'),
  ('Society', 'society', 'Culture, communities, and changing ways of life.'),
  ('Health', 'health', 'Medicine, public health, and human wellbeing.'),
  ('Economy', 'economy', 'Work, resources, and economic systems.')
on conflict (slug) do nothing;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select role from public.profiles where id = (select auth.uid())
$$;

create or replace function public.is_editor()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(public.current_user_role() in ('editor', 'administrator'), false)
$$;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  requested_name text;
begin
  requested_name := nullif(btrim(new.raw_user_meta_data ->> 'display_name'), '');
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    left(coalesce(requested_name, split_part(new.email, '@', 1), 'Explorer'), 80),
    'member'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger auth_user_creates_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.role is distinct from old.role
    and (select auth.uid()) is not null
    and coalesce(public.current_user_role(), '') <> 'administrator' then
    raise exception 'Only an administrator can change account roles';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

create or replace function public.validate_submission_references()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  reference_url text;
begin
  foreach reference_url in array new.reference_urls loop
    if reference_url !~ '^https?://' then
      raise exception 'References must use an http or https URL';
    end if;
  end loop;
  new.updated_at := now();
  return new;
end;
$$;

create trigger submissions_validate_references
  before insert or update on public.submissions
  for each row execute function public.validate_submission_references();

create or replace function public.sync_submission_references()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.submission_references where submission_id = new.id;
  insert into public.submission_references (submission_id, url)
  select new.id, reference_url
  from unnest(new.reference_urls) as reference_url;
  return new;
end;
$$;

create trigger submissions_sync_references
  after insert or update of reference_urls on public.submissions
  for each row execute function public.sync_submission_references();

create or replace function public.require_editorial_review_before_publish()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'published' and not exists (
    select 1 from public.editorial_reviews
    where submission_id = new.submission_id and decision = 'approved'
  ) then
    raise exception 'An approved editorial review is required before publication';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger articles_require_editorial_review
  before insert or update of status on public.articles
  for each row execute function public.require_editorial_review_before_publish();

create or replace function public.publish_submission(submission_id uuid)
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
    raise exception 'Editorial access is required to publish submissions';
  end if;

  select * into item
  from public.submissions
  where id = publish_submission.submission_id
  for update;
  if not found or item.status <> 'pending' then
    raise exception 'This submission is no longer awaiting review';
  end if;
  if exists (
    select 1 from public.submission_references
    where submission_references.submission_id = item.id
      and verification_status <> 'verified'
  ) then
    raise exception 'Verify every reference before publishing this submission';
  end if;
  if item.classification in ('FACT', 'RESEARCH', 'PREDICTION')
    and not exists (
      select 1 from public.submission_references
      where submission_references.submission_id = item.id
        and verification_status = 'verified'
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
    classification, hero_image_url, status, published_at
  ) values (
    item.id, item.author_id, item.category_id, item.title, article_slug, item.summary,
    coalesce(nullif(item.evidence, ''), item.summary), item.classification, item.hero_image_url,
    'published', now()
  )
  returning id into article_uuid;

  insert into public.sources (article_id, title, url, verification_status, verified_by, verified_at)
  select article_uuid, 'Reference ' || source.ordinality, source.url,
    source.verification_status, source.verified_by, source.verified_at
  from public.submission_references as source
  where source.submission_id = item.id;

  update public.submissions set status = 'published', updated_at = now() where id = item.id;
  insert into public.notifications (user_id, article_id, kind, title, message)
  values (item.author_id, article_uuid, 'submission_published', 'Your idea is now published', 'An editor reviewed your submission and published it as a field note.');

  return article_uuid;
end;
$$;

create or replace function public.set_profile_role(target_profile_id uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if coalesce(public.current_user_role(), '') <> 'administrator' then
    raise exception 'Administrator access is required to manage account roles';
  end if;
  if target_profile_id = (select auth.uid()) then
    raise exception 'You cannot change your own account role';
  end if;
  if new_role not in ('member', 'contributor', 'editor', 'administrator') then
    raise exception 'The requested account role is not valid';
  end if;
  update public.profiles set role = new_role where id = target_profile_id;
  if not found then
    raise exception 'The requested profile does not exist';
  end if;
end;
$$;

create or replace function public.get_article_reaction_counts(p_article_id uuid)
returns table (reaction text, count bigint)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select r.reaction, count(*)
  from public.reactions as r
  join public.articles as a on a.id = r.article_id
  where r.article_id = p_article_id and a.status = 'published'
  group by r.reaction
$$;

create or replace function public.reject_submission(submission_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  item public.submissions%rowtype;
begin
  if not public.is_editor() then
    raise exception 'Editorial access is required to review submissions';
  end if;

  select * into item
  from public.submissions
  where id = reject_submission.submission_id
  for update;
  if not found or item.status <> 'pending' then
    raise exception 'This submission is no longer awaiting review';
  end if;

  insert into public.editorial_reviews (submission_id, reviewer_id, decision)
  values (item.id, (select auth.uid()), 'returned');
  update public.submissions set status = 'rejected', updated_at = now() where id = item.id;
  insert into public.notifications (user_id, kind, title, message)
  values (item.author_id, 'submission_returned', 'Your idea needs another look', 'An editor reviewed your submission. Sign in to view its review status and next steps.');
end;
$$;

revoke all on function public.current_user_role() from public, anon;
revoke all on function public.is_editor() from public, anon;
revoke all on function public.publish_submission(uuid) from public, anon;
revoke all on function public.reject_submission(uuid) from public, anon;
revoke all on function public.set_profile_role(uuid, text) from public, anon;
revoke all on function public.get_article_reaction_counts(uuid) from public;
grant execute on function public.current_user_role() to anon, authenticated;
grant execute on function public.is_editor() to anon, authenticated;
grant execute on function public.publish_submission(uuid) to authenticated;
grant execute on function public.reject_submission(uuid) to authenticated;
grant execute on function public.set_profile_role(uuid, text) to authenticated;
grant execute on function public.get_article_reaction_counts(uuid) to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.submissions enable row level security;
alter table public.editorial_reviews enable row level security;
alter table public.submission_references enable row level security;
alter table public.articles enable row level security;
alter table public.sources enable row level security;
alter table public.comments enable row level security;
alter table public.reactions enable row level security;
alter table public.bookmarks enable row level security;
alter table public.notifications enable row level security;

create policy "Profiles are publicly readable"
  on public.profiles for select using (true);
create policy "Members update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) or public.current_user_role() = 'administrator')
  with check (id = (select auth.uid()) or public.current_user_role() = 'administrator');

create policy "Active categories are public"
  on public.categories for select using (is_active or public.is_editor());
create policy "Editors manage categories"
  on public.categories for all to authenticated
  using (public.is_editor()) with check (public.is_editor());

create policy "Members view their submissions and editors view all"
  on public.submissions for select to authenticated
  using (author_id = (select auth.uid()) or public.is_editor());
create policy "Members submit their own ideas for review"
  on public.submissions for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and status = 'pending'
    and exists (select 1 from public.categories where id = category_id and is_active)
  );
create policy "Editors update submissions"
  on public.submissions for update to authenticated
  using (public.is_editor()) with check (public.is_editor());

create policy "Editors read editorial reviews"
  on public.editorial_reviews for select to authenticated
  using (public.is_editor());

create policy "Editors verify submission references"
  on public.submission_references for select to authenticated
  using (public.is_editor());
create policy "Editors update reference verification"
  on public.submission_references for update to authenticated
  using (public.is_editor()) with check (public.is_editor());

create policy "Published articles and editorial workspace are readable"
  on public.articles for select
  using (status = 'published' or public.is_editor());
create policy "Editors create articles"
  on public.articles for insert to authenticated
  with check (public.is_editor());
create policy "Editors update articles"
  on public.articles for update to authenticated
  using (public.is_editor()) with check (public.is_editor());
create policy "Administrators archive articles"
  on public.articles for delete to authenticated
  using (public.current_user_role() = 'administrator');

create policy "Sources follow article visibility"
  on public.sources for select
  using (exists (
    select 1 from public.articles
    where articles.id = article_id and (articles.status = 'published' or public.is_editor())
  ));
create policy "Editors manage sources"
  on public.sources for all to authenticated
  using (public.is_editor()) with check (public.is_editor());

create policy "Visible comments, own comments, and moderation are readable"
  on public.comments for select
  using (status = 'visible' or author_id = (select auth.uid()) or public.is_editor());
create policy "Members comment on published articles"
  on public.comments for insert to authenticated
  with check (
    author_id = (select auth.uid()) and status = 'visible'
    and exists (select 1 from public.articles where id = article_id and status = 'published')
  );
create policy "Authors and editors moderate comments"
  on public.comments for update to authenticated
  using (author_id = (select auth.uid()) or public.is_editor())
  with check (author_id = (select auth.uid()) or public.is_editor());
create policy "Authors or editors remove comments"
  on public.comments for delete to authenticated
  using (author_id = (select auth.uid()) or public.is_editor());

create policy "Members view their reactions and editors view all"
  on public.reactions for select to authenticated
  using (user_id = (select auth.uid()) or public.is_editor());
create policy "Members add reactions"
  on public.reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.articles where id = article_id and status = 'published')
  );
create policy "Members remove their reactions"
  on public.reactions for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "Members manage their bookmarks"
  on public.bookmarks for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.articles where id = article_id and status = 'published')
  );

create policy "Members view and update their notifications"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Members mark their notifications read"
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.categories, public.articles, public.sources, public.comments to anon, authenticated;
grant select on public.reactions to authenticated;
grant update on public.profiles to authenticated;
grant insert, update, delete on public.categories, public.articles, public.sources, public.comments to authenticated;
grant select, insert, update on public.submissions to authenticated;
grant select on public.editorial_reviews, public.submission_references to authenticated;
grant update on public.submission_references to authenticated;
grant insert, update, delete on public.reactions, public.bookmarks to authenticated;
grant select on public.bookmarks to authenticated;
grant select, update on public.notifications to authenticated;
