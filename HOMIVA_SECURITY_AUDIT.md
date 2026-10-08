# HOMIVA security audit

**Review date:** 2026-10-08  
**Scope:** This HOMIVA workspace, SQL migrations, frontend, Netlify configuration retained in the repository, and Cloudflare Pages headers. No live Supabase/Cloudflare/GitHub project was available to test.

## Reviewed controls

| Area | Code/config review | Live verification |
| --- | --- | --- |
| Secrets and environment | `.env.example` contains only the public Supabase URL and publishable/anon key. The app does not need or reference a service-role key. No credential value was found in the workspace scan. | Not verified against provider dashboards or a remote Git repository. |
| Authentication | Supabase Auth handles signup, login, persistent browser session, logout, reset, and recovery. The app stores no plaintext password or custom password hash. | Email confirmation, redirect allowlist, password policy, recovery email delivery, and session revocation need an actual Supabase project. |
| Database access | RLS is enabled in the migration for application tables. Public listing grants exclude owner/location IDs. Authenticated owners use a constrained `get_my_listings` function that filters by `auth.uid()`. Listing inserts and conversation participants are derived by triggers. | Migration execution and two-account RLS attacks are not verified against a real project. |
| Private data | Exact location is in owner-only `locations`; public map coordinates are rounded. Conversations/messages and viewing requests use participant RLS and constrained status updates. Profiles, notifications, verification records, and upload quotas are private. | Requires deployed database role tests. |
| Image uploads | Browser canvas re-encodes supported images as WebP and validates the RIFF signature/size. Authenticated direct Storage uploads use an owner-folder RLS policy, random UUID paths, private buckets, and a database quota bound to `auth.uid()`. No service-role key is needed. | Real upload and Storage RLS are unverified without a project. |
| Injection and rendering | Supabase client parameterizes values; search strings are reduced to letters, digits, and spaces. React renders user text as text. The Leaflet marker HTML receives only numeric price formatting. | No dynamic security scan or live adversarial test was run. |
| Browser policy | `public/_headers` includes CSP, frame denial, content-type sniffing protection, HSTS, referrer policy, and browser feature policy for Cloudflare Pages. | Response headers need inspection on the public Cloudflare URL. |
| Legacy backend | `server/` remains in the project but the new frontend calls Supabase directly and does not use the old SQLite API in production. Existing ignored local DB/upload files were preserved. | Confirm that deployment only publishes `dist/` and does not expose local server data. |

## Findings and remaining risk

1. **Production authorization is not yet verified.** The SQL is a prepared migration, not an applied project. Do not treat a code-level RLS design as proof of production authorization until the live SQL has run and unauthorized cross-account reads/writes have been tested.
2. **Provider configuration is absent.** No GitHub remote, Supabase project, Cloudflare Pages site, production URL, or provider CLI configuration was found. Auth redirect and email policies, CORS, Storage settings, and production headers cannot be inspected yet.
3. **Build-time client configuration is public by design.** A Vite `VITE_*` value is downloadable. Use only the Supabase publishable/anon key there; its permissions must remain constrained by RLS. The application does not require `SUPABASE_SERVICE_ROLE_KEY`.
4. **Upload quotas are basic abuse limits.** The migration allows up to 10 listing image uploads per user per UTC hour and 30 per UTC day. This is not a malware scan, billing guard, or sophisticated fraud defense.
5. **Verification is a data model only.** There is no moderator UI, identity proof operation, or verified badge grant process. Client users cannot approve a record; an operator must establish the trusted `app_metadata.role` through an authorized server-side process.
6. **Profile/verification media are not exposed in product flows yet.** Their private buckets and owner policies are provisioned, but no upload UI or retention workflow is implemented.
7. **Public pages are primarily a client-rendered SPA.** The production build adds static title/description/canonical metadata and sitemap entries for listings published at build time; React also updates metadata after it loads. A newly published home needs a new build for crawler metadata, and crawler/sitemap behavior must be checked on the production URL. This is not full server-side rendering.
8. **User contact details are shared inside intended flows.** Messages store the sender's account name/email for the other conversation participant, and viewing requests share requester name/email with the owner. This behavior is disclosed in the UI and should be reflected in the eventual privacy notice.
9. **Free-tier operational limits remain.** Cloudflare Pages and Supabase have plan-specific build, database, storage, and email limits. Check current provider dashboards and prepare a data export/recovery plan before public launch.

## Required production checks

- Confirm no populated `.env` or private key is tracked or pushed; inspect the actual GitHub diff before publishing the repository.
- Apply migrations in order and inspect table grants, policies, triggers, buckets, and Realtime publication.
- With two separate user accounts, attempt cross-owner draft reads, listing edits/deletes, location reads, image reads/deletes, messages, viewing changes, notification reads, and verification approval. Every unauthorized attempt must fail.
- Inspect browser bundles, Cloudflare Pages build logs, build variables, response headers, Auth email redirects, Storage policies, and Supabase audit/log views.
- Exercise all owner/renter flows on the actual production hostname from two devices. Confirm a laptop-off check by accessing the cloud URL after the development laptop is shut down.

No production security pass is claimed until those checks run against the live providers.
