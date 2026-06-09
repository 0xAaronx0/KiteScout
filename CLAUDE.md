# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What KiteScout Is

An AI-powered kite travel assistant. End goal: a user describes a kite trip (destination, dates, skill level, budget) and the system searches a curated provider database, shortlists matching camps/tours/rentals, and handles the booking inquiry by emailing providers and relaying their reply.

**Status (2026-06):**
- **Provider database** — built via the automated discovery pipeline in `src/` (Tavily + Claude), including a cruise-specific layer (`cruise_providers` / `cruise_locations`).
- **Kite Cruise Finder** — a Next.js 15 app in `web/`, **live at https://kitescout.tech** (the cruise finder is the main app at `/`, with `/cruise` kept as an alias). Searches the cruise tables; users swipe to shortlist. This is the current focus — see the project memory files for the standing scope directive (`scope-cruise-only`).

## Tech Stack

- **Language:** TypeScript (ESM), Node.js
- **AI:** Anthropic Claude via `@anthropic-ai/sdk` — Sonnet for high-volume extraction, Opus for analysis
- **Web search:** Tavily API (search + extract endpoints)
- **Database:** Supabase Postgres (cloud-hosted)
- **Runtime:** `tsx` for running TypeScript scripts directly

## Project Structure

```
src/
├── types.ts              # Shared types (TripType, ProviderStatus, ProviderExtraction)
├── lib/
│   ├── anthropic.ts      # Anthropic client + model constants
│   ├── tavily.ts         # Tavily search() and extract() wrappers
│   ├── supabase.ts       # Supabase client (service role key, bypasses RLS)
│   └── retry.ts          # withRetry() helper with exponential backoff
└── pipeline/
    ├── seed-queries.ts   # Builds and inserts the query matrix into discovery_queries
    ├── search.ts         # Runs pending queries via Tavily, stores URLs in raw_search_results
    ├── extract.ts        # Fetches each URL via Tavily extract, classifies with Claude, upserts providers
    └── dedupe.ts         # Claude-assisted cross-domain duplicate detection
supabase/
└── migrations/
    ├── 20260430000000_initial_schema.sql
    ├── 20260504000000_create_cruise_providers.sql
    └── 20260505000000_create_cruise_locations.sql
```

## Cruise Finder Web App (`web/`)

A Next.js 15 (App Router, ESM) app — **the live product at https://kitescout.tech**.

```
web/
├── app/
│   ├── page.tsx                  # renders <CruiseFinder/> at /  (also /cruise alias)
│   ├── layout.tsx                # metadata + viewport (pinned to 1× to stop iOS zoom)
│   └── api/
│       ├── cruise-search/        # POST {country} → exact match; POST {destination} → AI parse
│       ├── cruise-destinations/  # GET: top countries by cruise-provider count (start-page chips)
│       ├── cruise-provider/      # GET: one provider by id (map deep-link)
│       └── offer · og · map-pin · availability   # per-card enrichment
├── components/
│   ├── CruiseFinder.tsx          # start page + search flow + results header
│   ├── SwipeDeck.tsx / SwipeCard.tsx   # Tinder-style swipe stack
│   └── MiniMap · WindBars · Reviews · Availability
└── lib/
    ├── match-cruise.ts           # core matching against cruise_locations / cruise_providers
    ├── cruise-destinations.ts    # start-page country counts (must equal what a chip returns)
    └── supabase.ts (lazy getSupabase) · types.ts · wind-stats.ts · availability.ts
```

**Deploy (push-to-deploy):** push to `main` touching `web/**` → GitHub Actions builds & pushes
`ghcr.io/0xaaronx0/kitescout:latest`, then calls the Hostinger API to recreate the container and
health-checks the site (Hostinger VPS behind Traefik). Non-`web/**` changes do NOT deploy.
**Full infra + the recurring build/deploy gotchas live in the project memory files**
(`vps-deployment`, `deploy-gotchas`) — read them before any deploy work.

**Local dev:** `npm --prefix web run dev`. The harness shell exports `ANTHROPIC_API_KEY=""`
(empty) and Next won't override it, so inject the key when starting dev (see `deploy-gotchas`).
CI-parity build before pushing: `cd web && mv .env.local .env.local.bak && npm run build; mv .env.local.bak .env.local`.

