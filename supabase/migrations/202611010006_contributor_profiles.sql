alter table public.profiles
  add column bio text,
  add constraint profiles_bio_length_check
    check (bio is null or char_length(bio) <= 280);

revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url, bio)
  on public.profiles to authenticated;
