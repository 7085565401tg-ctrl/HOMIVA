import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dataDir = path.resolve(process.env.HOMIVA_DATA_DIR || here);
const uploadDir = path.join(dataDir, 'uploads');
const port = Number(process.env.PORT || 4174);
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const isProduction = process.env.NODE_ENV === 'production';
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;
const attempts = new Map();
const db = new DatabaseSync(path.join(dataDir, 'homiva.sqlite'));
db.exec([
  'PRAGMA journal_mode = WAL;',
  'PRAGMA foreign_keys = ON;',
  'PRAGMA busy_timeout = 5000;',
  'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);',
  "CREATE TABLE IF NOT EXISTS properties (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), owner TEXT NOT NULL, title TEXT NOT NULL, type TEXT NOT NULL, city TEXT NOT NULL, locality TEXT NOT NULL, price INTEGER NOT NULL, deposit INTEGER, maintenance INTEGER, utilities INTEGER, bedrooms INTEGER NOT NULL, bathrooms INTEGER NOT NULL, size INTEGER, furnishing TEXT NOT NULL, amenities_json TEXT NOT NULL, description TEXT NOT NULL, image TEXT NOT NULL DEFAULT '', latitude REAL, longitude REAL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')), trust TEXT NOT NULL DEFAULT 'Unverified', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
  'CREATE INDEX IF NOT EXISTS idx_properties_public ON properties(status, city, locality, price);',
  'CREATE INDEX IF NOT EXISTS idx_properties_owner ON properties(owner_id, created_at);',
  'CREATE TABLE IF NOT EXISTS saved_properties (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY(user_id, property_id));',
  'CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, property_id TEXT NOT NULL REFERENCES properties(id), property_title TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), sender_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, email TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL);',
  'CREATE INDEX IF NOT EXISTS idx_messages_owner ON messages(owner_id, created_at);',
  "CREATE TABLE IF NOT EXISTS viewings (id TEXT PRIMARY KEY, property_id TEXT NOT NULL REFERENCES properties(id), property_title TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), requester_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, email TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, note TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Requested' CHECK(status IN ('Requested','Accepted','Declined','Rescheduled','Completed','Cancelled')), created_at TEXT NOT NULL, updated_at TEXT);",
  'CREATE INDEX IF NOT EXISTS idx_viewings_owner ON viewings(owner_id, date);'
].join('\n'));

const cleanString = (value, maxLength = 300) => typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email, createdAt: user.created_at });
const userById = db.prepare('SELECT * FROM users WHERE id = ?');
const userByEmail = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE');
const propertyById = db.prepare('SELECT * FROM properties WHERE id = ?');
const publicPropertyById = db.prepare("SELECT * FROM properties WHERE id = ? AND status = 'published'");

function propertyFromRow(row) {
  if (!row) return null;
  let amenities = [];
  try { amenities = JSON.parse(row.amenities_json || '[]'); } catch {}
  return {
    id: row.id, ownerId: row.owner_id, owner: row.owner, title: row.title, type: row.type,
    city: row.city, locality: row.locality, price: row.price, deposit: row.deposit,
    maintenance: row.maintenance, utilities: row.utilities, bedrooms: row.bedrooms,
    bathrooms: row.bathrooms, size: row.size, furnishing: row.furnishing, amenities,
    description: row.description, image: row.image, latitude: row.latitude, longitude: row.longitude,
    status: row.status, trust: row.trust, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function safeProperty(property, isOwner = false) {
  const { latitude, longitude, ownerId, ...visible } = property;
  const mapPin = latitude !== null && longitude !== null
    ? { latitude: isOwner ? latitude : Math.round(latitude * 100) / 100, longitude: isOwner ? longitude : Math.round(longitude * 100) / 100 }
    : null;
  return {
    ...visible,
    ...(isOwner ? { isOwner: true } : {}),
    ...(mapPin ? { locationPin: mapPin } : {})
  };
}

function send(response, status, data, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    ...headers
  });
  response.end(data === null ? '' : JSON.stringify(data));
}

