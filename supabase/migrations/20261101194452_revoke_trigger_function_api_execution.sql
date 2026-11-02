REVOKE EXECUTE ON FUNCTION public.create_profile_for_new_user() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.guard_profile_role() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.sync_submission_references() FROM PUBLIC, anon, authenticated;