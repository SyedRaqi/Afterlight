alter table public.articles
  add column change_note text;

create table public.article_revisions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles (id) on delete restrict,
  revision_number integer not null check (revision_number > 0),
  editor_id uuid references public.profiles (id) on delete set null,
  change_note text not null check (char_length(change_note) between 20 and 500),
  title text not null,
  summary text not null,
  body text not null,
  introduction text,
  background text,
  current_understanding text,
  future_possibilities text,
  limitations text,
  classification text not null check (classification in ('FACT', 'RESEARCH', 'PREDICTION', 'POSSIBILITY', 'IMAGINATION')),
  category_id uuid references public.categories (id) on delete set null,
  category_name text not null,
  hero_image_url text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (article_id, revision_number)
);

create index article_revisions_article_idx
  on public.article_revisions (article_id, revision_number desc);

alter table public.article_revisions enable row level security;

create policy "Readers see revisions of published articles and editors see all"
  on public.article_revisions for select to anon, authenticated
  using (
    exists (
      select 1 from public.articles
      where articles.id = article_revisions.article_id
        and (articles.status = 'published' or public.is_editor())
    )
  );

revoke all on public.article_revisions from public, anon, authenticated;
grant select (
  id,
  article_id,
  revision_number,
  change_note,
  title,
  summary,
  body,
  introduction,
  background,
  current_understanding,
  future_possibilities,
  limitations,
  classification,
  category_id,
  category_name,
  hero_image_url,
  published_at,
  created_at
) on public.article_revisions to anon, authenticated;

create or replace function public.capture_published_article_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  revision_note text;
  next_revision_number integer;
  previous_category_name text;
  editor_uuid uuid := (select auth.uid());
begin
  if old.status = 'published' and new.status = 'published' and (
    old.title is distinct from new.title
    or old.summary is distinct from new.summary
    or old.body is distinct from new.body
    or old.introduction is distinct from new.introduction
    or old.background is distinct from new.background
    or old.current_understanding is distinct from new.current_understanding
    or old.future_possibilities is distinct from new.future_possibilities
    or old.limitations is distinct from new.limitations
    or old.classification is distinct from new.classification
    or old.category_id is distinct from new.category_id
    or old.hero_image_url is distinct from new.hero_image_url
  ) then
    revision_note := btrim(coalesce(new.change_note, ''));
    if char_length(revision_note) not between 20 and 500 then
      raise exception 'Add a change note between 20 and 500 characters before updating a published article';
    end if;
    if editor_uuid is null or not public.is_editor() then
      raise exception 'An authenticated editor must make and document published article changes';
    end if;

    select name into previous_category_name
    from public.categories
    where id = old.category_id;

    select coalesce(max(revision_number), 0) + 1 into next_revision_number
    from public.article_revisions
    where article_id = old.id;

    insert into public.article_revisions (
      article_id,
      revision_number,
      editor_id,
      change_note,
      title,
      summary,
      body,
      introduction,
      background,
      current_understanding,
      future_possibilities,
      limitations,
      classification,
      category_id,
      category_name,
      hero_image_url,
      published_at
    ) values (
      old.id,
      next_revision_number,
      editor_uuid,
      revision_note,
      old.title,
      old.summary,
      old.body,
      old.introduction,
      old.background,
      old.current_understanding,
      old.future_possibilities,
      old.limitations,
      old.classification,
      old.category_id,
      coalesce(previous_category_name, 'Uncategorized'),
      old.hero_image_url,
      old.published_at
    );
  end if;

  new.change_note := null;
  return new;
end;
$$;

revoke all on function public.capture_published_article_revision() from public, anon, authenticated;

create trigger articles_capture_published_revision
  before update on public.articles
  for each row execute function public.capture_published_article_revision();
