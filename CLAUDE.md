# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What KiteScout Is

An AI-powered kite-cruise travel product. A user describes a kite trip, the system matches a
curated cruise-provider database and (eventually) handles the booking inquiry by emailing
providers and relaying their reply.

## ⚠️ The product, the repos, and how we work (read this first)

**The product is the "Kite Cruise Scout" app — official URL https://kitescout.bstoked.net**
(a service of Bstoked.net, official since 2026-07-09; the same deployment also answers at
`kite-cruise-scout.vercel.app`). It is a **separate codebase**: repo **`MartinMarzi/KiteCruiseScout`**
(private; account `0xAaronx0` has access). **A persistent clone lives at
`/Users/aaronlindner/KiteCruiseScout`** — use it (always `git fetch origin` first, branch from
`origin/main`); only if it's missing, `gh repo clone MartinMarzi/KiteCruiseScout`. Scratchpad
clones vanish between turns and have caused stray-branch accidents — verify `pwd` before every
git command there.

**Collaboration rule (standing, from Aaron): in `MartinMarzi/KiteCruiseScout` NEVER merge or push
to `main` — create feature-branch PRs only; Martin reviews, merges, and thereby deploys.** Vercel
only deploys Martin-authored merges anyway (`0xAaronx0` has no Vercel project access, its commits
block deployment). Check open PRs before building on top of unmerged work.

**Truth hierarchy (standing, from Aaron, 2026-07-10): the live app, `MartinMarzi/KiteCruiseScout`
`origin/main`, and the live Supabase are the truth — docs can be stale.** When a doc disagrees
with live state, probe live (read-only REST pattern in `docs/supabase-live-state.md`) and fix the
doc. Where to look things up: this file → `docs/supabase-live-state.md` (verified migration
ledger + live schema/counts) → project memory. In the KCS repo trust `README.md`,
`docs/handoff.md`, and `git log` — its `docs/project-state.md` (second half), `roadmap.md`, and
`architecture.md` are known-stale Issue-era snapshots.

**This repo (`0xAaronx0/KiteScout`) is the data platform + admin/ops layer, not the product:**
- `src/` — discovery/extraction pipelines, cruise-offer extraction, media curation, provider
  monitoring, reviews (all via `pnpm cli …`). Direct pushes to `main` are fine here (ask Aaron
  before pushing, as usual).
- `web/` on **https://kitescout.tech** — serves our **admin surfaces we use daily**
  (`/admin/media` media curation, `/changes` change-approval queue, both `?key=CHANGES_ADMIN_KEY`)
  plus the **legacy** swipe-based cruise finder at `/`. **kitescout.tech is no longer the product
  surface — do not build end-user features here**; keep it alive for admin + as fallback.
- **Supabase is the shared source of truth.** The KCS app reads `app_cruise_offer_cards`
  (view over `cruise_offers` + provider rating fields), orders `images` by `sort` ascending,
  signs each `image.path` from the private `cruise-images` bucket server-side, and plays
  `hero_video_url` (public `cruise-videos` bucket). **Blast radius: any edit to the cruise
  tables/buckets is live in the product**, even without touching either codebase.

