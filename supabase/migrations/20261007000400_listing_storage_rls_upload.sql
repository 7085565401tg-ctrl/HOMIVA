-- Authenticated clients upload directly with their user JWT. No service-role key is needed.
create policy "listing_media_upload_own_folder" on storage.objects for insert to authenticated
with check (
  bucket_id = 'listing-media'
  and (select auth.uid())::text = (storage.foldername(name))[1]
);

-- Enforce quota at the Storage boundary, including direct API clients that skip the UI.
create or replace function public.enforce_listing_media_upload_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.bucket_id <> 'listing-media' then
    return new;
  end if;

  if auth.uid() is null or (storage.foldername(new.name))[1] <> auth.uid()::text then
    raise exception 'Listing media must be uploaded to your own folder';
  end if;
  if not public.consume_my_listing_upload() then
    raise exception 'Photo upload limit reached. Try again later';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_listing_media_upload_quota() from public, anon, authenticated;

create trigger storage_objects_listing_media_quota
before insert on storage.objects
for each row execute function public.enforce_listing_media_upload_quota();
