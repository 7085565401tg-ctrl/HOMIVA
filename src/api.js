import { requireSupabase, supabase } from './supabase.js';

const publicFields = 'id,title,description,property_type,city,locality,country_code,currency_code,price,deposit,maintenance,utilities,bedrooms,bathrooms,size_sqft,furnishing,amenities,availability_status,available_from,house_rules,contact_preference,status,trust_status,map_latitude,map_longitude,created_at,updated_at';
const imageRowFields = 'id,listing_id,object_path,mime_type,file_size_bytes,alt_text,display_order,created_at';
const imageFields = 'listing_images(' + imageRowFields + ')';
const uploadedBytes = new Map();

function fail(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return;
  if (error.code === '23505') throw new Error('That record already exists.');
  if (error.code === '42501' || error.code === 'PGRST301') throw new Error('You do not have permission to do that.');
  if (error.code === '23503') throw new Error('This record is still linked to saved activity and cannot be deleted.');
  const message = typeof error.message === 'string' && error.message.length < 300 ? error.message : fallback;
  throw new Error(message || fallback);
}

function unwrap(result, fallback) {
  fail(result.error, fallback);
  return result.data;
}

function parseBody(options) {
  if (!options.body) return {};
  try { return JSON.parse(options.body); } catch { return {}; }
}

function publicUser(authUser, profile) {
  if (!authUser) return null;
  return {
    id: authUser.id,
    name: profile?.full_name || authUser.user_metadata?.full_name || 'HOMIVA member',
    email: authUser.email || '',
    createdAt: authUser.created_at
  };
}

async function getCurrentUser() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getUser();
  if (error && error.name !== 'AuthSessionMissingError') fail(error, 'Your session could not be checked.');
  const authUser = data?.user;
  if (!authUser) return null;
  const result = await client.from('profiles').select('id,full_name').eq('id', authUser.id).maybeSingle();
  if (result.error) fail(result.error, 'Your profile could not be loaded.');
  return publicUser(authUser, result.data);
}

