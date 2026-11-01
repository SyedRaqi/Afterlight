create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.assistant_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count between 1 and 10)
);

alter table private.assistant_rate_limits enable row level security;
revoke all on private.assistant_rate_limits from public, anon, authenticated;

create or replace function public.consume_assistant_request()
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  requester_id uuid := auth.uid();
  allowed boolean;
begin
  if requester_id is null then
    raise exception 'Sign in to use the research assistant';
  end if;

  insert into private.assistant_rate_limits (user_id)
  values (requester_id)
  on conflict (user_id) do update
  set window_started_at = case
        when private.assistant_rate_limits.window_started_at <= now() - interval '1 hour' then now()
        else private.assistant_rate_limits.window_started_at
      end,
      request_count = case
        when private.assistant_rate_limits.window_started_at <= now() - interval '1 hour' then 1
        else private.assistant_rate_limits.request_count + 1
      end
  where private.assistant_rate_limits.window_started_at <= now() - interval '1 hour'
     or private.assistant_rate_limits.request_count < 10
  returning true into allowed;

  return coalesce(allowed, false);
end;
$$;

revoke all on function public.consume_assistant_request() from public, anon;
grant execute on function public.consume_assistant_request() to authenticated;
