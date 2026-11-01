alter table public.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in (
      'submission_approved',
      'submission_published',
      'submission_returned',
      'editorial_update',
      'comment_report_resolved',
      'comment_moderated'
    ));

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
  comment_row public.comments%rowtype;
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

  select * into comment_row
  from public.comments
  where id = report_row.comment_id
  for update;
  if not found then
    raise exception 'The reported comment is no longer available';
  end if;

  if p_decision in ('hide', 'remove') then
    update public.comments
    set status = case when p_decision = 'hide' then 'hidden' else 'removed' end,
        updated_at = now()
    where id = comment_row.id;
  end if;

  next_status := case when p_decision = 'dismiss' then 'dismissed' else 'action_taken' end;
  update public.comment_reports
  set status = next_status,
      resolution_note = note,
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = report_row.id;

  insert into public.notifications (user_id, article_id, kind, title, message)
  values (
    report_row.reporter_id,
    comment_row.article_id,
    'comment_report_resolved',
    'Your comment report was reviewed',
    case
      when p_decision = 'dismiss' then 'An editor reviewed your report and decided no moderation action was needed.'
      when p_decision = 'hide' then 'An editor reviewed your report and hid the comment.'
      else 'An editor reviewed your report and removed the comment.'
    end
  );

  if p_decision in ('hide', 'remove') and comment_row.author_id <> report_row.reporter_id then
    insert into public.notifications (user_id, article_id, kind, title, message)
    values (
      comment_row.author_id,
      comment_row.article_id,
      'comment_moderated',
      'A comment you wrote was moderated',
      case
        when p_decision = 'hide' then 'An editor hid your comment after review. Please follow the community guidelines in future discussions.'
        else 'An editor removed your comment after review. Please follow the community guidelines in future discussions.'
      end
    );
  end if;
end;
$$;

revoke all on function public.resolve_comment_report(uuid, text, text) from public, anon;
grant execute on function public.resolve_comment_report(uuid, text, text) to authenticated;