## Commands

```bash
pnpm install              # install dependencies

pnpm cli seed             # generate ~4,000 queries (EN + DE, all locations × categories)
pnpm cli search [n]       # run pending Tavily searches, batch size n (default 50); loops until done
pnpm cli extract [n]      # extract providers from unprocessed URLs, batch n (default 30); loops until done
pnpm cli dedupe           # mark cross-domain duplicate providers
pnpm cli status           # show counts: queries / URLs / providers
pnpm cli cruise-locations # extract validated cruise-only spots → cruise_providers / cruise_locations
```

## Pipeline Architecture

The pipeline runs in four sequential stages, each fully resumable (idempotent):

1. **Seed** — `buildQueryMatrix()` generates `(EN categories) × (locations)` + `(DE categories) × (locations)` + global queries. Upserts into `discovery_queries` (unique on query + language + engine + page).

2. **Search** — Fetches rows where `executed_at IS NULL`, calls `tavilySearch()` with `search_depth: advanced, max_results: 20`, stores URLs in `raw_search_results`, marks query as executed. Runs in a loop until no pending queries remain.

3. **Extract** — Fetches unprocessed URLs, calls `tavilyExtract()` for full page content (falls back to snippet), sends to Claude Sonnet with a structured extraction prompt. Upserts into `providers` (unique on `root_domain`) and `provider_locations`. Skips URLs whose domain is already in the DB.

4. **Dedupe** — Groups `new` providers by country, sends each group to Claude Opus to identify cross-domain duplicates, marks losers with `status = 'duplicate'`.

## Database Schema

Four tables:

| Table | Key | Purpose |
|---|---|---|
| `providers` | `root_domain` (unique) | One row per kite business |
| `provider_locations` | — | Countries/spots where a provider operates |
| `discovery_queries` | `(query, language, engine, page)` | Search queries and their execution state |
| `raw_search_results` | `(query_id, url)` | Raw URLs from searches, linked to extracted providers |

`providers.trip_types` is a `TEXT[]` array of: `camp`, `safari`, `cruise`, `tour`, `school`, `lessons`, `rental`, `equipment_rental`.

`providers.status` lifecycle: `new` → `verified` (manual) or `dead` or `duplicate`.

**Cruise layer** (populated by `pnpm cli cruise-locations`; this is what the web app queries):

| Table | Purpose |
|---|---|
| `cruise_providers` | One row per kite-cruise business; `status` excludes `dead`/`duplicate` |
| `cruise_locations` | Cruise spots per provider — `country` / `region` / `spot_name` + `lat`/`lng` + `confidence` |

Matching rule the web app relies on: a country chip = distinct valid providers with a
`cruise_locations.country` equal to that country (case-insensitive). `match-cruise.ts` and
`cruise-destinations.ts` must stay in sync so a chip's number equals the cards it shows.

## Environment Variables

```
ANTHROPIC_API_KEY
TAVILY_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY   # service role bypasses RLS — only used server-side
```

## First-Time Setup

1. Create a free project at [supabase.com](https://supabase.com)
2. Run `supabase/migrations/20260430000000_initial_schema.sql` in the Supabase SQL editor
3. Copy `.env.example` → `.env` and fill in all four keys
4. `pnpm install`
5. `pnpm cli seed` then `pnpm cli search` then `pnpm cli extract`

## Planned Next Steps

**Shipped:** provider DB + cruise tables; the live Cruise Finder web app (search, swipe, mini-map,
top-destinations start page, per-card offer / reviews / availability / wind strip); push-to-deploy.

**Not yet built:**
- Admin UI for reviewing, enriching, and verifying provider records
- Spot characteristics data (flat/wave, beginner/advanced, crowded/remote)
- Booking request email flow (outbound inquiry + inbound reply relay) — **spec drafted:** `docs/booking-email-flow.md` (full relay via Postmark; ready for a focused build session)
- User auth and session storage
- (A general chat interface exists but is retired — cruise is the current focus)