function safeSearchValue(value) {
  return String(value || '').trim().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').slice(0, 70);
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function statusTitle(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function signListingImages(rows) {
  const client = requireSupabase();
  const paths = rows.flatMap((row) => (row.listing_images || []).map((file) => file.object_path));
  if (!paths.length) return new Map();
  const result = await client.storage.from('listing-media').createSignedUrls(paths, 60 * 60 * 24);
  if (result.error) return new Map();
  return new Map((result.data || []).filter((file) => file.signedUrl).map((file) => [file.path, file.signedUrl]));
}

async function signedListing(row, isOwner = false, signedUrls = null) {
  const urls = signedUrls || await signListingImages([row]);
  const files = [...(row.listing_images || [])].sort((a, b) => a.display_order - b.display_order);
  const images = files.map((file) => ({ ...file, url: urls.get(file.object_path) || '' }));
  const exactPin = isOwner ? row.location : null;
  const locationPin = exactPin?.latitude != null && exactPin?.longitude != null
    ? { latitude: exactPin.latitude, longitude: exactPin.longitude }
    : row.map_latitude != null && row.map_longitude != null
      ? { latitude: row.map_latitude, longitude: row.map_longitude }
      : null;
  const firstImage = images.find((image) => image.url);
  return {
    id: row.id, ownerId: isOwner ? row.owner_id : undefined, owner: 'Property owner', isOwner,
    title: row.title, description: row.description, type: row.property_type, city: row.city,
    locality: row.locality, countryCode: row.country_code, currency: row.currency_code,
    price: Number(row.price), deposit: numberOrNull(row.deposit),
    maintenance: numberOrNull(row.maintenance), utilities: numberOrNull(row.utilities),
    bedrooms: row.bedrooms, bathrooms: row.bathrooms, size: row.size_sqft,
    furnishing: row.furnishing, amenities: row.amenities || [],
    address: isOwner ? exactPin?.address_line1 || '' : '',
    postalCode: isOwner ? exactPin?.postal_code || '' : '',
    availability: row.availability_status === 'available' ? 'Available now' : row.availability_status === 'upcoming' ? (row.available_from || 'Available soon') : 'Unavailable',
    availabilityStatus: row.availability_status, availableFrom: row.available_from,
    rules: row.house_rules || '', contactPreference: row.contact_preference,
    trust: statusTitle(row.trust_status), status: row.status,
    image: firstImage?.url || '', imagePath: firstImage?.object_path || '',
    images: images.filter((image) => image.url).map((image) => ({ path: image.object_path, url: image.url, alt: image.alt_text })),
    locationPin, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

async function signedListings(rows, isOwner = false) {
  const urls = await signListingImages(rows);
  return Promise.all(rows.map((row) => signedListing(row, isOwner, urls)));
}

function listingSelect() {
  return publicFields + ',' + imageFields;
}

async function getMyListings(listingId = null) {
  const client = requireSupabase();
  const result = await client.rpc('get_my_listings', { p_listing_id: listingId });
  return unwrap(result, 'Your listings could not be loaded.') || [];
}

async function hydrateOwnedListings(rows) {
  if (!rows.length) return [];
  const client = requireSupabase();
  const listingIds = rows.map((row) => row.id);
  const locationIds = rows.map((row) => row.location_id).filter(Boolean);
  const [imageResult, locationResult] = await Promise.all([
    client.from('listing_images').select(imageRowFields).in('listing_id', listingIds).order('display_order'),
    locationIds.length
      ? client.from('locations').select('id,address_line1,postal_code,latitude,longitude').in('id', locationIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  const imageRows = unwrap(imageResult, 'Listing photos could not be loaded.');
  const locationRows = unwrap(locationResult, 'Private map pins could not be loaded.');
  const imagesByListing = new Map();
  for (const image of imageRows) {
    if (!imagesByListing.has(image.listing_id)) imagesByListing.set(image.listing_id, []);
    imagesByListing.get(image.listing_id).push(image);
  }
  const locationsById = new Map(locationRows.map((location) => [location.id, location]));
  return rows.map((row) => ({
    ...row,
    listing_images: imagesByListing.get(row.id) || [],
    location: locationsById.get(row.location_id) || null
  }));
}

async function getListing(id) {
  const client = requireSupabase();
  const user = await getCurrentUser();
  const ownerRows = user ? await getMyListings(id) : [];
  if (ownerRows.length) {
    const rows = await hydrateOwnedListings(ownerRows);
    return { property: await signedListing(rows[0], true) };
  }
  const query = client.from('listings').select(listingSelect()).eq('id', id).eq('status', 'published');
  const result = await query.maybeSingle();
  if (result.error) fail(result.error, 'This home is not available.');
  if (!result.data) throw new Error('This home is not available.');
  return { property: await signedListing(result.data, false) };
}

async function listListings(url, offset = null) {
  const client = requireSupabase();
  const limit = Math.max(1, Math.min(24, Number(url.searchParams.get('limit')) || 24));
  const from = Math.max(0, Number(offset ?? url.searchParams.get('offset')) || 0);
  let query = client.from('listings').select(listingSelect(), { count: 'exact' }).eq('status', 'published');
  const city = safeSearchValue(url.searchParams.get('city'));
  const locality = safeSearchValue(url.searchParams.get('locality'));
  const maxBudget = numberOrNull(url.searchParams.get('maxBudget'));
  const minBudget = numberOrNull(url.searchParams.get('minBudget'));
  const bedrooms = numberOrNull(url.searchParams.get('bedrooms'));
  const bathrooms = numberOrNull(url.searchParams.get('bathrooms'));
  const furnishing = safeSearchValue(url.searchParams.get('furnishing'));
  const type = safeSearchValue(url.searchParams.get('type'));
  const availability = safeSearchValue(url.searchParams.get('availability'));
  const amenity = safeSearchValue(url.searchParams.get('amenity'));
  if (city) query = query.ilike('city', '%' + city + '%');
  if (locality) query = query.or('locality.ilike.%' + locality + '%,city.ilike.%' + locality + '%');
  if (maxBudget !== null && maxBudget > 0) query = query.lte('price', maxBudget);
  if (minBudget !== null && minBudget >= 0) query = query.gte('price', minBudget);
  if (bedrooms !== null && bedrooms > 0) query = bedrooms >= 3 ? query.gte('bedrooms', 3) : query.eq('bedrooms', bedrooms);
  if (bathrooms !== null && bathrooms > 0) query = query.gte('bathrooms', bathrooms);
  if (furnishing) query = query.eq('furnishing', furnishing);
  if (type) query = query.eq('property_type', type);
  if (availability) query = query.eq('availability_status', availability);
  if (amenity) query = query.contains('amenities', [amenity]);
  if (url.searchParams.get('parking') === 'true') query = query.contains('amenities', ['Parking']);
  const result = await query.order('price', { ascending: true }).order('created_at', { ascending: false }).range(from, from + limit - 1);
  const rows = unwrap(result, 'Homes could not be loaded.');
  const properties = await signedListings(rows, false);
  const total = result.count || 0;
  return { properties, total, hasMore: from + rows.length < total, nextOffset: from + rows.length };
}

async function listOwnedListings(user) {
  const rows = await getMyListings();
  rows.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  const hydrated = await hydrateOwnedListings(rows);
  return { properties: await signedListings(hydrated, true) };
}

async function saveListing(body, id = '') {
  const client = requireSupabase();
  const user = await getCurrentUser();
  if (!user) throw new Error('Please sign in to continue.');
  const oldRow = id ? (await getMyListings(id))[0] : null;
  if (id && !oldRow) throw new Error('We could not find that listing in your account.');
  const existingImageResult = id
    ? await client.from('listing_images').select('id,object_path,display_order,file_size_bytes').eq('listing_id', id).order('display_order')
    : { data: [], error: null };
  const existingImages = unwrap(existingImageResult, 'Listing photos could not be loaded.') || [];

  const latitude = numberOrNull(body.latitude);
  const longitude = numberOrNull(body.longitude);
  let locationId = oldRow?.location_id || null;
  const privateAddress = String(body.address || '').trim().slice(0, 160) || null;
  const hasPin = latitude !== null && longitude !== null;
  if (hasPin || privateAddress) {
    const locationRow = {
      owner_id: user.id, address_line1: privateAddress,
      country_code: String(body.countryCode || 'IN').toUpperCase(),
      latitude: hasPin ? latitude : null, longitude: hasPin ? longitude : null
    };
    if (locationId) {
      const updateLocation = await client.from('locations').update(locationRow).eq('id', locationId).eq('owner_id', user.id).select('id').single();
      locationId = unwrap(updateLocation, 'The map location could not be saved.').id;
    } else {
      const insertLocation = await client.from('locations').insert(locationRow).select('id').single();
      locationId = unwrap(insertLocation, 'The map location could not be saved.').id;
    }
  } else if (locationId) {
    const removedLocation = await client.from('locations').delete().eq('id', locationId).eq('owner_id', user.id);
    fail(removedLocation.error, 'The map location could not be removed.');
    locationId = null;
  }

  const payload = {
    location_id: locationId,
    title: String(body.title || '').trim(), description: String(body.description || '').trim(),
    property_type: body.type || 'Apartment', city: String(body.city || '').trim(),
    locality: String(body.locality || '').trim(), country_code: String(body.countryCode || 'IN').toUpperCase(),
    currency_code: String(body.currency || 'INR').toUpperCase(), price: numberOrNull(body.price),
    deposit: numberOrNull(body.deposit), maintenance: numberOrNull(body.maintenance), utilities: numberOrNull(body.utilities),
    bedrooms: numberOrNull(body.bedrooms) ?? 1, bathrooms: numberOrNull(body.bathrooms) ?? 1,
    size_sqft: numberOrNull(body.size), furnishing: body.furnishing || 'Unknown',
    amenities: Array.isArray(body.amenities) ? body.amenities.slice(0, 12) : [],
    availability_status: body.availabilityStatus || 'available', available_from: body.availableFrom || null,
    house_rules: String(body.rules || '').trim() || null, contact_preference: body.contactPreference || 'platform'
  };
  if (oldRow && ['published', 'draft', 'archived'].includes(body.status)) payload.status = body.status;

  const updatePayload = { ...payload };
  const write = id
    ? await client.from('listings').update(updatePayload).eq('id', id).select('id').single()
    : await client.from('listings').insert({ ...payload, status: 'draft' }).select('id').single();
  const listing = unwrap(write, 'Your listing could not be saved.');

  const oldPaths = existingImages.map((image) => image.object_path);
  const submittedImages = Array.isArray(body.images)
    ? body.images
    : body.imagePath || body.image ? [{ path: body.imagePath || body.image, alt: body.title }] : [];
  const nextImages = submittedImages.map((image) => ({
    path: String(image.path || '').trim(), alt: String(image.alt || body.title || '').trim().slice(0, 180)
  })).filter((image) => image.path);
  if (nextImages.length > 10 || nextImages.some((image) => !image.path.startsWith(user.id + '/'))) {
    throw new Error('Choose up to 10 photos from your HOMIVA account.');
  }
  const nextPaths = nextImages.map((image) => image.path);
  const sameImages = oldPaths.length === nextPaths.length && oldPaths.every((path, index) => path === nextPaths[index]);
  if (!sameImages) {
    if (existingImages.length) {
      const deleted = await client.from('listing_images').delete().eq('listing_id', listing.id);
      fail(deleted.error, 'The listing photos could not be updated.');
    }
    try {
      for (const [index, image] of nextImages.entries()) {
        const previous = existingImages.find((item) => item.object_path === image.path);
        const fileSize = uploadedBytes.get(image.path) || previous?.file_size_bytes || 16;
        const inserted = await client.from('listing_images').insert({
          listing_id: listing.id, object_path: image.path, file_size_bytes: fileSize,
          alt_text: image.alt, display_order: index
        });
        fail(inserted.error, 'A listing photo could not be attached.');
        uploadedBytes.delete(image.path);
      }
    } catch (error) {
      await client.from('listing_images').delete().eq('listing_id', listing.id);
      for (const [index, previous] of existingImages.entries()) {
        const restored = await client.from('listing_images').insert({
          listing_id: listing.id, object_path: previous.object_path,
          file_size_bytes: previous.file_size_bytes, alt_text: previous.alt_text || '',
          display_order: index
        });
        if (restored.error) fail(restored.error, 'The previous listing photos could not be restored.');
      }
      const newlyUploaded = nextPaths.filter((path) => !oldPaths.includes(path));
      if (newlyUploaded.length) {
        await client.storage.from('listing-media').remove(newlyUploaded);
        newlyUploaded.forEach((path) => uploadedBytes.delete(path));
      }
      throw error;
    }
    const removed = oldPaths.filter((path) => !nextPaths.includes(path));
    if (removed.length) fail((await client.storage.from('listing-media').remove(removed)).error, 'An old listing photo could not be removed.');
  }
  return await getListing(listing.id);
}

async function uploadListingImage(dataUrl) {
  const client = requireSupabase();
  const match = /^data:image\/webp;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl || ''));
  if (!match || match[1].length > 2_000_000) throw new Error('Choose a smaller or simpler photo.');
  const binary = atob(match[1]);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.byteLength < 16 || bytes.byteLength > 1_500_000 ||
    String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' ||
    String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP' ||
    view.getUint32(4, true) + 8 !== bytes.byteLength
  ) throw new Error('This image could not be checked. Choose another photo.');

  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user) throw new Error('Please sign in to continue.');
  const path = user.id + '/' + window.crypto.randomUUID() + '.webp';
  const result = await client.storage.from('listing-media').upload(path, bytes, {
    contentType: 'image/webp', cacheControl: '3600', upsert: false
  });
  fail(result.error, 'The photo could not be uploaded.');
  uploadedBytes.set(path, bytes.byteLength);
  return { path };
}

export async function discardListingUploads(paths) {
  const client = requireSupabase();
  const uploaded = [...new Set(paths || [])].filter((path) => uploadedBytes.has(path));
  if (!uploaded.length) return;
  const result = await client.storage.from('listing-media').remove(uploaded);
  fail(result.error, 'An unused listing photo could not be removed.');
  uploaded.forEach((path) => uploadedBytes.delete(path));
}

async function getSavedListings(user) {
  const client = requireSupabase();
  const result = await client.from('favorites')
    .select('listing_id,created_at,listings!inner(' + listingSelect() + ')')
    .eq('user_id', user.id).eq('listings.status', 'published').order('created_at', { ascending: false });
  const rows = unwrap(result, 'Your saved homes could not be loaded.');
  return { properties: await signedListings(rows.map((row) => row.listings), false) };
}

async function toggleSaved(id, body, user) {
  const client = requireSupabase();
  if (body.saved === true) {
    const result = await client.from('favorites').insert({ user_id: user.id, listing_id: id });
    fail(result.error, 'This home could not be saved.');
  } else {
    const result = await client.from('favorites').delete().eq('user_id', user.id).eq('listing_id', id);
    fail(result.error, 'This home could not be removed.');
  }
  const rows = await client.from('favorites').select('listing_id').eq('user_id', user.id);
  return { saved: unwrap(rows, 'Saved homes could not be refreshed.').map((row) => row.listing_id) };
}

async function listMessages(user) {
  const client = requireSupabase();
  const [messagesResult, membersResult] = await Promise.all([
    client.from('messages').select('id,conversation_id,sender_id,sender_name,sender_email,body,created_at,conversations!inner(id,listing_id,listing_title,owner_id,renter_id)').order('created_at', { ascending: false }),
    client.from('conversation_members').select('conversation_id,last_read_at').eq('user_id', user.id)
  ]);
  const rows = unwrap(messagesResult, 'Messages could not be loaded.');
  const members = new Map(unwrap(membersResult, 'Conversation state could not be loaded.').map((row) => [row.conversation_id, row.last_read_at]));
  const threads = new Map();
  for (const row of rows) {
    if (!threads.has(row.conversation_id)) threads.set(row.conversation_id, []);
    threads.get(row.conversation_id).push(row);
  }
  return { messages: [...threads.entries()].map(([conversationId, thread]) => {
    const latest = thread[0];
    const conversation = latest.conversations;
    const inbound = thread.find((row) => row.sender_id !== user.id);
    const lastRead = members.get(conversationId);
    return {
      id: latest.id, conversationId, propertyId: conversation.listing_id,
      propertyTitle: conversation.listing_title, name: inbound?.sender_name || latest.sender_name,
      email: inbound?.sender_email || latest.sender_email, message: latest.body, createdAt: latest.created_at,
      direction: conversation.owner_id === user.id ? 'received' : 'sent',
      unread: Boolean(inbound && (!lastRead || new Date(inbound.created_at) > new Date(lastRead)))
    };
  }) };
}

async function conversationThread(listingId, user) {
  const client = requireSupabase();
  const listing = unwrap(await client.from('listings').select('id,status').eq('id', listingId).eq('status', 'published').maybeSingle(), 'This home is no longer available.');
  if (!listing) throw new Error('This home is no longer available.');
  if ((await getMyListings(listing.id)).length) throw new Error('You cannot message yourself about your own listing.');
  const found = unwrap(await client.from('conversations').select('id,listing_id,owner_id,renter_id')
    .eq('listing_id', listing.id).eq('renter_id', user.id).maybeSingle());
  if (!found) return { conversation: null, messages: [] };
  const [messagesResult, readResult] = await Promise.all([
    client.from('messages').select('id,conversation_id,sender_id,sender_name,body,created_at').eq('conversation_id', found.id).order('created_at', { ascending: true }),
    client.from('conversation_members').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', found.id).eq('user_id', user.id)
  ]);
  const rows = unwrap(messagesResult, 'This conversation could not be loaded.');
  fail(readResult.error, 'The conversation read state could not be updated.');
  return { conversation: { id: found.id, listingId: found.listing_id }, messages: rows.map((row) => ({
    id: row.id, senderId: row.sender_id, name: row.sender_name, message: row.body,
    createdAt: row.created_at, direction: row.sender_id === user.id ? 'sent' : 'received'
  })) };
}

async function createMessage(body, user, conversationId = '') {
  const client = requireSupabase();
  let id = conversationId;
  if (!id) {
    const listingResult = await client.from('listings').select('id,status').eq('id', body.propertyId).eq('status', 'published').maybeSingle();
    const listing = unwrap(listingResult, 'This home is no longer available.');
    if (!listing) throw new Error('This home is no longer available.');
    if ((await getMyListings(listing.id)).length) throw new Error('You cannot message yourself about your own listing.');
    const existing = unwrap(await client.from('conversations').select('id').eq('listing_id', listing.id).eq('renter_id', user.id).maybeSingle());
    if (existing) id = existing.id;
    else {
      const created = await client.from('conversations').insert({ listing_id: listing.id }).select('id').single();
      if (created.error?.code === '23505') {
        id = unwrap(await client.from('conversations').select('id').eq('listing_id', listing.id).eq('renter_id', user.id).single()).id;
      } else id = unwrap(created, 'The conversation could not be started.').id;
    }
  }
  const sent = await client.from('messages').insert({ conversation_id: id, body: String(body.message || '').trim() })
    .select('id,conversation_id,sender_id,sender_name,body,created_at').single();
  const row = unwrap(sent, 'Your message could not be sent.');
  return { message: { id: row.id, conversationId: row.conversation_id, name: row.sender_name, message: row.body, createdAt: row.created_at } };
}

async function listViewings(user) {
  const client = requireSupabase();
  const result = await client.from('viewing_requests')
    .select('id,listing_id,listing_title,owner_id,requester_id,requester_name,requester_email,preferred_date,preferred_time,note,status,created_at')
    .or('owner_id.eq.' + user.id + ',requester_id.eq.' + user.id)
    .order('preferred_date', { ascending: true });
  const rows = unwrap(result, 'Viewing requests could not be loaded.');
  return { viewings: rows.map((row) => ({
    id: row.id, propertyId: row.listing_id, propertyTitle: row.listing_title,
    name: row.requester_name, email: row.requester_email, date: row.preferred_date,
    time: row.preferred_time, note: row.note, status: statusTitle(row.status),
    createdAt: row.created_at, direction: row.requester_id === user.id ? 'sent' : 'received'
  })) };
}

async function updateViewing(id, status) {
  const client = requireSupabase();
  if (!['Accepted', 'Declined', 'Cancelled'].includes(status)) throw new Error('This request cannot be updated.');
  const result = await client.from('viewing_requests').update({ status: status.toLowerCase() })
    .eq('id', id).eq('status', 'requested').select('id,status').maybeSingle();
  const row = unwrap(result, 'This request cannot be updated.');
  if (!row) throw new Error('This request cannot be updated.');
  return { viewing: { id: row.id, status: statusTitle(row.status) } };
}

async function markMessagesRead(user) {
  const client = requireSupabase();
  const result = await client.from('conversation_members').update({ last_read_at: new Date().toISOString() }).eq('user_id', user.id);
  fail(result.error, 'Messages could not be marked as read.');
  return { ok: true };
}

export async function api(path, options = {}) {
  const client = requireSupabase();
  const url = new URL(path, window.location.origin);
  const method = String(options.method || 'GET').toUpperCase();
  const body = parseBody(options);

  if (url.pathname === '/api/me' && method === 'GET') return { user: await getCurrentUser() };
  if (url.pathname === '/api/me/profile' && method === 'PATCH') {
    const user = await getCurrentUser();
    if (!user) throw new Error('Please sign in to continue.');
    const fullName = String(body.name || '').trim();
    if (fullName.length < 2 || fullName.length > 80) throw new Error('Use a name between 2 and 80 characters.');
    const result = await client.from('profiles').update({ full_name: fullName }).eq('id', user.id).select('id,full_name').single();
    const profile = unwrap(result, 'Your profile could not be updated.');
    return { user: { ...user, name: profile.full_name } };
  }
  if (url.pathname === '/api/auth/register' && method === 'POST') {
    const result = await client.auth.signUp({
      email: String(body.email || '').trim().toLowerCase(), password: String(body.password || ''),
      options: { data: { full_name: String(body.name || '').trim() }, emailRedirectTo: window.location.origin }
    });
    const authUser = unwrap(result, 'Account creation failed.');
    return { user: publicUser(authUser.user, { full_name: body.name }), needsConfirmation: !authUser.session };
  }
  if (url.pathname === '/api/auth/login' && method === 'POST') {
    const result = await client.auth.signInWithPassword({ email: String(body.email || '').trim().toLowerCase(), password: String(body.password || '') });
    const authUser = unwrap(result, 'Email or password is incorrect.');
    return { user: await getCurrentUser() || publicUser(authUser.user) };
  }
  if (url.pathname === '/api/auth/logout' && method === 'POST') {
    const result = await client.auth.signOut();
    fail(result.error, 'You could not be signed out.');
    return { ok: true };
  }
  if (url.pathname === '/api/auth/password-reset' && method === 'POST') {
    const result = await client.auth.resetPasswordForEmail(String(body.email || '').trim().toLowerCase(), {
      redirectTo: window.location.origin + '/?resetPassword=1'
    });
    fail(result.error, 'A password-reset email could not be sent.');
    return { ok: true };
  }
  if (url.pathname === '/api/auth/update-password' && method === 'POST') {
    const result = await client.auth.updateUser({ password: String(body.password || '') });
    const authUser = unwrap(result, 'Your password could not be updated.');
    return { user: await getCurrentUser() || publicUser(authUser.user) };
  }
  if (url.pathname === '/api/uploads' && method === 'POST') return uploadListingImage(body.image);
  if (url.pathname === '/api/properties' && method === 'GET') return listListings(url);
  if (url.pathname === '/api/properties' && method === 'POST') return saveListing(body);
  if (url.pathname === '/api/me/properties' && method === 'GET') {
    const user = await getCurrentUser();
    if (!user) throw new Error('Please sign in to continue.');
    return listOwnedListings(user);
  }
  if (url.pathname === '/api/me/saved' && method === 'GET') {
    const user = await getCurrentUser();
    if (!user) throw new Error('Please sign in to continue.');
    return getSavedListings(user);
  }
  if (url.pathname === '/api/me/messages' && method === 'GET') {
    const user = await getCurrentUser();
    if (!user) throw new Error('Please sign in to continue.');
    return listMessages(user);
  }
  if (url.pathname === '/api/me/messages/read' && method === 'POST') {
    const user = await getCurrentUser();
    if (!user) throw new Error('Please sign in to continue.');
    return markMessagesRead(user);
  }
  if (url.pathname === '/api/me/viewings' && method === 'GET') {
    const user = await getCurrentUser();
    if (!user) throw new Error('Please sign in to continue.');
    return listViewings(user);
  }
  if (url.pathname === '/api/messages' && method === 'POST') {
    const user = await getCurrentUser();
    if (!user) throw new Error('Please sign in to continue.');
    return createMessage(body, user);
  }
  if (url.pathname === '/api/viewings' && method === 'POST') {
    const user = await getCurrentUser();
    if (!user) throw new Error('Please sign in to continue.');
    const result = await client.from('viewing_requests').insert({
      listing_id: body.propertyId, preferred_date: body.date,
      preferred_time: body.time, note: String(body.note || '').slice(0, 300)
    }).select('id,status').single();
    const row = unwrap(result, 'A viewing request could not be sent.');
    return { viewing: { id: row.id, status: statusTitle(row.status) } };
  }
  const conversationListing = url.pathname === '/api/conversations' ? url.searchParams.get('listingId') : '';
  if (conversationListing && method === 'GET') {
    const user = await getCurrentUser();
    if (!user) throw new Error('Please sign in to continue.');
    return conversationThread(conversationListing, user);
  }
  const propertyMatch = url.pathname.match(/^\/api\/properties\/([0-9a-f-]{36})$/i);
  if (propertyMatch && method === 'GET') return getListing(propertyMatch[1]);
  if (propertyMatch && method === 'PATCH') return saveListing(body, propertyMatch[1]);
  if (propertyMatch && method === 'DELETE') {
    const user = await getCurrentUser();
    if (!user) throw new Error('Please sign in to continue.');
    if (!(await getMyListings(propertyMatch[1])).length) throw new Error('We could not find that listing in your account.');
    const images = await client.from('listing_images').select('object_path').eq('listing_id', propertyMatch[1]);
    const paths = unwrap(images, 'This listing could not be deleted.').map((image) => image.object_path);
    const result = await client.from('listings').delete().eq('id', propertyMatch[1]).select('id').maybeSingle();
    fail(result.error, 'This listing still has messages or viewing history. Unpublish it instead.');
    if (!result.data) throw new Error('We could not find that listing in your account.');
    if (paths.length) fail((await client.storage.from('listing-media').remove(paths)).error, 'The listing was deleted, but a photo could not be removed.');
    return { ok: true };
  }
  const savedMatch = url.pathname.match(/^\/api\/me\/saved\/([0-9a-f-]{36})$/i);
  if (savedMatch && method === 'PUT') {
    const user = await getCurrentUser();
    if (!user) throw new Error('Please sign in to continue.');
    return toggleSaved(savedMatch[1], body, user);
  }
  const viewingMatch = url.pathname.match(/^\/api\/viewings\/([0-9a-f-]{36})$/i);
  if (viewingMatch && method === 'PATCH') {
    const user = await getCurrentUser();
    if (!user) throw new Error('Please sign in to continue.');
    return updateViewing(viewingMatch[1], body.status);
  }
  const conversationMatch = url.pathname.match(/^\/api\/conversations\/([0-9a-f-]{36})$/i);
  if (conversationMatch && method === 'GET') {
    const user = await getCurrentUser();
    if (!user) throw new Error('Please sign in to continue.');
    const conversation = unwrap(await client.from('conversations').select('id,listing_id,listing_title,owner_id,renter_id').eq('id', conversationMatch[1]).maybeSingle());
    if (!conversation) throw new Error('This conversation is unavailable.');
    const result = await client.from('messages').select('id,conversation_id,sender_id,sender_name,body,created_at').eq('conversation_id', conversation.id).order('created_at', { ascending: true });
    const rows = unwrap(result, 'This conversation could not be loaded.');
    const read = await client.from('conversation_members').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', conversation.id).eq('user_id', user.id);
    fail(read.error);
    return { conversation: { id: conversation.id, listingId: conversation.listing_id, listingTitle: conversation.listing_title }, messages: rows.map((row) => ({
      id: row.id, senderId: row.sender_id, name: row.sender_name, message: row.body,
      createdAt: row.created_at, direction: row.sender_id === user.id ? 'sent' : 'received'
    })) };
  }
  const conversationMessageMatch = url.pathname.match(/^\/api\/conversations\/([0-9a-f-]{36})\/messages$/i);
  if (conversationMessageMatch && method === 'POST') {
    const user = await getCurrentUser();
    if (!user) throw new Error('Please sign in to continue.');
    return createMessage(body, user, conversationMessageMatch[1]);
  }
  throw new Error('We could not complete that request.');
}

export function subscribeToMessages(userId, onMessage) {
  if (!supabase) return () => {};
  const channel = supabase.channel('homiva-messages-' + userId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, onMessage)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export const jsonBody = (body) => JSON.stringify(body);
