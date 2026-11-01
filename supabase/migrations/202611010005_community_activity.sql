create index if not exists reactions_recent_idx
  on public.reactions (created_at desc, article_id);

create index if not exists comments_visible_recent_idx
  on public.comments (created_at desc)
  where status = 'visible';

create or replace function public.get_community_highlights()
returns table (
  article_id uuid,
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
  recent_reactions bigint,
  recent_comments bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with recent_reactions as (
    select reactions.article_id, count(*) as count
    from public.reactions
    join public.articles on articles.id = reactions.article_id
    where articles.status = 'published'
      and reactions.created_at >= now() - interval '30 days'
    group by reactions.article_id
  ),
  recent_comments as (
    select comments.article_id, count(*) as count
    from public.comments
    join public.articles on articles.id = comments.article_id
    where articles.status = 'published'
      and comments.status = 'visible'
      and comments.created_at >= now() - interval '30 days'
    group by comments.article_id
  )
  select
    articles.id,
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
    coalesce(recent_reactions.count, 0),
    coalesce(recent_comments.count, 0)
  from public.articles
  join public.profiles on profiles.id = articles.author_id
  join public.categories on categories.id = articles.category_id
  left join recent_reactions on recent_reactions.article_id = articles.id
  left join recent_comments on recent_comments.article_id = articles.id
  where articles.status = 'published'
    and (recent_reactions.count is not null or recent_comments.count is not null)
  order by
    coalesce(recent_reactions.count, 0) + coalesce(recent_comments.count, 0) desc,
    articles.published_at desc
  limit 6;
$$;

revoke all on function public.get_community_highlights() from public;
grant execute on function public.get_community_highlights() to anon, authenticated;

create or replace function public.get_community_stats()
returns table (
  published_notes bigint,
  visible_conversations bigint,
  published_contributors bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    (select count(*) from public.articles where status = 'published'),
    (select count(*) from public.comments
      join public.articles on articles.id = comments.article_id
      where articles.status = 'published' and comments.status = 'visible'),
    (select count(distinct author_id) from public.articles where status = 'published');
$$;

revoke all on function public.get_community_stats() from public;
grant execute on function public.get_community_stats() to anon, authenticated;
