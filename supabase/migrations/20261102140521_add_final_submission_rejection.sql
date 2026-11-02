-- Keep return-for-changes and final rejection as distinct, auditable decisions.
alter table public.editorial_reviews
  drop constraint editorial_reviews_decision_check,
  add constraint editorial_reviews_decision_check
    check (decision in ('approved', 'returned', 'rejected'));

alter table public.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in (
      'submission_approved',
      'submission_published',
      'submission_returned',
      'submission_rejected',
      'editorial_update',
      'comment_report_resolved',
      'comment_moderated'
    ));

create or replace function public.reject_submission_final(
  submission_id uuid,
  rejection_notes text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  item public.submissions%rowtype;
  rejection_note text := btrim(coalesce(rejection_notes, ''));
begin
  if not public.is_editor() then
    raise exception 'Editorial access is required to reject submissions';
  end if;
  if char_length(rejection_note) not between 20 and 2000 then
    raise exception 'Provide a rejection explanation between 20 and 2000 characters';
  end if;

  select * into item
  from public.submissions
  where id = reject_submission_final.submission_id
  for update;
  if not found or item.status <> 'pending' then
    raise exception 'This submission is no longer awaiting review';
  end if;

  insert into public.editorial_reviews (submission_id, reviewer_id, decision, notes)
  values (item.id, (select auth.uid()), 'rejected', rejection_note);

  update public.submissions
  set status = 'rejected', updated_at = now()
  where id = item.id;

  insert into public.notifications (user_id, kind, title, message)
  values (
    item.author_id,
    'submission_rejected',
    'Your submission was declined',
    left(rejection_note, 500)
  );
end;
$$;

revoke all on function public.reject_submission_final(uuid, text) from public, anon;
grant execute on function public.reject_submission_final(uuid, text) to authenticated;

-- Direct editor table updates must not bypass the rejection explanation and
-- review audit entry enforced by the RPC.
create or replace function public.guard_final_submission_rejection()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'rejected' and old.status is distinct from new.status then
    if not public.is_editor()
      or not exists (
        select 1
        from public.editorial_reviews
        where submission_id = new.id
          and reviewer_id = (select auth.uid())
          and decision = 'rejected'
          and char_length(btrim(coalesce(notes, ''))) between 20 and 2000
      ) then
      raise exception 'Reject submissions through the audited editor action with a meaningful explanation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_final_submission_rejection() from public, anon, authenticated;

create trigger submissions_require_audited_final_rejection
  before update of status on public.submissions
  for each row execute function public.guard_final_submission_rejection();
