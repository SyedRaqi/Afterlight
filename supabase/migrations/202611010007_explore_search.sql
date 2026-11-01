alter table public.articles
  add column search_document tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(introduction, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(background, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(current_understanding, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(future_possibilities, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(limitations, '')), 'C')
  ) stored;

create index articles_published_search_idx
  on public.articles using gin (search_document)
  where status = 'published';

create or replace function public.search_published_articles(
  p_query text default '',
  p_category text default null,
  p_classification text default null,
  p_sort text default 'newest',
  p_offset integer default 0,
  p_page_size integer default 12
)
returns table (
  article_id uuid,
  author_id uuid,
  title text,
  slug text,
  summary text,
  classification text,
  published_at timestamptz,
  reading_minutes integer,
  hero_image_url text,
  author_name text,
  author_avatar_url text,
  category_name text,
  category_slug text,
  total_count bigint
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  normalized_query text := left(btrim(coalesce(p_query, '')), 200);
  search_terms tsquery;
begin
  if coalesce(p_sort, '') not in ('newest', 'oldest', 'title', 'relevance') then
    raise exception 'Choose a supported sort order';
  end if;
  if p_classification is not null
    and p_classification not in ('FACT', 'RESEARCH', 'PREDICTION', 'POSSIBILITY', 'IMAGINATION') then
    raise exception 'Choose a supported classification';
  end if;

  search_terms := websearch_to_tsquery('english', normalized_query);

  return query
  select
    articles.id,
    articles.author_id,
    articles.title,
    articles.slug,
    articles.summary,
    articles.classification,
    articles.published_at,
    articles.reading_minutes,
    articles.hero_image_url,
    profiles.display_name,
    profiles.avatar_url,
    categories.name,
    categories.slug,
    count(*) over ()
  from public.articles
  join public.profiles on profiles.id = articles.author_id
  join public.categories on categories.id = articles.category_id
  where articles.status = 'published'
    and categories.is_active
    and (p_category is null or categories.slug = p_category or categories.name = p_category)
    and (p_classification is null or articles.classification = p_classification)
    and (
      normalized_query = ''
      or articles.search_document @@ search_terms
    )
  order by
    case when p_sort = 'relevance' and normalized_query <> ''
      then ts_rank_cd(articles.search_document, search_terms) end desc nulls last,
    case when p_sort = 'oldest' then articles.published_at end asc nulls last,
    case when p_sort = 'title' then lower(articles.title) end asc nulls last,
    case when p_sort in ('newest', 'relevance') then articles.published_at end desc nulls last,
    articles.id asc
  offset greatest(0, least(coalesce(p_offset, 0), 10000))
  limit greatest(1, least(coalesce(p_page_size, 12), 48));
end;
$$;

revoke all on function public.search_published_articles(text, text, text, text, integer, integer) from public;
grant execute on function public.search_published_articles(text, text, text, text, integer, integer) to anon, authenticated;
