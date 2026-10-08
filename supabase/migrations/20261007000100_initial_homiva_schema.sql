-- HOMIVA production schema. Every browser-accessible table has RLS enabled.

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 80),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.create_profile_for_auth_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'HOMIVA member'))
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created_profile after insert on auth.users
for each row execute function public.create_profile_for_auth_user();

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  address_line1 text check (address_line1 is null or char_length(address_line1) <= 160),
  postal_code text check (postal_code is null or char_length(postal_code) <= 24),
  country_code text not null default 'IN' check (country_code ~ '^[A-Z]{2}$'),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null))
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  location_id uuid references public.locations (id) on delete set null,
  title text not null check (char_length(title) between 5 and 100),
  description text not null default '' check (char_length(description) <= 1200),
  property_type text not null default 'Apartment' check (property_type in ('Apartment', 'House', 'Room', 'Studio')),
  city text not null check (char_length(city) between 2 and 70),
  locality text not null check (char_length(locality) between 2 and 70),
  country_code text not null default 'IN' check (country_code ~ '^[A-Z]{2}$'),
  currency_code text not null default 'INR' check (currency_code ~ '^[A-Z]{3}$'),
  price numeric(14,2) not null check (price > 0),
  deposit numeric(14,2) check (deposit is null or deposit >= 0),
  maintenance numeric(14,2) check (maintenance is null or maintenance >= 0),
  utilities numeric(14,2) check (utilities is null or utilities >= 0),
  bedrooms smallint not null default 1 check (bedrooms between 0 and 20),
  bathrooms smallint not null default 1 check (bathrooms between 1 and 20),
  size_sqft integer check (size_sqft is null or size_sqft > 0),
  furnishing text not null default 'Unknown' check (furnishing in ('Furnished', 'Semi-furnished', 'Unfurnished', 'Unknown')),
  amenities text[] not null default '{}',
  availability_status text not null default 'available' check (availability_status in ('available', 'upcoming', 'unavailable')),
  available_from date,
  house_rules text check (house_rules is null or char_length(house_rules) <= 1200),
  contact_preference text not null default 'platform' check (contact_preference in ('platform', 'viewing', 'either')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  trust_status text not null default 'unverified' check (trust_status in ('unverified', 'pending', 'verified', 'rejected')),
  map_latitude double precision check (map_latitude is null or map_latitude between -90 and 90),
  map_longitude double precision check (map_longitude is null or map_longitude between -180 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((map_latitude is null) = (map_longitude is null))
);
create index listings_public_search_idx on public.listings (status, country_code, city, locality, price);
create index listings_owner_updated_idx on public.listings (owner_id, updated_at desc);
create index listings_bedrooms_idx on public.listings (bedrooms) where status = 'published';
create index listings_amenities_idx on public.listings using gin (amenities);
create index listings_available_idx on public.listings (availability_status, available_from) where status = 'published';
create index locations_owner_idx on public.locations (owner_id, created_at desc);

-- The public listing row contains only an approximate pin. Exact coordinates remain owner-only.
create or replace function public.set_public_listing_location()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_latitude double precision;
  v_longitude double precision;
begin
  if new.location_id is null then
    new.map_latitude := null;
    new.map_longitude := null;
    return new;
  end if;
  select l.latitude, l.longitude into v_latitude, v_longitude
    from public.locations as l
   where l.id = new.location_id and l.owner_id = new.owner_id;
  if not found then
    raise exception 'Location must belong to the listing owner';
  end if;
  if v_latitude is null then
    new.map_latitude := null;
    new.map_longitude := null;
  else
    new.map_latitude := round(v_latitude::numeric, 2)::double precision;
    new.map_longitude := round(v_longitude::numeric, 2)::double precision;
  end if;
  return new;
end;
$$;
create trigger listings_public_location_before_write
before insert or update of location_id, owner_id on public.listings
for each row execute function public.set_public_listing_location();

create table public.listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  object_path text not null unique check (object_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'),
  mime_type text not null default 'image/webp' check (mime_type = 'image/webp'),
  file_size_bytes integer not null check (file_size_bytes between 16 and 5242880),
  alt_text text not null default '' check (char_length(alt_text) <= 180),
  display_order smallint not null default 0 check (display_order between 0 and 19),
  created_at timestamptz not null default now(),
  unique (listing_id, display_order)
);
create index listing_images_owner_idx on public.listing_images (owner_id, listing_id);

create or replace function public.prepare_listing_image()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (storage.foldername(new.object_path))[1] <> auth.uid()::text then
    raise exception 'Photo path must belong to the signed-in owner';
  end if;
  select l.owner_id into new.owner_id from public.listings as l
   where l.id = new.listing_id and l.owner_id = auth.uid();
  if not found then
    raise exception 'Listing must belong to the signed-in owner';
  end if;
  if not exists (select 1 from storage.objects as o
    where o.bucket_id = 'listing-media' and o.name = new.object_path) then
    raise exception 'Photo upload is missing';
  end if;
  return new;
end;
$$;
create trigger listing_images_prepare_owner before insert on public.listing_images
for each row execute function public.prepare_listing_image();

create table public.favorites (
  user_id uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
create index favorites_listing_idx on public.favorites (listing_id, created_at desc);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete restrict,
  listing_title text not null default '',
  owner_id uuid not null references public.profiles (id) on delete restrict,
  renter_id uuid not null references public.profiles (id) on delete restrict,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (owner_id <> renter_id),
  unique (listing_id, owner_id, renter_id)
);
create index conversations_owner_idx on public.conversations (owner_id, last_message_at desc nulls last);
create index conversations_renter_idx on public.conversations (renter_id, last_message_at desc nulls last);

create or replace function public.prepare_homiva_conversation()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to start a conversation'; end if;
  new.renter_id := auth.uid();
  perform pg_advisory_xact_lock(hashtext(new.renter_id::text)::bigint);
  select l.owner_id, l.title into new.owner_id, new.listing_title from public.listings as l
   where l.id = new.listing_id and l.status = 'published';
  if not found or new.owner_id = auth.uid() then raise exception 'This home is not available for a conversation'; end if;
  if (select count(*) from public.conversations as c
      where c.renter_id = new.renter_id and c.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Conversation limit reached. Try again later';
  end if;
  new.created_at := now();
  new.updated_at := now();
  new.last_message_at := null;
  return new;
end;
$$;
create trigger conversations_prepare_title before insert on public.conversations
for each row execute function public.prepare_homiva_conversation();

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  member_role text not null check (member_role in ('owner', 'renter')),
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id, conversation_id);

create or replace function public.add_conversation_members()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.conversation_members (conversation_id, user_id, member_role)
  values (new.id, new.owner_id, 'owner'), (new.id, new.renter_id, 'renter');
  return new;
end;
$$;
create trigger conversations_add_members after insert on public.conversations
for each row execute function public.add_conversation_members();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete restrict default auth.uid(),
  sender_name text not null default '',
  sender_email text not null default '',
  body text not null check (char_length(body) between 4 and 1200),
  created_at timestamptz not null default now()
);
create index messages_conversation_created_idx on public.messages (conversation_id, created_at desc);
create index messages_sender_created_idx on public.messages (sender_id, created_at desc);

