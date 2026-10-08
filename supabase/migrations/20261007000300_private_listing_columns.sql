-- Public/authenticated listing reads must not reveal owner or private-location IDs.
revoke select (owner_id, location_id) on public.listings from authenticated;
revoke insert (owner_id) on public.listings from authenticated;
revoke select (owner_id) on public.listing_images from authenticated;

create or replace function public.prepare_homiva_listing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to create a listing';
  end if;
  new.owner_id := auth.uid();
  return new;
end;
$$;
create trigger listings_prepare_owner before insert on public.listings
for each row execute function public.prepare_homiva_listing();

-- The function returns private columns only for rows belonging to auth.uid().
create or replace function public.get_my_listings(p_listing_id uuid default null)
returns setof public.listings
language sql
stable
security definer
set search_path = ''
as $$
  select l.*
    from public.listings as l
   where l.owner_id = auth.uid()
     and (p_listing_id is null or l.id = p_listing_id);
$$;
revoke all on function public.get_my_listings(uuid) from public, anon;
grant execute on function public.get_my_listings(uuid) to authenticated;
