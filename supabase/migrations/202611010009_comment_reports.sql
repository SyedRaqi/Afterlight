create table public.comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments (id) on delete restrict,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (reason in ('spam', 'harassment', 'misinformation', 'personal_information', 'off_topic', 'other')),
  details text check (details is null or char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'dismissed', 'action_taken')),
  resolution_note text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (comment_id, reporter_id),
  check (
    (status = 'open' and resolution_note is null and reviewed_by is null and reviewed_at is null)
    or (status <> 'open' and char_length(btrim(coalesce(resolution_note, ''))) >= 10 and reviewed_by is not null and reviewed_at is not null)
  )
);

create index comment_reports_open_created_idx
  on public.comment_reports (created_at)
  where status = 'open';

alter table public.comment_reports enable row level security;

create policy "Reporters and editors read comment reports"
  on public.comment_reports for select to authenticated
  using (reporter_id = (select auth.uid()) or public.is_editor());

create policy "Members report other visible comments"
  on public.comment_reports for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and exists (
      select 1
      from public.comments
      join public.articles on articles.id = comments.article_id
      where comments.id = comment_reports.comment_id
        and comments.status = 'visible'
        and comments.author_id <> (select auth.uid())
        and articles.status = 'published'
    )
  );

revoke all on public.comment_reports from public, anon, authenticated;
grant select (
  id,
  comment_id,
  reporter_id,
  reason,
  details,
  status,
  resolution_note,
  reviewed_by,
  reviewed_at,
  created_at
) on public.comment_reports to authenticated;
grant insert (comment_id, reporter_id, reason, details) on public.comment_reports to authenticated;

create or replace function public.resolve_comment_report(
  p_report_id uuid,
  p_decision text,
  p_resolution_note text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report_row public.comment_reports%rowtype;
  next_status text;
  note text := btrim(coalesce(p_resolution_note, ''));
begin
  if not public.is_editor() then
    raise exception 'Editorial access is required to resolve community reports';
  end if;
  if p_decision is null or p_decision not in ('dismiss', 'hide', 'remove') then
    raise exception 'Choose dismiss, hide, or remove';
  end if;
  if char_length(note) not between 10 and 1000 then
    raise exception 'Add a resolution note between 10 and 1000 characters';
  end if;

  select * into report_row
  from public.comment_reports
  where id = p_report_id
  for update;
  if not found or report_row.status <> 'open' then
    raise exception 'This report is no longer open';
  end if;

  if p_decision in ('hide', 'remove') then
    update public.comments
    set status = case when p_decision = 'hide' then 'hidden' else 'removed' end,
        updated_at = now()
    where id = report_row.comment_id;
  end if;

  next_status := case when p_decision = 'dismiss' then 'dismissed' else 'action_taken' end;
  update public.comment_reports
  set status = next_status,
      resolution_note = note,
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = report_row.id;
end;
$$;

revoke all on function public.resolve_comment_report(uuid, text, text) from public, anon;
grant execute on function public.resolve_comment_report(uuid, text, text) to authenticated;
