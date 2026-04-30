# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What KiteScout Is

An AI-powered kite travel assistant. End goal: a user describes a kite trip (destination, dates, skill level, budget) and the system searches a curated provider database, shortlists matching camps/tours/rentals, and handles the booking inquiry by emailing providers and relaying their reply.

**Current phase:** Step 1 — building the provider database through automated web discovery.

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
    └── 20260430000000_initial_schema.sql
```

## Commands

```bash
pnpm install              # install dependencies

pnpm cli seed             # generate ~4,000 queries (EN + DE, all locations × categories)
pnpm cli search [n]       # run pending Tavily searches, batch size n (default 50); loops until done
pnpm cli extract [n]      # extract providers from unprocessed URLs, batch n (default 30); loops until done
pnpm cli dedupe           # mark cross-domain duplicate providers
pnpm cli status           # show counts: queries / URLs / providers
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

## Planned Next Steps (not yet built)

- Admin UI (Next.js) for reviewing, enriching, and verifying provider records
- Wind probability context data per destination × month
- Spot characteristics data (flat/wave, beginner/advanced, crowded/remote)
- User-facing chat interface (trip preference extraction → provider matching)
- Booking request email flow (outbound inquiry + inbound reply relay)
- User auth and session storage