create or replace function public.prepare_homiva_message()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.sender_id := auth.uid();
  if new.sender_id is null then raise exception 'Sign in to send a message'; end if;
  perform pg_advisory_xact_lock(hashtext(new.sender_id::text)::bigint);
  if (select count(*) from public.messages as m
      where m.sender_id = new.sender_id and m.created_at > now() - interval '1 minute') >= 5 then
    raise exception 'Message limit reached. Wait a minute before sending another message';
  end if;
  select p.full_name into new.sender_name from public.profiles as p where p.id = new.sender_id;
  select u.email into new.sender_email from auth.users as u where u.id = new.sender_id;
  new.created_at := now();
  return new;
end;
$$;
create trigger messages_prepare_sender before insert on public.messages
for each row execute function public.prepare_homiva_message();

create or replace function public.update_conversation_activity()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.conversations
     set last_message_at = new.created_at, updated_at = now()
   where id = new.conversation_id;
  return new;
end;
$$;
create trigger messages_update_conversation after insert on public.messages
for each row execute function public.update_conversation_activity();

create table public.viewing_requests (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete restrict,
  listing_title text not null,
  owner_id uuid not null references public.profiles (id) on delete restrict,
  requester_id uuid not null references public.profiles (id) on delete restrict,
  requester_name text not null,
  requester_email text not null,
  preferred_date date not null,
  preferred_time text not null check (char_length(preferred_time) between 2 and 50),
  note text not null default '' check (char_length(note) <= 300),
  status text not null default 'requested' check (status in ('requested', 'accepted', 'declined', 'cancelled', 'rescheduled', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (owner_id <> requester_id)
);
create index viewing_requests_owner_date_idx on public.viewing_requests (owner_id, preferred_date, status);
create index viewing_requests_requester_date_idx on public.viewing_requests (requester_id, preferred_date desc);
create index viewing_requests_requester_created_idx on public.viewing_requests (requester_id, created_at desc);

create or replace function public.prepare_viewing_request()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_listing public.listings%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to request a viewing'; end if;
  select * into v_listing from public.listings where id = new.listing_id and status = 'published';
  if not found or v_listing.owner_id = auth.uid() then
    raise exception 'This home is not available for a viewing request';
  end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text)::bigint);
  if (select count(*) from public.viewing_requests as vr
      where vr.requester_id = auth.uid() and vr.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Viewing request limit reached. Try again later';
  end if;
  new.owner_id := v_listing.owner_id;
  new.requester_id := auth.uid();
  new.listing_title := v_listing.title;
  new.status := 'requested';
  select p.full_name into new.requester_name from public.profiles as p where p.id = auth.uid();
  select u.email into new.requester_email from auth.users as u where u.id = auth.uid();
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;
create trigger viewing_requests_prepare_parties before insert on public.viewing_requests
for each row execute function public.prepare_viewing_request();

create table public.verification_records (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete restrict,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  evidence_path text check (evidence_path is null or evidence_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-zA-Z0-9]{2,8}$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewer_id uuid references public.profiles (id) on delete set null,
  reviewer_note text check (reviewer_note is null or char_length(reviewer_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index verification_owner_idx on public.verification_records (owner_id, created_at desc);
create index verification_listing_status_idx on public.verification_records (listing_id, status);

create or replace function public.prepare_verification_record()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.owner_id := auth.uid();
  new.status := 'pending';
  new.reviewer_id := null;
  new.reviewer_note := null;
  if not exists (select 1 from public.listings as l where l.id = new.listing_id and l.owner_id = auth.uid()) then
    raise exception 'Listing must belong to the signed-in owner';
  end if;
  return new;
end;
$$;
create trigger verification_records_prepare_owner before insert on public.verification_records
for each row execute function public.prepare_verification_record();

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_type text not null check (event_type in ('message', 'viewing_request', 'viewing_update', 'verification_update')),
  conversation_id uuid references public.conversations (id) on delete cascade,
  viewing_request_id uuid references public.viewing_requests (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb check (octet_length(payload::text) <= 2000),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (not (conversation_id is not null and viewing_request_id is not null))
);
create index notifications_user_unread_idx on public.notifications (user_id, created_at desc) where read_at is null;

create or replace function public.notify_homiva_message()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_recipient uuid;
begin
  for v_recipient in
    select cm.user_id from public.conversation_members as cm
     where cm.conversation_id = new.conversation_id and cm.user_id <> new.sender_id
  loop
    insert into public.notifications (user_id, event_type, conversation_id, payload)
    values (v_recipient, 'message', new.conversation_id, jsonb_build_object('message_id', new.id));
  end loop;
  return new;
end;
$$;
create trigger messages_create_notifications after insert on public.messages
for each row execute function public.notify_homiva_message();

create or replace function public.notify_homiva_viewing_request()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications (user_id, event_type, viewing_request_id, payload)
  values (new.owner_id, 'viewing_request', new.id, jsonb_build_object('listing_id', new.listing_id));
  return new;
end;
$$;
create trigger viewing_requests_create_notifications after insert on public.viewing_requests
for each row execute function public.notify_homiva_viewing_request();

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger locations_updated_at before update on public.locations
for each row execute function public.set_updated_at();
create trigger listings_updated_at before update on public.listings
for each row execute function public.set_updated_at();
create trigger viewing_requests_updated_at before update on public.viewing_requests
for each row execute function public.set_updated_at();
create trigger verification_records_updated_at before update on public.verification_records
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.locations enable row level security;
alter table public.listings enable row level security;
alter table public.listing_images enable row level security;
alter table public.favorites enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.viewing_requests enable row level security;
alter table public.verification_records enable row level security;
alter table public.notifications enable row level security;

revoke all on public.profiles, public.locations, public.listings, public.listing_images,
  public.favorites, public.conversations, public.conversation_members, public.messages,
  public.viewing_requests, public.verification_records, public.notifications
  from anon, authenticated;

grant select (id, full_name, avatar_path, created_at, updated_at) on public.profiles to authenticated;
grant update (full_name, avatar_path) on public.profiles to authenticated;

grant select, insert, update, delete on public.locations to authenticated;
grant select (id, owner_id, location_id, title, description, property_type, city, locality,
  country_code, currency_code, price, deposit, maintenance, utilities, bedrooms, bathrooms,
  size_sqft, furnishing, amenities, availability_status, available_from, house_rules,
  contact_preference, status, trust_status, map_latitude, map_longitude, created_at, updated_at)
  on public.listings to authenticated;
grant select (id, title, description, property_type, city, locality, country_code, currency_code,
  price, deposit, maintenance, utilities, bedrooms, bathrooms, size_sqft, furnishing, amenities,
  availability_status, available_from, house_rules, contact_preference, status, trust_status,
  map_latitude, map_longitude, created_at, updated_at) on public.listings to anon;
grant insert (owner_id, location_id, title, description, property_type, city, locality,
  country_code, currency_code, price, deposit, maintenance, utilities, bedrooms, bathrooms,
  size_sqft, furnishing, amenities, availability_status, available_from, house_rules,
  contact_preference, status) on public.listings to authenticated;
grant update (location_id, title, description, property_type, city, locality, country_code,
  currency_code, price, deposit, maintenance, utilities, bedrooms, bathrooms, size_sqft,
  furnishing, amenities, availability_status, available_from, house_rules, contact_preference, status)
  on public.listings to authenticated;
grant delete on public.listings to authenticated;

grant select (id, listing_id, object_path, mime_type, file_size_bytes, alt_text, display_order, created_at)
  on public.listing_images to anon;
grant select (id, listing_id, owner_id, object_path, mime_type, file_size_bytes, alt_text, display_order, created_at)
  on public.listing_images to authenticated;
grant insert (listing_id, object_path, file_size_bytes, alt_text, display_order)
  on public.listing_images to authenticated;
grant update (object_path, file_size_bytes, alt_text, display_order)
  on public.listing_images to authenticated;
grant delete on public.listing_images to authenticated;

grant select, insert, delete on public.favorites to authenticated;
grant select on public.conversations to authenticated;
grant insert (listing_id) on public.conversations to authenticated;
grant select on public.conversation_members to authenticated;
grant update (last_read_at) on public.conversation_members to authenticated;
grant select on public.messages to authenticated;
grant insert (conversation_id, body) on public.messages to authenticated;
grant select on public.viewing_requests to authenticated;
grant insert (listing_id, preferred_date, preferred_time, note) on public.viewing_requests to authenticated;
grant update (status) on public.viewing_requests to authenticated;
grant select (id, listing_id, owner_id, evidence_path, status, reviewer_id, reviewer_note, created_at, updated_at)
  on public.verification_records to authenticated;
grant insert (listing_id, evidence_path) on public.verification_records to authenticated;
grant update (status, reviewer_id, reviewer_note) on public.verification_records to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy "profiles_read_self_or_conversation_participant" on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or exists (select 1 from public.conversations as c
    where (c.owner_id = profiles.id and c.renter_id = (select auth.uid()))
       or (c.renter_id = profiles.id and c.owner_id = (select auth.uid())))
);
create policy "profiles_update_self" on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "locations_owner_select" on public.locations for select to authenticated
using (owner_id = (select auth.uid()));
create policy "locations_owner_insert" on public.locations for insert to authenticated
with check (owner_id = (select auth.uid()));
create policy "locations_owner_update" on public.locations for update to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "locations_owner_delete" on public.locations for delete to authenticated
using (owner_id = (select auth.uid()));

create policy "listings_public_published_or_owner_select" on public.listings for select to anon, authenticated
using (status = 'published' or owner_id = (select auth.uid()));
create policy "listings_owner_insert_draft" on public.listings for insert to authenticated
with check (owner_id = (select auth.uid()) and status = 'draft' and trust_status = 'unverified');
create policy "listings_owner_update" on public.listings for update to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "listings_owner_delete" on public.listings for delete to authenticated
using (owner_id = (select auth.uid()));

create policy "listing_images_public_published" on public.listing_images for select to anon, authenticated
using (
  exists (select 1 from public.listings as l where l.id = listing_images.listing_id and l.status = 'published')
  or owner_id = (select auth.uid())
);
create policy "listing_images_owner_insert" on public.listing_images for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.listings as l
    where l.id = listing_images.listing_id and l.owner_id = (select auth.uid()))
);
create policy "listing_images_owner_update" on public.listing_images for update to authenticated
using (owner_id = (select auth.uid()))
with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.listings as l
    where l.id = listing_images.listing_id and l.owner_id = (select auth.uid()))
);
create policy "listing_images_owner_delete" on public.listing_images for delete to authenticated
using (owner_id = (select auth.uid()));

