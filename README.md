# HOMIVA

HOMIVA is a housing search and living platform for real owner-submitted homes, transparent costs, saved listings, secure enquiries, and viewing requests. It does not invent listings, reviews, AI matches, or verification claims.

## Production architecture

- **Frontend:** React 18 + Vite 6, deployed as a static site on Cloudflare Pages.
- **Data and auth:** Supabase Auth + PostgreSQL with Row Level Security.
- **Images:** Private Supabase Storage buckets. The browser re-encodes and validates WebP, then uploads with the user's Supabase JWT through a folder-scoped Storage RLS policy and a user-bound database quota.
- **Realtime:** Supabase Realtime for authorized message events.
- **Source:** Connect the HOMIVA GitHub repository to Cloudflare Pages for automatic production and preview deployments.

The old Node/SQLite backend in `server/` is retained for auditability and local data preservation; production frontend code no longer calls it. Do not use its local SQLite database or `server/uploads` as production services.

## Open the project in PowerShell

Run this to enter the project folder (typing a folder path by itself attempts to run it as a command):

```powershell
Set-Location -LiteralPath "C:\Users\70855\Documents\ChatGPT\HOMIVA"
```

## Local development

1. Install Node.js 24 and npm.
2. Copy `.env.example` to `.env` and fill the public Supabase URL and publishable/anon key from your Supabase project.
3. Install dependencies and run the Vite frontend:

```powershell
npm ci
npm run dev
```

Uploads run directly to Supabase Storage with the signed-in account; no local API server or server secret is needed. Do not expose the local Vite preview as public production hosting.

Run the production bundle build with:

```powershell
npm run build
```

The build writes `dist/`, `robots.txt`, and, for production, a sitemap and static listing metadata. The SEO generator reads `CONTEXT=production` and `URL=<canonical public origin>`; set these as Cloudflare production build variables. Set `CONTEXT=deploy-preview` for Cloudflare preview builds so preview output disallows indexing. Cloudflare copies `public/_headers` into `dist/` for security and cache headers.

For production builds, the SEO script queries only public published rows with the public Supabase key, writes canonical metadata pages for the listings present at build time, and includes them in the sitemap. New listings are visible in the app immediately, but search crawlers will get refreshed static metadata after the next production build.

## Environment variables

| Variable | Used by | Exposure |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Vite browser build | Public |
| `VITE_SUPABASE_ANON_KEY` | Vite browser build | Public; database access is still restricted by RLS |
No private Supabase secret is required by the app or Cloudflare Pages. Never put a service-role/secret key in browser code, build variables, this repository, or chat. `.env.example` contains only the two public variable names.

## Supabase setup and database migration

1. Create a Supabase project in the intended launch region and copy its project URL and publishable/anon key into the public frontend variables.
2. Open the Supabase SQL Editor and run the files in `supabase/migrations/` in filename order. A Supabase CLI is not currently configured in this workspace.
3. Confirm the `listing-media`, `profile-media`, and `verification-evidence` private buckets exist with their migration size/type limits and policies. Listing media is uploaded directly by authenticated users under the owner-folder policy; no service-role key is involved.
4. In Supabase Auth, set the production Site URL and allow the production and preview callback URLs. Keep email confirmation enabled for a public launch and use the reset link flow to confirm its redirect URL.
5. The migration turns on RLS for every application table. Owners control their listings and locations; public reads are limited to published listing data; conversation and viewing rows require participant access. Only an administrator role stored in trusted `app_metadata` may approve verification records.

See [HOMIVA_DATABASE_DESIGN.md](./HOMIVA_DATABASE_DESIGN.md) for the data model, access rules, indexes, and deletion behavior.

## Cloudflare Pages and GitHub deployment

1. Push the HOMIVA source to a GitHub repository. This checkout currently has no Git remote and its project files are untracked; `.gitignore` excludes `.env` and `.env.*` except the blank `.env.example`.
2. In Cloudflare, create a **Pages** project and connect that GitHub repository. Choose the Vite preset, repository root, production branch, build command `npm run build`, and output directory `dist`. Leave automatic Git deployments enabled.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Cloudflare **Production** build variables. Add a separate staging Supabase project to Preview only if preview builds need working data features.
4. Set `CONTEXT=production` and `URL=<canonical HTTPS origin>` in the Cloudflare Production build environment for sitemap/canonical generation. Set `CONTEXT=deploy-preview` in Preview. Update `URL` if the canonical domain changes.
5. Set Supabase Auth Site URL and allowed redirects to the actual production origin; verify confirmation and password-reset email links.
6. Apply all four ordered files in `supabase/migrations/` to the intended Supabase project. Test signup, listing publication, photos, saves, messages, viewing requests, and RLS with separate accounts before public launch.

No project URL or production credentials are present in this workspace, so public deployment and live-device verification are pending the authenticated provider setup. No tunnel, laptop server, or localhost API is part of the production design.

## Free-tier limits

Provider quotas change. As checked on 2026-10-07, Supabase Free includes two active projects, 500 MB database per project, 1 GB file storage, 5 GB egress, and 50,000 monthly active users; low-activity Free projects may pause after seven days, and downloadable database backups are not included. Check the current [Supabase billing guide](https://supabase.com/docs/guides/platform/billing-on-supabase) and [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod) before launch.

Cloudflare Pages Free currently includes Git builds and unlimited static requests within its published limits. Supabase database, storage, and email usage remain separate. Review the current [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/) and [Supabase billing guide](https://supabase.com/docs/guides/platform/billing-on-supabase) before launch.

## Security and operations

- Browser code contains only Supabase's public client key. RLS is the authorization boundary; UI checks alone are not trusted.
- Listing images are private WebP objects with UUID paths and a 1.5 MB bucket limit. The client checks the RIFF/WebP signature and size, Storage RLS restricts writes to the owner's folder, and an `auth.uid()`-bound database function limits uploads to 10 per UTC hour and 30 per UTC day. The service-role key is neither required nor referenced by production app code.
- Public map pins are rounded to two decimal places; precise location rows are owner-only.
- Conversations require membership. Messages and viewing requests have participant-scoped RLS, bounded fields, transition policies, and basic rate limits.
- Review [HOMIVA_SECURITY_AUDIT.md](./HOMIVA_SECURITY_AUDIT.md) before connecting real accounts or deploying.
- The no-secrets scan and deploy tests must be repeated against the actual GitHub repository and public URL before launch.

## Current product limits and scaling path

Search is deterministic and currently focused on INR and the original Pune market. Currency/country fields, relational data, Storage, and location privacy are prepared for expansion; that does not mean international inventory, global localization, a verification operation, or AI features are live. Public listing URLs are client-routed and should be validated with the chosen search/social crawlers after deployment.

Next: AI housing assistant, recommendations, map intelligence, trust and verification operations, advanced search, notifications, and analytics. Later: mobile app, multilingual markets, international expansion, scalable search, payments/subscriptions, and owner tools. Keep each addition behind explicit data and authorization rules.
