# HOMIVA production readiness report

**Report date:** 2026-10-09
**Status:** Local code and build checks pass, but production launch and live verification are blocked on provider projects. A GitHub `origin` remote is configured; current local fixes remain uncommitted. This is not a production success report.

## Deployment endpoints

- **PUBLIC URL:** Not provisioned.
- **FRONTEND:** Cloudflare Pages configuration is prepared in `public/_headers`; no Cloudflare Pages project or public deployment exists in this workspace.
- **DATABASE:** Supabase Free schema/migrations are prepared; no project exists here and migrations are not applied.
- **AUTH:** Supabase Auth code is wired; dashboard URL, email-confirmation, and redirect settings are not configured.
- **STORAGE:** Supabase Storage buckets and RLS are prepared in SQL; no live buckets or uploads have been tested.
- **REALTIME:** `messages` publication and client subscription are prepared; no live channel has been tested.
- **GITHUB:** `origin` is configured and `master` tracks `origin/master` at the initial project commit. Current local fixes are not yet committed or pushed.

## Requested production test results

Each `FAIL` below means the production test could not be run because there is no public deployment; it does not claim the feature was observed failing on a live site.

| # | Test | Result |
| --- | --- | --- |
| 1 | Homepage | **FAIL — no public URL** |
| 2 | Sign up | **FAIL — Supabase Auth not configured** |
| 3 | Login | **FAIL — no live project** |
| 4 | Logout | **FAIL — no live project** |
| 5 | Profile | **FAIL — no live project** |
| 6 | Owner listing creation | **FAIL — no live database** |
| 7 | Image upload | **FAIL — no live Storage bucket** |
| 8 | Listing appears publicly | **FAIL — no live database/site** |
| 9 | Search | **FAIL — no live inventory** |
| 10 | Filters | **FAIL — no live inventory** |
| 11 | Listing details | **FAIL — no public URL** |
| 12 | Favorite | **FAIL — no live database** |
| 13 | Remove favorite | **FAIL — no live database** |
| 14 | Message owner | **FAIL — no live accounts/data** |
| 15 | Realtime message delivery | **FAIL — no live Realtime project** |
| 16 | Viewing request | **FAIL — no live database** |
| 17 | Owner accepts/rejects | **FAIL — no live accounts/data** |
| 18 | Mobile layout | **FAIL — two-phone production test not performed** |
| 19 | Refresh after login | **FAIL — no live Auth session** |
| 20 | Direct URL opening | **FAIL — no deployed hostname** |
| 21 | Error handling | **FAIL — production error paths not exercised** |
| 22 | Unauthorized access attempts | **FAIL — live RLS tests not performed** |
| 23 | Production build | **PASS — `npm run build` succeeded locally; Vite transformed 1,629 modules, with map code split into its own chunk** |
| 24 | API connectivity | **FAIL — no Supabase project configured** |
| 25 | Database persistence | **FAIL — migrations are not applied** |

## Security and mobile status

- **SECURITY TEST:** **FAIL / pending live verification.** Source review and the workspace credential-pattern scan found no credential values; `npm audit` found 0 vulnerabilities. The live RLS, Storage, Auth, and response-header tests have not run.
- **MOBILE TEST:** **FAIL / pending.** Responsive styles are present, but no external browser or two-phone test was possible.
- **LAPTOP-OFF TEST:** **FAIL / pending.** No public cloud URL exists to test while the laptop is off.

## Changes made

