CREATE INDEX IF NOT EXISTS article_revisions_category_id_idx
ON public.article_revisions (category_id);

CREATE INDEX IF NOT EXISTS article_revisions_editor_id_idx
ON public.article_revisions (editor_id);

CREATE INDEX IF NOT EXISTS comment_reports_reporter_id_idx
ON public.comment_reports (reporter_id);

CREATE INDEX IF NOT EXISTS comment_reports_reviewed_by_idx
ON public.comment_reports (reviewed_by);

CREATE INDEX IF NOT EXISTS comments_author_id_idx
ON public.comments (author_id);

CREATE INDEX IF NOT EXISTS editorial_reviews_reviewer_id_idx
ON public.editorial_reviews (reviewer_id);

CREATE INDEX IF NOT EXISTS editorial_reviews_submission_id_idx
ON public.editorial_reviews (submission_id);

CREATE INDEX IF NOT EXISTS notifications_article_id_idx
ON public.notifications (article_id);

CREATE INDEX IF NOT EXISTS reactions_user_id_idx
ON public.reactions (user_id);

CREATE INDEX IF NOT EXISTS sources_verified_by_idx
ON public.sources (verified_by);

CREATE INDEX IF NOT EXISTS submission_references_verified_by_idx
ON public.submission_references (verified_by);

CREATE INDEX IF NOT EXISTS submissions_category_id_idx
ON public.submissions (category_id);
