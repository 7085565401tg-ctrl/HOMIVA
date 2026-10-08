# HOMIVA public launch checklist

This file separates code readiness from the account access and operational work needed to launch HOMIVA publicly. The target is GitHub-connected Cloudflare Pages with Supabase Auth, PostgreSQL, and Storage.

## Ready in this workspace

- One responsive React/Vite web application with Supabase-backed accounts, listings, search, map, saved homes, messaging, and viewing requests.
- Versioned Supabase schema, RLS, Storage and Realtime setup in the four files under `supabase/migrations/`.
- Production build command: `npm run build`; static output directory: `dist`.
- Cloudflare Pages security headers in `public/_headers`; `netlify.toml` remains in the repository but is not used for the target deployment.
- `.gitignore` excludes `.env` files and `.env.example` contains blank public variable names only.
- Business and staged global-market proposal in `HOMIVA-GLOBAL-BUSINESS-PROPOSAL.md`.
- API health route: `/api/health`.
- No synthetic homes, owners, reviews, verification claims, traction, or partnerships are shipped as real inventory.

## Required before a worldwide public URL

1. **GitHub source:** create/select the HOMIVA repository, commit the source, and connect it to Cloudflare Pages. The current checkout has no remote and its source files are untracked. Never stage `.env` files or credentials.
2. **Cloudflare Pages:** choose the Vite framework, root directory, production branch, build command `npm run build`, and output directory `dist`. Enable automatic deployment from GitHub.
3. **Supabase production project:** add the two required public Vite variables in the Cloudflare Production build environment. Never use a Supabase secret/service-role key in browser variables.
4. **Database and Storage:** apply all four SQL migrations in filename order. Confirm RLS policies, triggers, private buckets, image limits, and Realtime publication in the actual project.
5. **Auth URLs:** configure Supabase Auth Site URL and allowed redirects for the production HTTPS origin. Test signup confirmation, login, logout, and password recovery.
6. **SEO build variables:** set `CONTEXT=production` and `URL=<canonical HTTPS origin>` in Cloudflare Production. Set `CONTEXT=deploy-preview` in Preview builds so preview robots output blocks indexing.
7. **Operations and policy:** choose the first launch market, support contact, privacy/terms, moderation owner, owner verification process, and lawful listing/photo consent.
8. **Real inventory and testing:** obtain owner consent and verify costs, availability, location privacy, image rights, and content. Exercise renter/owner flows and RLS with separate accounts before inviting the public.

## Production environment values

Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Cloudflare Pages build settings. They are public browser values; row-level security must protect every private database and storage operation. Keep actual `.env` files local and ignored. The SEO generator also reads `CONTEXT` and `URL` as described above; those are build metadata, not Supabase credentials.

## Recommended rollout

1. Push to a non-production branch and verify the Cloudflare Preview build; keep it non-indexable and use a separate Supabase staging project if testing data flows.
2. Apply migrations to the production Supabase project, then test RLS, storage, auth redirects, and account separation.
3. Confirm the production build, Cloudflare headers, direct SPA/listing routes, sitemap, HTTPS, and mobile/tablet/desktop behavior.
4. Publish support, privacy, terms, moderation and verification policies before inviting the public.
5. Start with permitted real listings in the validated market; expand only when supply, support, and local compliance are ready.

## Current limitation

No GitHub remote, Cloudflare Pages project, Supabase project, production origin, or public deployment is configured in this checkout. Cloudflare Pages can provide a public `pages.dev` origin; a custom domain and DNS setup are optional. Live Auth, database, Storage, Realtime, and security-header behavior still require provider-side verification.
