# Cruise Offers — UI Handover

Backend for **structured cruise offers + curated images + review links** is built (2026-06-23).
This is the data the new cruise UI should consume. Backend only — no frontend was written, by design.

> **TL;DR:** Read the new **`cruise_offers`** table (one row per distinct cruise product; a provider has many). Each offer carries location, vessel, booking modes, season/dates, pricing, ordered itinerary stops, an AI summary, and **up to 5 curated images**. Images live in a **private** Supabase Storage bucket — you must **mint signed URLs server-side**, you cannot hot-link them. Review links (bstoked/TripAdvisor) sit on `cruise_providers`.

---

## 1. Prerequisites / current state

- The two migrations must be applied in Supabase, and the pipeline must be run to populate data:
  - `supabase/migrations/20260623000000_create_cruise_offers.sql`
  - `supabase/migrations/20260623000100_add_provider_review_links.sql`
  - `pnpm cli cruise-offers` (populates offers + uploads images), `pnpm cli cruise-reviews` (review links).
- **Until the pipeline has run, `cruise_offers` is empty** and review columns are null. Check with the data owner whether it's been populated before wiring UI against live rows.
- Tables are in the same Supabase project the current app already uses.

---

## 2. Data model

### `cruise_offers` (NEW — primary source of truth for offers)

