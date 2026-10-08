# HOMIVA Architecture Audit

**Project:** HOMIVA (`NEXTGEN-HOUSING-OS`)
**Audit date:** 2026-10-07
**Scope:** Existing files in this HOMIVA workspace only. No EXPOSE or Rent Finder project files, repositories, credentials, or data were used.

> **Historical snapshot:** This audit predates HOMIVA's Supabase migration and Cloudflare Pages preparation. Its architecture and deployment findings describe the earlier SQLite/Node version and are not current. See `README.md` and `HOMIVA_PRODUCTION_REPORT.md` for the current architecture and launch status.

## Current architecture

```text
React 18 + Vite 6 single-page frontend
        │ same-origin /api and /uploads (Vite proxy in development)
        ▼
Node.js 24 HTTP server (server/index.js)
        ├── SQLite database (server/homiva.sqlite in development)
        └── local uploads directory (server/uploads)
```

The production server serves both `dist/` and the API from one Node process. The Vite production build is static, but the application currently relies on that Node process for authentication, listing data, saved homes, messages, viewing requests, and image uploads.

## Frontend technology and structure

- React 18.3, Vite 6, JavaScript ES modules, and a single-page application.
- `src/App.jsx` contains the page components, navigation state, dialogs, and client-side application flows. `src/styles.css` contains the responsive visual system. `src/data.js` holds INR formatting, known-cost calculations, and a small deterministic search-intent parser.
- `src/MapCanvas.jsx` uses Leaflet and OpenStreetMap tiles. It supports approximate listing pins, selecting a pin, and asking the browser for the owner's current location.
- `src/api.js` sends same-origin `fetch` requests and converts non-2xx responses into user-facing errors.
- Existing responsive breakpoints, reduced-motion styling, accessible labels, loading/empty/error UI, lazy-loaded card images, and a consistent HOMIVA identity are present. Several small text sizes and controls deserve a mobile/accessibility pass during product changes.

## Backend, API, and database

- `server/index.js` is a custom Node HTTP server using Node's built-in `node:sqlite` `DatabaseSync`; there is no Express framework or separate API service.
- SQLite tables are `users`, `sessions`, `properties`, `saved_properties`, `messages`, and `viewings`. Foreign keys, status checks, and indexes exist for public/owner property reads and owner messages/viewings.
- SQL writes use prepared statements. Property reads expose published listings; owner-specific reads require the server's session. Property text is rendered through React, which escapes text by default.
- API routes currently cover `/api/me`, register/login/logout, public property search/detail, owner property create/edit/publish, image upload, saved homes, messages/inbox, and viewing-request create/list/owner accept-or-decline.
- The application owns password handling (scrypt hashes), session creation (random HttpOnly cookie with a hashed token in SQLite), origin checks for writes, and in-memory per-process attempt limits. These are coupled to the single server and are not a replacement for managed Auth, RLS, or distributed abuse controls.

## Current storage and authentication

- Accounts and all application records are stored in local SQLite. The inspected database contains **0 rows** in each of its six application tables.
- Photos are optimized to WebP in the browser, then checked for WebP structure and size by the Node server and saved under random UUID filenames in `server/uploads`. The current UI supports one optional cover image per listing, not a gallery.
- Authentication uses the custom Node/scrypt/session-cookie flow. There is no Supabase Auth, profile table, email confirmation, password reset, or Supabase client.
- The inspected `server/uploads` directory contains **0 files**. Existing local data files are ignored by Git and must not be deleted as part of this migration.

## Existing user-facing features

- Public home page and published listing browsing.
- Search parser for Pune and a short list of localities, budget, bedrooms, furnishing, and parking; filters for budget, bedrooms, furnishing, home type, area, and parking.
- List/split/map results, price sorting, pagination, approximate pins, property detail in a query-string modal, and browser share-link copying.
- Owner registration/login, owner dashboard, listing draft creation/editing, a review/publish step, and publish/unpublish state changes.
- Saved-home add/remove, local comparison of up to three homes, owner inbox display, enquiry submission, and owner accept/decline for viewing requests.
- A deliberate empty-inventory state; no synthetic listings or fake reviews were found.

## Existing gaps against the requested product flows