async function readJson(request, maxBytes = 1_500_000) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error('This request is too large. Try a smaller photo.'), { status: 413 });
    chunks.push(chunk);
  }
  if (!total) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Please check the form and try again.'), { status: 400 }); }
}

function cookieValue(header = '', name) {
  const item = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(name + '='));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
}

function currentUser(request) {
  const token = cookieValue(request.headers.cookie, 'homiva_session');
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash=?').get(tokenHash);
  if (!session || session.expires_at <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
    return null;
  }
  return userById.get(session.user_id) || null;
}

function requireUser(request, response) {
  const user = currentUser(request);
  if (!user) send(response, 401, { error: 'Please sign in to continue.' });
  return user;
}

function setSession(response, userId, request) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').run(tokenHash, userId, Date.now() + sessionLifetime);
  const secure = request.socket.encrypted || (isProduction && request.headers['x-forwarded-proto'] === 'https') ? '; Secure' : '';
  response.setHeader('Set-Cookie', 'homiva_session=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(sessionLifetime / 1000) + secure);
}

function checkOrigin(request, response) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const allowed = new Set((process.env.ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean));
  if (!isProduction) ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:4174', 'http://localhost:4174'].forEach((item) => allowed.add(item));
  else allowed.add(((request.socket.encrypted || request.headers['x-forwarded-proto'] === 'https') ? 'https://' : 'http://') + request.headers.host);
  if (allowed.has(origin)) return true;
  send(response, 403, { error: 'This request could not be verified. Reload the page and try again.' });
  return false;
}

function limited(request, key, maximum = 12, windowMs = 15 * 60 * 1000) {
  const id = (request.socket.remoteAddress || 'unknown') + ':' + key;
  const now = Date.now();
  const entry = attempts.get(id);
  if (!entry || entry.until <= now) { attempts.set(id, { count: 1, until: now + windowMs }); return true; }
  if (entry.count >= maximum) return false;
  entry.count += 1; return true;
}

function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 180; }

function normalizedProperty(body, user, existing = null) {
  const title = cleanString(body.title, 100);
  const locality = cleanString(body.locality, 70);
  const city = cleanString(body.city, 70);
  const price = Number(body.price);
  const bedrooms = Number(body.bedrooms);
  const bathrooms = Number(body.bathrooms);
  if (title.length < 5 || locality.length < 2 || city.length < 2) throw Object.assign(new Error('Add a clear title, area, and city.'), { status: 400 });
  if (!Number.isFinite(price) || price < 1 || price > 100000000) throw Object.assign(new Error('Enter a valid monthly rent.'), { status: 400 });
  if (!Number.isInteger(bedrooms) || bedrooms < 0 || bedrooms > 20 || !Number.isInteger(bathrooms) || bathrooms < 1 || bathrooms > 20) throw Object.assign(new Error('Check the bedroom and bathroom details.'), { status: 400 });
  const amenities = Array.isArray(body.amenities) ? body.amenities.map((item) => cleanString(item, 40)).filter(Boolean).slice(0, 12) : [];
  const numberOrNull = (value) => value === '' || value === null || value === undefined ? null : (Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null);
  const lat = body.latitude === null || body.latitude === undefined || body.latitude === '' ? null : Number(body.latitude);
  const lng = body.longitude === null || body.longitude === undefined || body.longitude === '' ? null : Number(body.longitude);
  const hasValidPin = Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  const image = typeof body.image === 'string' && /^\/uploads\/[a-zA-Z0-9-]+\.webp$/.test(body.image) ? body.image : (existing?.image || '');
  return {
    id: existing?.id || crypto.randomUUID(), ownerId: user.id, owner: cleanString(body.owner, 80) || user.name,
    title, type: cleanString(body.type, 40) || 'Apartment', city, locality, price,
    deposit: numberOrNull(body.deposit), maintenance: numberOrNull(body.maintenance), utilities: numberOrNull(body.utilities),
    bedrooms, bathrooms, size: numberOrNull(body.size), furnishing: cleanString(body.furnishing, 30) || 'Unknown',
    amenities, description: cleanString(body.description, 1200), image,
    latitude: hasValidPin ? lat : (existing?.latitude ?? null), longitude: hasValidPin ? lng : (existing?.longitude ?? null),
    status: existing?.status || 'draft', trust: 'Unverified',
    createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
  };
}