One row per distinct cruise product. `cruise_provider_id` → `cruise_providers.id` (many offers per provider).
Unique on `(cruise_provider_id, slug)`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `cruise_provider_id` | uuid | FK → `cruise_providers.id` |
| `title` | text | e.g. "Grenadines 8-Day Kite Cruise" |
| `slug` | text | stable per-offer key (with provider) |
| `source_url` | text | page the offer was extracted from |
| `continent` | text | derived; may be null for unknown countries |
| `country` | text | primary itinerary country |
| `region` | text | primary region / island group |
| `countries` | text[] | all countries the itinerary visits |
| `departure_port` | text | embarkation port |
| `itinerary_spots` | jsonb | **ordered named stops** — see shape below |
| `vessel_name` | text | |
| `vessel_type` | text | `catamaran\|sailing_yacht\|motor_yacht\|gulet\|dhow\|liveaboard\|speedboat\|other` |
| `booking_modes` | text[] | subset of `whole_boat\|per_cabin\|single_spot` |
| `beginner_friendly` | bool | **nullable = unknown** (don't treat null as false) |
| `kite_lessons` | bool | nullable = unknown |
| `equipment_rental` | bool | nullable = unknown |
| `season_text` | text | human window, e.g. "June–September" |
| `season_start_month` / `season_end_month` | smallint | 1–12, for filtering |
| `duration_days` | int | |
| `dates` | jsonb | concrete departures — see shape below (often null) |
| `pricing` | jsonb | structured prices — see shape below |
| `price_from_eur` | int | normalized lowest p.p. price → **use this for sorting/filtering** |
| `currency` | text | original quote currency (often USD) |
| `summary` | text | AI 2–3 sentence description |
| `images` | jsonb | **array of stored images** — see §3 |
| `extraction_confidence` | text | `high\|medium\|low` (data quality, not a rating) |
| `manually_verified` | bool | false until a human checks it |
| `created_at` / `updated_at` | timestamptz | |

**JSONB shapes:**

```jsonc
// itinerary_spots  (ordered; lat/lng best-effort, may be null)
[{ "name": "Sal Rei", "country": "Cape Verde", "region": null,
   "lat": 16.18, "lng": -22.91, "order": 0 }]

// dates  (whole field may be null when no concrete departures published)
[{ "start_date": "2026-07-04", "end_date": "2026-07-11",
   "price": 1890, "currency": "EUR", "status": "available" }]

// pricing  (any field may be null)
{ "per_person": 1890, "per_cabin": 3600, "whole_boat": 14000,
  "currency": "EUR", "raw": "from €1,890 p.p. (cabin share)" }

// images[]  — see §3; `path` is a STORAGE PATH, not a URL
[{ "path": "cruise-offers/<providerId>/<slug>/0.webp", "source_url": "https://…",
   "width": 1280, "height": 853, "bytes": 98213,
   "caption": "catamaran at anchor", "sort": 0 }]
```

### `cruise_providers` (existing + NEW review columns)

The business record (name, `website_url`, contact, `description`, etc.) is unchanged. New columns:

| Column | Type | Notes |
|---|---|---|
| `bstoked_url` | text | kite-specific review listing |
| `bstoked_rating` | numeric(2,1) | e.g. 4.6; may be null even when url is set |
| `bstoked_review_count` | int | |
| `tripadvisor_url` | text | **only set when domain-corroborated** (high precision, lower recall — expect many nulls) |
| `tripadvisor_rating` | numeric(2,1) | |
| `tripadvisor_review_count` | int | |
| `reviews_checked_at` | timestamptz | null = not yet checked |
| `review_match_notes` | text | why the match was accepted (audit trail; not for display) |

> ⚠️ The old card read `vessel_name / vessel_type / typical_duration_days / price_per_person_eur` from `cruise_providers`. Those are sparse manual-enrichment fields — **prefer `cruise_offers` for vessel/price/duration going forward.**

### `cruise_locations` (existing — still drives map/search)
Per-provider spots with `country/region/spot_name/lat/lng/confidence`. The country-chip search in `web/lib/match-cruise.ts` + `cruise-destinations.ts` still uses this. Offers do not replace it; they enrich each provider.

---

## 3. Images — the one real gotcha

Images are stored in a **private** Supabase Storage bucket named **`cruise-images`**. The DB stores the **storage path** (`images[].path`), not a public URL. You **cannot** put `path` in an `<img src>` directly.

**Mint a signed URL server-side** (the web app's `getSupabase()` already uses the service-role key — server-only; never ship that key to the browser):

```ts
import { getSupabase } from '@/lib/supabase';

// In a Server Component / Route Handler / server action:
const supa = getSupabase();
const paths = offer.images.map(i => i.path);
const { data } = await supa.storage
  .from('cruise-images')
  .createSignedUrls(paths, 60 * 60); // 1-hour TTL; data[i].signedUrl aligns with paths[i]

const imageUrls = (data ?? []).map(d => d.signedUrl).filter(Boolean);
```

Pick one delivery model:
- **Signed URLs** (above) — simplest. Sign in the same server request that returns offers. URLs expire (re-sign on each load); fine for a swipe deck.
- **Proxy route** — `GET /api/cruise-image?path=…` that streams bytes from Storage (service role). Stable, cacheable URLs under your own domain; slightly more egress through the Next server.

Either keeps the bucket non-public. Do **not** make the bucket public.

This **replaces the old per-card live OG scrape** (`/api/og` + client-side logo filtering in `SwipeCard.tsx`): offers ship pre-curated, compressed, logo-filtered images. Keep `/api/og` only as a fallback for offers whose `images` array is empty.

---

## 4. Recommended read pattern

Fetch offers joined to their provider, server-side, then sign images. Example:

```ts
const supa = getSupabase();
const { data: offers } = await supa
  .from('cruise_offers')
  .select(`
    id, title, summary, country, region, continent, countries,
    departure_port, vessel_name, vessel_type, booking_modes,
    beginner_friendly, kite_lessons, equipment_rental,
    season_text, season_start_month, season_end_month, duration_days,
    dates, pricing, price_from_eur, currency, itinerary_spots, images,
    cruise_provider:cruise_providers!inner (
      id, name, website_url, description,
      bstoked_url, bstoked_rating, tripadvisor_url, tripadvisor_rating
    )
  `)
  .eq('country', country)          // or filter by continent / season / price_from_eur
  .order('price_from_eur', { ascending: true, nullsFirst: false });
```

Then sign `images[].path` per offer (§3) before returning to the client.

Notes for display logic:
- Treat nullable booleans as **"unknown"**, not false (don't render "no lessons" when it's just unstated).
- `price_from_eur` is approximate (USD/GBP roughly converted) — show original via `pricing.raw` / `currency` when present.
- `extraction_confidence` is data-quality, **not** a user-facing rating — use the review fields for trust signals.
- A provider with zero `cruise_offers` rows is valid (extractor found no structured offer) — fall back to `cruise_providers` + `cruise_locations`.

---

## 5. Out of scope / not built
- No frontend, API routes, or types for offers yet — all yours to design.
- `price_from_eur` is a heuristic conversion; if you need exact FX, do it at read time from `pricing` + `currency`.
- Booking flow (`BookingRequestForm`, `/api/booking/*`) is a separate, gated feature — see `docs/booking-email-flow.md`.

**Questions on the data?** Ping the backend owner; the pipeline code is in `src/pipeline/extract-cruise-offers.ts` and `src/pipeline/extract-cruise-reviews.ts`.