**KCS app media contract** (confirmed in `src/features/catalog/supabase.ts` +
`src/features/matching/match-cruise-offers.ts`): to re-curate images reassign `sort`
(best-first 0..n), keep `path` valid (don't delete bucket objects), `fallback:true` renders as
"representative provider image"; hero video is prepended as first media; max 12 media rendered.
The app caches the catalog in memory ~5 min, so DB changes can lag in the UI.

**Status (live-verified 2026-07-10 — details + method in `docs/supabase-live-state.md`):**
- **Cruise data** — 98 `cruise_providers` (95 active/`new`, 2 dead, 1 duplicate), 164
  `cruise_offers` (163 in the app view), 35 hero videos. Email coverage 91/95 active (the 4 gaps
  are exhausted research — see memory `provider-email-coverage`); review **links** Google 39 /
  TripAdvisor 26 / bstoked 13 (numeric **ratings**: 38/16/6); `avg_rating` set on 47 = mean of
  the available ratings.
- **Media curation (active workstream)** — Aaron works through `/admin/media` listing by listing;
  apply runs via CLI on request or the daily cron. Offers with <8 media are flagged "to be checked".
- **Monitoring (live)** — daily cron 06:00 UTC (`.github/workflows/monitor.yml`): applies approved
  changes → applies pending media selections → change-detection sweep. Volatile dates/price changes
  auto-apply; everything else waits in the `/changes` approval queue. Full re-extraction
  (`cruise-diff all`) only ~2×/year on request.
- **Booking email flow** — Phase 1 code exists but is **uncommitted** (untracked in this worktree)
  and gated off (`NEXT_PUBLIC_BOOKING_ENABLED`); booking migration `20260609000000` **not
  applied** (verified). ⚠️ The KCS app has its own **parallel, merged** Resend-based inquiry
  system that is further along — decide which system carries booking before investing here. See
  `docs/booking-email-flow.md` (status header).
- **Marketing launch** — concept fixed (`docs/marketing-launch-konzept.md`, v3) + provider opt-in
  mail drafted (unsent); both docs are **local-only/untracked** (this repo is public — don't
  commit them without Aaron's OK). Next step on Go = post-queue engine MVP. Posting happens via
  Bstoked's accounts, EN-only, approval queue.

## Tech Stack

- **Language:** TypeScript (ESM), Node.js; `tsx` for running scripts directly
- **AI:** Anthropic Claude via `@anthropic-ai/sdk` — Sonnet for high-volume extraction, Opus/Sonnet for analysis
- **Web search:** Tavily API (search + extract); Playwright for JS-rendered pages
- **Database:** Supabase Postgres + Storage (cloud-hosted)
- **Media:** sharp (WebP), ffmpeg-static (hero-video transcode 720p/faststart, ≤10 MB)

## Project Structure

```
src/
├── types.ts              # Shared types (TripType, ProviderStatus, ProviderExtraction)
├── lib/
│   ├── anthropic.ts      # Anthropic client + model constants
│   ├── tavily.ts         # Tavily search() and extract() wrappers
│   ├── supabase.ts       # Supabase client (service role key, bypasses RLS)
│   ├── images.ts         # image discovery + CDN upscaling (Wix/WordPress/Photon/Tilda) + WebP store
│   ├── videos.ts         # hero-video download → ffmpeg transcode → public bucket
│   ├── render.ts         # Playwright renderPageEx (scroll-lazy galleries, consent cookies)
│   ├── geocode.ts        # hardened geocoding ladder with region-bbox gates
│   └── retry.ts          # withRetry() helper with exponential backoff
└── pipeline/
    ├── seed-queries.ts / search.ts / extract.ts / dedupe.ts   # provider discovery
    ├── extract-cruise-*.ts       # cruise locations / offers / reviews extraction
    ├── media-candidates.ts       # cruise-media collect/apply (curation pipeline)
    └── monitor / diff modules    # provider change detection + surgical apply
supabase/
└── migrations/           # run manually in the Supabase SQL editor — which are ACTUALLY applied
                          # is recorded (verified) in docs/supabase-live-state.md
```

`src/_*.ts` files are ad-hoc scratch/QA scripts (run via `tsx src/_foo.ts`, never imported by
tracked code) — gitignored; don't mistake them for pipeline modules.

## Admin & Legacy Web App (`web/`)

Next.js 15 (App Router, ESM), live at **https://kitescout.tech** — admin surfaces + legacy finder.

```
web/app/
├── admin/media/           # media curation index + per-offer selector (?key=CHANGES_ADMIN_KEY)
├── changes/               # change-approval queue (Approve/Dismiss, ?key=CHANGES_ADMIN_KEY)
├── status/[token]/        # booking-request status page (booking flow, gated)
├── page.tsx               # legacy swipe finder (/, /cruise alias)
└── api/                   # cruise-search · cruise-destinations · offer · availability ·
                           # admin/media select · changes · booking · webhooks · version
```

**Deploy (push-to-deploy):** push to `main` touching `web/**` → GitHub Actions builds
`ghcr.io/0xaaronx0/kitescout:latest`, recreates the container via Hostinger API, health-checks,
and `/api/version` must show the new SHA. Non-`web/**` changes do NOT deploy.
**Infra + recurring build/deploy gotchas live in the project memory files** (`vps-deployment`,
`deploy-gotchas`) — read them before any deploy work.

**Local dev:** `npm --prefix web run dev` (or the `kitescout-web` launch config). The harness shell
exports `ANTHROPIC_API_KEY=""` (empty) and Next won't override it — inject the key when starting
dev (see `deploy-gotchas`). CI-parity build before pushing:
`cd web && mv .env.local .env.local.bak && npm run build; mv .env.local.bak .env.local`.

## Commands

```bash
pnpm install              # install dependencies (pnpm.onlyBuiltDependencies allows ffmpeg-static)

# Provider discovery (historic bulk phase; rarely re-run)
pnpm cli seed | search [n] | extract [n] | dedupe | status

# Cruise layer
pnpm cli cruise-locations           # validated cruise spots → cruise_providers / cruise_locations
pnpm cli cruise-offers              # crawl providers → structured cruise_offers (+ initial images)
pnpm cli cruise-reviews             # bstoked/TripAdvisor/Google review links + ratings (--all re-checks)

# Media curation (the active loop)
pnpm cli cruise-media collect [--domain X]   # scrape image/video candidates → offer_media_candidates
pnpm cli cruise-media apply   [--domain X]   # apply admin selection → buckets + cruise_offers.images

# Monitoring
pnpm cli monitor                    # daily change detection (also runs in the GitHub cron)
pnpm cli cruise-diff <domain>|all   # targeted / full before-after re-extraction diff
pnpm cli changes                    # inspect the change queue (approval happens on /changes)
```

## Pipeline Architecture

The discovery pipeline runs in four resumable stages (Seed → Search → Extract → Dedupe) — see
`src/pipeline/`. Details unchanged since the bulk build; the day-to-day loops now are
**media curation** (collect → human picks in `/admin/media` → apply) and **monitoring**
(monitor → surgical auto-apply for dates/price → `/changes` approval for the rest).

Media-apply invariant (hard-won): an offer's images are rebuilt from **every** sorted
`selected`/`applied` candidate — a retry of failed downloads must never replace the full set.
The select API resets both statuses on a new save.

## Database Schema

Discovery tables: `providers` (unique `root_domain`), `provider_locations`, `discovery_queries`,
`raw_search_results`, `provider_pages` (crawled page texts).

**Cruise layer (what the product reads):**

| Table | Purpose |
|---|---|
| `cruise_providers` | One row per kite-cruise business; contact email, review links + ratings (`bstoked_*`, `tripadvisor_*`, `google_*`, `avg_rating`, `review_match_notes`) |
| `cruise_locations` | Cruise spots per provider — `country`/`region`/`spot_name` + `lat`/`lng` + `confidence` |
| `cruise_offers` | One row per cruise **product**: location, vessel, `booking_modes`, suitability, season/dates, pricing, `itinerary_spots`, AI `summary`, curated `images` (paths in private `cruise-images` bucket), `hero_video_url` (public `cruise-videos` bucket). Unique on `(cruise_provider_id, slug)` |
| `offer_media_candidates` | Scraped image/video candidates per offer; `status` candidate→selected→applied (or rejected), `sort` 0 = hero |
| `cruise_watch` / `cruise_changes` | Monitoring snapshots + detected changes with approval status |
| `booking_*` tables | Booking email flow — migration `20260609000000` **not applied** (verified 2026-07-10); the KCS app's own `inquiry_batches`/`provider_inquiries` tables ARE live |

The KCS app reads the **`app_cruise_offer_cards` view** — when adding offer/provider columns the
product needs, extend that view via a migration in **both** repos' expectations (view migration
here, zod schema in KCS). ⚠️ **Both repos own `CREATE OR REPLACE VIEW` migrations for it** — any
new view migration must be a superset of the CURRENT live view (append columns at the end), or it
silently drops the other repo's columns. Diff against the live column list first
(`docs/supabase-live-state.md`). Our `20260710160000_add_standardized_prices` is committed,
pending apply, verified safe.

Matching rule the legacy web app relies on: a country chip = distinct valid providers with a
matching `cruise_locations.country`; `match-cruise.ts` and `cruise-destinations.ts` must stay in sync.

## Environment Variables

```
ANTHROPIC_API_KEY
TAVILY_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY   # service role bypasses RLS — only used server-side
CHANGES_ADMIN_KEY           # gates /admin/media and /changes (set on VPS + web/.env.local)
```

## Working Rules That Bit Us Before

- Always check Supabase reads for `error` — silent empty results have caused wrong conclusions.
- Migrations are run **manually by Aaron** in the Supabase SQL editor — never assume applied;
  check `docs/supabase-live-state.md` (or re-probe live as described there).
- Docs go stale (a "planned" header sat on a built feature for a month). Trust live app / KCS
  `origin/main` / live Supabase over any doc, and fix the doc when you catch a lie.
- TripAdvisor blocks direct fetches (search snippets only); never parse naked numbers from
  snippets (year-as-count bug). Google review counts need a Places API key.
- Provider sites: JS-only/SPA galleries need the Playwright render path; CDN thumbnails must go
  through `upscaleCdnUrl` (Wix, WordPress `-WxH`, Jetpack/Photon `?w=`, Tilda).
- The 4 providers without email are exhausted research — don't re-scan (see memory
  `provider-email-coverage`).

## Open / Next

- Aaron finishes media curation across all listings; apply on request or via cron.
- Apply migration `20260710160000` (standardized display prices), then backfill
  `price_pp_cabin_eur`/`price_charter_week_eur`.
- Booking: first DECIDE Postmark-Phase-1 (uncommitted here) vs KCS's merged Resend inquiry
  system; if Phase 1, gate the API routes by the flag, commit, then Phase 0 (Postmark/DNS/env +
  migration).
- Marketing engine MVP (post queue + approval UI) once Aaron gives the Go.
- Spot characteristics data (flat/wave, skill level) and provider-record verification UI — not built.
- The old general chat interface is retired from the UI — cruise is the product
  (`web/app/api/chat/` still exists as dead legacy code).