create policy "favorites_owner_select" on public.favorites for select to authenticated
using (user_id = (select auth.uid()));
create policy "favorites_owner_insert_published_listing" on public.favorites for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.listings as l
    where l.id = favorites.listing_id and l.status = 'published' and l.owner_id <> (select auth.uid()))
);
create policy "favorites_owner_delete" on public.favorites for delete to authenticated
using (user_id = (select auth.uid()));

create policy "conversation_participant_select" on public.conversations for select to authenticated
using (owner_id = (select auth.uid()) or renter_id = (select auth.uid()));
create policy "renter_starts_published_listing_conversation" on public.conversations for insert to authenticated
with check (
  renter_id = (select auth.uid()) and owner_id <> (select auth.uid())
  and exists (select 1 from public.listings as l
    where l.id = conversations.listing_id and l.owner_id = conversations.owner_id and l.status = 'published')
);
create policy "conversation_member_read_self" on public.conversation_members for select to authenticated
using (user_id = (select auth.uid()));
create policy "conversation_member_update_self_read_state" on public.conversation_members for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "conversation_participants_read_messages" on public.messages for select to authenticated
using (exists (select 1 from public.conversation_members as cm
  where cm.conversation_id = messages.conversation_id and cm.user_id = (select auth.uid())));
create policy "conversation_participants_send_messages" on public.messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (select 1 from public.conversation_members as cm
    where cm.conversation_id = messages.conversation_id and cm.user_id = (select auth.uid()))
);