const saveProperty = db.prepare('INSERT INTO properties (id,owner_id,owner,title,type,city,locality,price,deposit,maintenance,utilities,bedrooms,bathrooms,size,furnishing,amenities_json,description,image,latitude,longitude,status,trust,created_at,updated_at) VALUES (@id,@ownerId,@owner,@title,@type,@city,@locality,@price,@deposit,@maintenance,@utilities,@bedrooms,@bathrooms,@size,@furnishing,@amenitiesJson,@description,@image,@latitude,@longitude,@status,@trust,@createdAt,@updatedAt) ON CONFLICT(id) DO UPDATE SET owner=@owner,title=@title,type=@type,city=@city,locality=@locality,price=@price,deposit=@deposit,maintenance=@maintenance,utilities=@utilities,bedrooms=@bedrooms,bathrooms=@bathrooms,size=@size,furnishing=@furnishing,amenities_json=@amenitiesJson,description=@description,image=@image,latitude=@latitude,longitude=@longitude,status=@status,trust=@trust,updated_at=@updatedAt');
function writeProperty(property) {
  const { amenities, ...fields } = property;
  saveProperty.run({ ...fields, amenitiesJson: JSON.stringify(amenities) });
}

async function serveStatic(response, pathname) {
  if (pathname.startsWith('/uploads/')) {
    const name = path.basename(pathname);
    if (!/^[a-zA-Z0-9-]+\.webp$/.test(name)) return send(response, 404, { error: 'Image not found.' });
    try {
      const file = await fs.readFile(path.join(uploadDir, name));
      response.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' }); response.end(file);
    } catch { send(response, 404, { error: 'Image not found.' }); }
    return;
  }
  if (!isProduction) return send(response, 404, { error: 'Not found.' });
  const dist = path.join(root, 'dist');
  const requested = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const candidate = path.resolve(dist, '.' + requested);
  if (!candidate.startsWith(dist + path.sep) && candidate !== path.join(dist, 'index.html')) return send(response, 400, { error: 'Invalid path.' });
  try {
    let filePath = candidate;
    let contents;
    try { contents = await fs.readFile(filePath); } catch { filePath = path.join(dist, 'index.html'); contents = await fs.readFile(filePath); }
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    response.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    });
    response.end(contents);
  } catch { send(response, 503, { error: 'The website is starting. Please refresh in a moment.' }); }
}

