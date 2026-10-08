-- Keep authenticated direct-to-Storage uploads bounded without a service-role key.
create table public.listing_upload_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  hour_started_at timestamptz not null,
  hour_count integer not null check (hour_count >= 0),
  day_started_at date not null,
  day_count integer not null check (day_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.listing_upload_limits enable row level security;
revoke all on public.listing_upload_limits from public, anon, authenticated;
grant select, insert, update, delete on public.listing_upload_limits to service_role;

create or replace function public.consume_my_listing_upload()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_hour timestamptz := date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC';
  v_day date := (now() at time zone 'UTC')::date;
  v_hour_count integer;
  v_day_count integer;
begin
  if v_user_id is null then
    return false;
  end if;

  insert into public.listing_upload_limits as limits
    (user_id, hour_started_at, hour_count, day_started_at, day_count, updated_at)
  values (v_user_id, v_hour, 1, v_day, 1, v_now)
  on conflict (user_id) do update
    set hour_started_at = excluded.hour_started_at,
        hour_count = case
          when limits.hour_started_at = excluded.hour_started_at
            then limits.hour_count + 1
          else 1
        end,
        day_started_at = excluded.day_started_at,
        day_count = case
          when limits.day_started_at = excluded.day_started_at
            then limits.day_count + 1
          else 1
        end,
        updated_at = excluded.updated_at
  returning hour_count, day_count into v_hour_count, v_day_count;

  return v_hour_count <= 10 and v_day_count <= 30;
end;
$$;

revoke all on function public.consume_my_listing_upload() from public, anon, authenticated;