- Replaced production browser API calls with Supabase Auth and Postgres operations while retaining the existing HOMIVA UI and unused local server files/data.
- Added a relational schema with profiles, private locations, listings, photo metadata, favorites, conversations/members/messages, viewing requests, verification records, notifications, row-level policies, indexes, constraints, and rate limits.
- Added owner-only full listing reads through an `auth.uid()`-constrained database function; ordinary published listing reads cannot select owner or private-location identifiers.
- Added direct authenticated WebP uploads to private Supabase Storage, protected by owner-folder RLS, bucket MIME/size rules, signature checks, random paths, rollback cleanup, and a user-bound hourly/daily quota. No service-role key is required by this app.
- Added profile display-name editing, signup/login/logout, password reset, listing editing/deletion, multiple photos, private exact address, approximate public map pin, expanded search filters, saved homes, conversation history/replies, unread state, Realtime subscription, and viewing cancellation/owner decisions.
- Added Netlify configuration in an earlier deployment preparation and Cloudflare-compatible security headers in `public/_headers`. Cloudflare Pages supplies SPA fallback when no root `404.html` exists. The SEO generator creates production metadata/sitemap when `CONTEXT` and `URL` are configured.
- Fixed the CSP to allow OpenStreetMap tile images. Local browser fixture verified OSM tiles, marker selection and refresh, map-click pin placement, and pin dragging. Fixed stale markers when results change and made sign-out preserve the session if the sign-out request fails.
- Added safe public `.env.example`, `.gitignore` updates, and updated project, database, and security documentation.

## Known limitations

- Supabase project, Cloudflare Pages project, and real production URL are not configured. No local `.env` file exists; only `.env.example` is present.
- Database SQL has not been applied or parsed by a PostgreSQL instance; `psql`, Docker, and the Supabase CLI are unavailable locally. Auth redirects, Storage policies, Realtime, email delivery, and the serverless-free upload path still need live tests.
- A production build generates static listing metadata and sitemap entries for homes published at that build. New listings appear in app queries immediately but need a redeploy to refresh crawler metadata.
- The current interface is INR/Pune-focused. Currency and country columns exist, but localized pricing/search and multi-market operations are not complete.
- There is no verification moderator workflow, notification center, profile-photo flow, or account deletion/anonymization process. Verification status stays unverified until a trusted review operation exists.
- Free tiers have usage limits. Review current [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase), and the [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod) before launch.
- Free-tier Auth email delivery can be rate-limited; a custom SMTP provider may be needed for wider signup traffic and could have its own cost.

## Manual provider actions required

1. **GitHub:** Review, commit, and push the current local fixes to the configured `origin`. Confirm no `.env` file or credential is included in the commit.
2. **Supabase:** Create a new Free project for HOMIVA in the intended region. In **SQL Editor**, apply every file in `supabase/migrations/` in filename order and confirm all finish successfully.
3. **Cloudflare Pages:** Connect the HOMIVA GitHub repository. Set the Vite framework, repository root, production branch, `npm run build`, and `dist`. Add the two Supabase Vite variables. For SEO output, set `CONTEXT=production` and `URL=<canonical HTTPS origin>` in Production; set `CONTEXT=deploy-preview` in Preview.
4. **Supabase Auth:** Set **Authentication → URL Configuration → Site URL** to the production HTTPS origin and allow the production redirect origin. Verify confirmation and password-reset links.
5. **Cloudflare publish:** After the Git-connected deploy succeeds, confirm HTTPS, `robots.txt`, sitemap, direct `/homes/<id>/<slug>` loading, and response security headers. Manual `dist/` upload is not the primary deploy path.
6. **Production verification:** Create two test accounts, run all 25 tests above, repeat messaging/viewing and authorization attempts from two accounts, test on two phones, then turn off the laptop and re-open the public URL.

## Credentials to enter privately

- Enter the Supabase project URL and public publishable/anon key in Cloudflare Pages as the two `VITE_*` build variables. These are public client values and must remain protected by RLS.
- The app does not require a Supabase service-role key, database password, or SMTP secret. Do not put those in the repository or chat. If you later configure a custom SMTP provider, enter its credentials directly in that provider/Supabase dashboard.
- Sign in to GitHub, Supabase, and Cloudflare through their own official login pages; do not send login credentials or OTPs here.

## Next-generation roadmap

**Phase 2:** AI housing assistant, smart recommendations, map intelligence, verification/trust operations, advanced search, notifications, analytics.

**Phase 3:** Mobile app, multilingual experience, international expansion, scalable search infrastructure, payments/subscriptions, business and owner tools.