async function route(request, response) {
  const url = new URL(request.url, 'http://localhost');
  const pathname = url.pathname;
  const method = request.method || 'GET';
  if (pathname.startsWith('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !checkOrigin(request, response)) return;

  if (pathname === '/api/health' && method === 'GET') return send(response, 200, { status: 'ok' });
  if (pathname === '/api/me' && method === 'GET') {
    const user = currentUser(request); return send(response, 200, { user: user ? publicUser(user) : null });
  }
  if (pathname === '/api/auth/register' && method === 'POST') {
    if (!limited(request, 'auth', 6)) return send(response, 429, { error: 'Too many attempts. Please wait a little and try again.' });
    const body = await readJson(request, 20_000);
    const name = cleanString(body.name, 80); const email = cleanString(body.email, 180).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (name.length < 2 || !validEmail(email) || password.length < 10 || password.length > 200) return send(response, 400, { error: 'Enter your name, a valid email, and a password with at least 10 characters.' });
    if (userByEmail.get(email)) return send(response, 409, { error: 'An account with this email already exists. Try signing in.' });
    const salt = crypto.randomBytes(16).toString('hex'); const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    const id = crypto.randomUUID(); const createdAt = new Date().toISOString();
    db.prepare('INSERT INTO users (id,name,email,password_salt,password_hash,created_at) VALUES (?,?,?,?,?,?)').run(id, name, email, salt, hash, createdAt);
    setSession(response, id, request); return send(response, 201, { user: publicUser(userById.get(id)) });
  }
  if (pathname === '/api/auth/login' && method === 'POST') {
    if (!limited(request, 'auth', 6)) return send(response, 429, { error: 'Too many attempts. Please wait a little and try again.' });
    const body = await readJson(request, 20_000); const email = cleanString(body.email, 180).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : ''; const user = userByEmail.get(email);
    if (!user || password.length > 200) return send(response, 401, { error: 'Email or password is incorrect.' });
    const attempted = crypto.scryptSync(password, user.password_salt, 64);
    if (!crypto.timingSafeEqual(attempted, Buffer.from(user.password_hash, 'hex'))) return send(response, 401, { error: 'Email or password is incorrect.' });
    setSession(response, user.id, request); return send(response, 200, { user: publicUser(user) });
  }
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const token = cookieValue(request.headers.cookie, 'homiva_session');
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(crypto.createHash('sha256').update(token).digest('hex'));
    return send(response, 200, { ok: true }, { 'Set-Cookie': 'homiva_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
  }
  if (pathname === '/api/properties' && method === 'GET') {
    const conditions = ["status = 'published'"]; const values = [];
    const city = cleanString(url.searchParams.get('city'), 70);
    const locality = cleanString(url.searchParams.get('locality'), 70);
    if (city) { conditions.push('LOWER(city) LIKE LOWER(?)'); values.push('%' + city + '%'); }
    if (locality) { conditions.push('(LOWER(locality) LIKE LOWER(?) OR LOWER(city) LIKE LOWER(?))'); values.push('%' + locality + '%', '%' + locality + '%'); }
    const maximum = Number(url.searchParams.get('maxBudget'));
    if (Number.isFinite(maximum) && maximum > 0) { conditions.push('price <= ?'); values.push(maximum); }
    const bedrooms = Number(url.searchParams.get('bedrooms'));
    if (Number.isInteger(bedrooms) && bedrooms > 0) { conditions.push(bedrooms >= 3 ? 'bedrooms >= 3' : 'bedrooms = ?'); if (bedrooms < 3) values.push(bedrooms); }
    if (url.searchParams.get('furnishing')) { conditions.push('furnishing = ?'); values.push(cleanString(url.searchParams.get('furnishing'), 30)); }
    if (url.searchParams.get('type')) { conditions.push('type = ?'); values.push(cleanString(url.searchParams.get('type'), 40)); }
    if (url.searchParams.get('parking') === 'true') conditions.push("LOWER(amenities_json) LIKE '%parking%'");
    const where = conditions.join(' AND '); const total = db.prepare('SELECT COUNT(*) AS total FROM properties WHERE ' + where).get(...values).total;
    const limit = Math.max(1, Math.min(24, Number(url.searchParams.get('limit')) || 24)); const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const rows = db.prepare('SELECT * FROM properties WHERE ' + where + ' ORDER BY price ASC, created_at DESC LIMIT ? OFFSET ?').all(...values, limit, offset);
    return send(response, 200, { properties: rows.map((row) => safeProperty(propertyFromRow(row))), total, hasMore: offset + rows.length < total, nextOffset: offset + rows.length });
  }
  if (pathname === '/api/uploads' && method === 'POST') {
    const user = requireUser(request, response); if (!user) return;
    if (!limited(request, 'upload', 20, 60 * 60 * 1000)) return send(response, 429, { error: 'You have uploaded several photos recently. Please try again later.' });
    const body = await readJson(request, 1_600_000);
    const match = typeof body.image === 'string' ? body.image.match(/^data:image\/webp;base64,([A-Za-z0-9+/]+={0,2})$/) : null;
    if (!match) return send(response, 400, { error: 'Please select a JPG, PNG, or WebP photo.' });
    const image = Buffer.from(match[1], 'base64');
    if (image.length < 16 || image.length > 1_100_000 || image.toString('ascii', 0, 4) !== 'RIFF' || image.toString('ascii', 8, 12) !== 'WEBP') return send(response, 400, { error: 'This image could not be checked. Try another photo.' });
    const fileName = crypto.randomUUID() + '.webp';
    await fs.writeFile(path.join(uploadDir, fileName), image, { flag: 'wx', mode: 0o640 });
    return send(response, 201, { path: '/uploads/' + fileName });
  }
  if (pathname === '/api/me/properties' && method === 'GET') {
    const user = requireUser(request, response); if (!user) return;
    const rows = db.prepare('SELECT * FROM properties WHERE owner_id = ? ORDER BY created_at DESC').all(user.id);
    return send(response, 200, { properties: rows.map((row) => safeProperty(propertyFromRow(row), true)) });
  }
  if (pathname === '/api/properties' && method === 'POST') {
    const user = requireUser(request, response); if (!user) return;
    const property = normalizedProperty(await readJson(request), user); writeProperty(property);
    return send(response, 201, { property: safeProperty(property, true) });
  }
  const propertyMatch = pathname.match(/^\/api\/properties\/([a-zA-Z0-9-]+)$/);
  if (propertyMatch && method === 'GET') {
    const property = propertyFromRow(publicPropertyById.get(propertyMatch[1]));
    if (!property) return send(response, 404, { error: 'This home is not available.' });
    const owner = userById.get(property.ownerId); const isOwner = currentUser(request)?.id === property.ownerId;
    return send(response, 200, { property: { ...safeProperty(property, isOwner), owner: owner?.name || 'Property owner' } });
  }
  if (propertyMatch && method === 'PATCH') {
    const user = requireUser(request, response); if (!user) return;
    const existing = propertyFromRow(propertyById.get(propertyMatch[1]));
    if (!existing || existing.ownerId !== user.id) return send(response, 404, { error: 'We couldn’t find that property in your account.' });
    const body = await readJson(request);
    if (body.status === 'published' || body.status === 'draft') {
      existing.status = body.status; existing.updatedAt = new Date().toISOString(); writeProperty(existing);
      return send(response, 200, { property: safeProperty(existing, true) });
    }
    const updated = normalizedProperty({ ...existing, ...body, id: existing.id }, user, existing); writeProperty(updated);
    return send(response, 200, { property: safeProperty(updated, true) });
  }
  if (pathname === '/api/me/saved' && method === 'GET') {
    const user = requireUser(request, response); if (!user) return;
    const rows = db.prepare("SELECT p.* FROM properties p JOIN saved_properties s ON p.id=s.property_id WHERE s.user_id=? AND p.status='published' ORDER BY s.created_at DESC").all(user.id);
    return send(response, 200, { properties: rows.map((row) => safeProperty(propertyFromRow(row))) });
  }
  const saveMatch = pathname.match(/^\/api\/me\/saved\/([a-zA-Z0-9-]+)$/);
  if (saveMatch && method === 'PUT') {
    const user = requireUser(request, response); if (!user) return;
    const body = await readJson(request, 10_000); const property = propertyFromRow(publicPropertyById.get(saveMatch[1]));
    if (!property) return send(response, 404, { error: 'This home is no longer available.' });
    if (body.saved === true) db.prepare('INSERT OR IGNORE INTO saved_properties (user_id,property_id,created_at) VALUES (?,?,?)').run(user.id, property.id, new Date().toISOString());
    else db.prepare('DELETE FROM saved_properties WHERE user_id=? AND property_id=?').run(user.id, property.id);
    const rows = db.prepare('SELECT property_id FROM saved_properties WHERE user_id=?').all(user.id);
    return send(response, 200, { saved: rows.map((row) => row.property_id) });
  }
  if (pathname === '/api/messages' && method === 'POST') {
    const user = requireUser(request, response); if (!user) return;
    const body = await readJson(request, 30_000); const property = propertyFromRow(publicPropertyById.get(cleanString(body.propertyId, 60)));
    const message = cleanString(body.message, 1200);
    if (!property) return send(response, 404, { error: 'This home is no longer available.' });
    if (property.ownerId === user.id) return send(response, 400, { error: 'You can’t message yourself about your own listing.' });
    if (message.length < 4) return send(response, 400, { error: 'Add a little more detail to your message.' });
    const id = crypto.randomUUID(); const createdAt = new Date().toISOString();
    db.prepare('INSERT INTO messages (id,property_id,property_title,owner_id,sender_id,name,email,message,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, property.id, property.title, property.ownerId, user.id, user.name, user.email, message, createdAt);
    return send(response, 201, { message: { id, propertyTitle: property.title, createdAt } });
  }
  if (pathname === '/api/me/messages' && method === 'GET') {
    const user = requireUser(request, response); if (!user) return;
    const rows = db.prepare("SELECT *, CASE WHEN sender_id=? THEN 'sent' ELSE 'received' END AS direction FROM messages WHERE owner_id=? OR sender_id=? ORDER BY created_at DESC").all(user.id, user.id, user.id);
    return send(response, 200, { messages: rows.map((item) => ({ id: item.id, propertyId: item.property_id, propertyTitle: item.property_title, name: item.name, email: item.email, message: item.message, createdAt: item.created_at, direction: item.direction })) });
  }
  if (pathname === '/api/viewings' && method === 'POST') {
    const user = requireUser(request, response); if (!user) return;
    const body = await readJson(request, 30_000); const property = propertyFromRow(publicPropertyById.get(cleanString(body.propertyId, 60)));
    const date = cleanString(body.date, 12); const time = cleanString(body.time, 50);
    if (!property) return send(response, 404, { error: 'This home is no longer available.' });
    if (property.ownerId === user.id) return send(response, 400, { error: 'You can’t request a viewing for your own listing.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time) return send(response, 400, { error: 'Choose a preferred date and time.' });
    const id = crypto.randomUUID(); const createdAt = new Date().toISOString();
    db.prepare('INSERT INTO viewings (id,property_id,property_title,owner_id,requester_id,name,email,date,time,note,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id, property.id, property.title, property.ownerId, user.id, user.name, user.email, date, time, cleanString(body.note, 300), 'Requested', createdAt);
    return send(response, 201, { viewing: { id, status: 'Requested' } });
  }
  if (pathname === '/api/me/viewings' && method === 'GET') {
    const user = requireUser(request, response); if (!user) return;
    const rows = db.prepare("SELECT *, CASE WHEN requester_id=? THEN 'sent' ELSE 'received' END AS direction FROM viewings WHERE owner_id=? OR requester_id=? ORDER BY date").all(user.id, user.id, user.id);
    return send(response, 200, { viewings: rows.map((item) => ({ id: item.id, propertyId: item.property_id, propertyTitle: item.property_title, name: item.name, email: item.email, date: item.date, time: item.time, note: item.note, status: item.status, createdAt: item.created_at, direction: item.direction })) });
  }
  const viewingMatch = pathname.match(/^\/api\/viewings\/([a-zA-Z0-9-]+)$/);
  if (viewingMatch && method === 'PATCH') {
    const user = requireUser(request, response); if (!user) return;
    const body = await readJson(request, 10_000); const viewing = db.prepare('SELECT * FROM viewings WHERE id=? AND owner_id=?').get(viewingMatch[1], user.id);
    if (!viewing) return send(response, 404, { error: 'We couldn’t find that viewing request.' });
    if (!['Accepted', 'Declined'].includes(body.status) || viewing.status !== 'Requested') return send(response, 400, { error: 'This request can’t be updated.' });
    db.prepare('UPDATE viewings SET status=?, updated_at=? WHERE id=?').run(body.status, new Date().toISOString(), viewing.id);
    return send(response, 200, { viewing: { id: viewing.id, status: body.status } });
  }
  if (!pathname.startsWith('/api/')) return serveStatic(response, pathname);
  return send(response, 404, { error: 'We couldn’t find that page.' });
}

const server = http.createServer(async (request, response) => {
  try { await route(request, response); }
  catch (error) {
    console.error('Request failed:', error?.message || 'Unknown error');
    send(response, error.status || 500, { error: error.status ? error.message : 'Something went wrong. Please try again.' });
  }
});

await fs.mkdir(uploadDir, { recursive: true });
db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
server.listen(port, host, () => console.log('HOMIVA website listening at http://' + host + ':' + port));