- No profile editing or password reset flow.
- No multi-photo gallery, listing deletion, availability/rules/contact-preference fields, or renter cancellation/history screen for viewing requests.
- Messages are persisted as individual enquiries; there is no conversation UI, conversation membership model, unread state, or Realtime subscription.
- No verification workflow or verification records. The interface correctly says owners/homes are unverified.
- Search is currently a small deterministic parser and a limited set of filters; bathrooms, amenities other than parking, and availability are not searchable.
- No managed relational database, Row Level Security, database migrations, public storage bucket, or serverless functions.
- Listing URLs use `?home=<uuid>` and a modal, rather than crawlable public listing pages.

## Deployment blockers

- Netlify can host the Vite static build (`npm run build`, publish `dist/`) but cannot run the current persistent Node/SQLite server as the production API. Its development-only Vite proxy points to `127.0.0.1:4174`.
- There is no `netlify.toml`, redirect rule, Supabase project/schema/client, or production public environment configuration.
- `README.md`, `.env.example`, and `Dockerfile` describe the present single-process Node/SQLite design, not the requested Netlify/Supabase target.
- No public URL, GitHub remote, GitHub CLI, Netlify CLI, or Supabase CLI is configured/detected in this workspace. The repository has no commits; the current project files are untracked. A GitHub repository and authenticated provider dashboards are therefore outstanding external setup.
- No robots file or sitemap exists. Current title, description, Open Graph title/description/type, and favicon are set in `index.html`, but public listing metadata and indexing controls are not.
- The current `.env.example` contains legacy Node host/port/storage settings. No real `.env` file or provider secret was found in the workspace.

## Security observations and risks

- No Supabase service-role key, database password, API secret, or other credential was found in the current source or environment example. The root `.gitignore` excludes `.env*` except `.env.example`, SQLite files, uploads, `node_modules`, and `dist`.
- The custom server validates emails, bounds user text, uses prepared SQL, checks allowed write origins, uses HttpOnly/SameSite session cookies, validates uploaded WebP signatures/size, and generates upload names itself.
- The protections and rate limits live in one process and disappear on restart; they do not scale across instances. Cross-origin credentials are not enabled, which is consistent with the current same-origin deployment.
- Supabase migration must move authorization into RLS, constrain profile/listing/storage writes to `auth.uid()`, keep service-role credentials server-side (or omit them entirely), authorize both messaging participants and both viewing-request parties, and restrict public listing reads to published rows.
- Public coordinates are rounded to two decimal places by the current API. The migration must preserve that privacy boundary and avoid exposing exact owner pins to anonymous users.
- The current app uses Leaflet's `divIcon` HTML for its price label; current values are numeric rent values. Any future owner-controlled markup must not be inserted there. React-rendered listing content is otherwise escaped.
- Image optimization/validation currently depends partly on a browser canvas, but the server also checks the resulting WebP signature. Storage migration must enforce allowed MIME types and size in the bucket, generate object paths, and store metadata separately from image bytes.

## Migration requirements

1. Keep the existing HOMIVA interface and its truthful empty-inventory, cost, map-privacy, draft/review/publish, saved-home, enquiry, and viewing behavior.
2. Replace production API calls with Supabase Auth/Postgres/Storage access guarded by RLS; do not ship a service-role key or depend on the local API server.
3. Create versioned PostgreSQL migrations for profiles, locations, listings, listing-image metadata, favorites, conversations/members/messages, viewing requests, verification records, and notifications, with UUID keys, timestamps, constraints, and indexes.
4. Make listing photo uploads use generated paths in Supabase Storage and persist image metadata in `listing_images`.
5. Add Realtime only for authorized conversation/message events; preserve participant-only reads/writes and add unread state without exposing other users' private activity.
6. Add Netlify build/publish/SPA configuration, safe public environment variables, crawler metadata, and project documentation. Retire production reliance on the old server without deleting the ignored local SQLite database or photos.
7. Link this checkout to a new/selected HOMIVA GitHub repository and configure the actual Netlify/Supabase projects. Those provider accounts and private values are absent from the workspace, so live deployment and production URL checks remain blocked until the user completes the necessary authenticated dashboard actions.

## Features to preserve during implementation

- Current HOMIVA visual identity, responsive navigation, empty state, and honest distinction between confirmed and estimated details.
- Real-owner listing creation, review-before-publish, draft privacy, owner edit/unpublish, public published-only browsing, and approximate-only public map pins.
- Search/filter behavior, result pagination, saved homes, comparison, direct listing links, owner enquiries, and owner-side viewing decisions.
- Existing public copy that disclaims verification. Do not imply verification, inventory, AI matching, or a trust system that does not exist.
- The ignored SQLite files and upload directory as local project data. Their current row/file counts are zero, but they are still preserved.