create policy "viewing_participant_select" on public.viewing_requests for select to authenticated
using (owner_id = (select auth.uid()) or requester_id = (select auth.uid()));
create policy "renter_requests_published_listing" on public.viewing_requests for insert to authenticated
with check (
  requester_id = (select auth.uid()) and status = 'requested'
  and exists (select 1 from public.listings as l
    where l.id = viewing_requests.listing_id and l.owner_id = viewing_requests.owner_id
      and l.status = 'published' and l.owner_id <> (select auth.uid()))
);
create policy "renter_cancels_requested_viewing" on public.viewing_requests for update to authenticated
using (requester_id = (select auth.uid()) and status = 'requested')
with check (requester_id = (select auth.uid()) and status = 'cancelled');
create policy "owner_decides_requested_viewing" on public.viewing_requests for update to authenticated
using (owner_id = (select auth.uid()) and status = 'requested')
with check (owner_id = (select auth.uid()) and status in ('accepted', 'declined'));

create policy "verification_owner_or_reviewer_select" on public.verification_records for select to authenticated
using (owner_id = (select auth.uid()) or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "owner_submits_verification" on public.verification_records for insert to authenticated
with check (
  owner_id = (select auth.uid()) and status = 'pending'
  and exists (select 1 from public.listings as l
    where l.id = verification_records.listing_id and l.owner_id = (select auth.uid()))
);
create policy "admin_reviews_verification" on public.verification_records for update to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "notifications_read_self" on public.notifications for select to authenticated
using (user_id = (select auth.uid()));
create policy "notifications_mark_self_read" on public.notifications for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Private buckets: owners can read their own drafts; other users can read image objects
-- only when image metadata belongs to a published listing.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('listing-media', 'listing-media', false, 1500000, array['image/webp']),
  ('profile-media', 'profile-media', false, 5242880, array['image/webp', 'image/png', 'image/jpeg']),
  ('verification-evidence', 'verification-evidence', false, 10485760, array['image/webp', 'image/png', 'image/jpeg', 'application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "listing_media_read_owner_or_published" on storage.objects for select to anon, authenticated
using (
  bucket_id = 'listing-media'
  and (
    (select auth.uid())::text = (storage.foldername(name))[1]
    or exists (select 1 from public.listing_images as li
      join public.listings as l on l.id = li.listing_id
      where li.object_path = storage.objects.name and l.status = 'published')
  )
);
create policy "listing_media_delete_own_folder" on storage.objects for delete to authenticated
using (bucket_id = 'listing-media' and (select auth.uid())::text = (storage.foldername(name))[1]);

create policy "profile_media_read_own_folder" on storage.objects for select to authenticated
using (bucket_id = 'profile-media' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "profile_media_upload_own_folder" on storage.objects for insert to authenticated
with check (bucket_id = 'profile-media' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "profile_media_update_own_folder" on storage.objects for update to authenticated
using (bucket_id = 'profile-media' and (select auth.uid())::text = (storage.foldername(name))[1])
with check (bucket_id = 'profile-media' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "profile_media_delete_own_folder" on storage.objects for delete to authenticated
using (bucket_id = 'profile-media' and (select auth.uid())::text = (storage.foldername(name))[1]);

create policy "verification_media_read_own_folder" on storage.objects for select to authenticated
using (
  bucket_id = 'verification-evidence'
  and (
    (select auth.uid())::text = (storage.foldername(name))[1]
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
);
create policy "verification_media_upload_own_folder" on storage.objects for insert to authenticated
with check (bucket_id = 'verification-evidence' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "verification_media_delete_own_folder" on storage.objects for delete to authenticated
using (bucket_id = 'verification-evidence' and (select auth.uid())::text = (storage.foldername(name))[1]);

alter publication supabase_realtime add table public.messages;

revoke all on storage.objects from anon, authenticated;
grant select on storage.objects to anon, authenticated;
grant insert, update, delete on storage.objects to authenticated;

comment on table public.locations is 'Private address and precise coordinates; owner-only access.';
comment on column public.listings.map_latitude is 'Intentionally public approximate latitude rounded to two decimal places.';
comment on column public.listings.map_longitude is 'Intentionally public approximate longitude rounded to two decimal places.';
comment on table public.verification_records is 'Approval requires trusted app_metadata role=admin; no client can approve evidence.';
