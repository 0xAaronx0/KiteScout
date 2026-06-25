# Cruise Offers — UI Handover

Backend for **structured cruise offers + curated images + review links** is built (2026-06-23).
This is the data the new cruise UI should consume. Backend only — no frontend was written, by design.

> **TL;DR:** Read the new **`cruise_offers`** table (one row per distinct cruise product; a provider has many). Each offer carries location, vessel, booking modes, season/dates, pricing, ordered itinerary stops, an AI summary, and **up to 5 curated images**. Images live in a **private** Supabase Storage bucket — you must **mint signed URLs server-side**, you cannot hot-link them. Review links (bstoked/TripAdvisor) sit on `cruise_providers`.

---

## 1. Prerequisites / current state

- The schema is defined by the migrations in `supabase/migrations/` — `cruise_offers` (+ `source_text`, reseller flags, and the richer attributes below), `cruise_providers` review columns, `provider_pages` (full-text corpus), `region_conditions`, and `wind_stats`. All applied in Supabase.
- **Only a handful of test providers are populated so far** (kitesafaris, dragonfly, caribbean, goodbreeze, kiteboat, …) — a representative sample to build + preview against; expect many more rows + variety after the full sweep.
- **The full ~60-provider sweep runs after your sign-off**: `pnpm cli cruise-offers`, then `pnpm cli cruise-reviews`, then `pnpm cli region-conditions` (builds the per-region conditions).
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
| `skill_levels` | text[] | subset of `beginner` / `intermediate` / `advanced` |
| `included_services` / `optional_services` | text[] | what's included vs paid add-ons (free-text labels) |
| `comfort_level` | text | `budget` / `standard` / `premium` / `luxury` |
| `suitable_for_non_kiters` / `family_friendly` | bool | nullable = unknown |
| `accommodation` | text | cabin description (type, ensuite, AC…) |
| `meal_plan` | text | `all_inclusive` / `full_board` / `half_board` / `self_catering` |
| `capacity_guests` / `cabin_count` | int | |
| `water_conditions` / `wind_strength` | text[] | **RAW per-page signal only** — for display use `region_conditions` (below), don't read these directly |
| `season_text` | text | human window, e.g. "June–September" |
| `season_start_month` / `season_end_month` | smallint | 1–12, for filtering |
| `duration_days` | int | |
| `dates` | jsonb | concrete departures — see shape below (often null) |
| `pricing` | jsonb | structured prices incl. **every tier** in `options[]` — see shape below |
| `price_from_eur` | int | lowest **genuine per-person** price (never divided from a cabin price); null if none shown → **use for sorting/filtering** |
| `currency` | text | original quote currency (often USD) |
| `price_confidence` | text | `high` / `medium` / `low` — confidence in the extracted price (high = explicit per-tier prices) |
| `summary` | text | AI 2–3 sentence description |
| `source_text` | text | full readable text of the offer's source subpage; kept for the booking agent to answer free-form questions — **not for direct display** |
| `images` | jsonb | **array of stored images** — see §3 |
| `extraction_confidence` | text | `high\|medium\|low` (data quality, not a rating) |
| `manually_verified` | bool | false until a human checks it |
| `is_reseller` | bool | **true = affiliate listing** (this site resells another operator's cruise, e.g. "operated by a trusted partner"). **Exclude from results by default** |
| `operated_by` | text | the actual operator's name, when `is_reseller` and the page named them |
| `created_at` / `updated_at` | timestamptz | |

**JSONB shapes:**

```jsonc
// itinerary_spots — ordered stops. lat/lng are best-effort OSM Nominatim geocodes,
// often null for unusual/misspelled names; use `name` as the label, coords for maps only.
[{ "name": "Sal Rei", "country": "Cape Verde", "region": null,
   "lat": 16.18, "lng": -22.91, "order": 0 }]

// dates — whole field often null; WITHIN an entry every field
// (start_date / end_date / price / currency / status) may be null independently.
[{ "start_date": "2026-07-04", "end_date": "2026-07-11",
   "price": 1890, "currency": "EUR", "status": "available" }]

// pricing — options[] is the AUTHORITATIVE list of every tier shown; within an option,
// price / currency / basis may each be null (null-check them). per_person/per_cabin/
// whole_boat are convenience fields the model also fills — may be null or lag options[],
// so prefer options[].
{ "options": [
    { "label": "Shared Cabin (Solo Traveler)", "price": 1900, "currency": "EUR", "basis": "per_person" },
    { "label": "Private Cabin (2 Guests)",      "price": 3500, "currency": "EUR", "basis": "per_cabin" },
    { "label": "Full Catamaran (6 Guests)",     "price": 9900, "currency": "EUR", "basis": "whole_boat" } ],
  "per_person": 1900, "per_cabin": 3500, "whole_boat": 9900,
  "currency": "EUR", "raw": "from €1,900 p.p. (cabin share)" }

// images[] — see §3; `path` is a STORAGE PATH, not a URL. `sort` = display order
// (0 = primary); iterate by `sort`, not array order. An image may carry
// `fallback: true` (operator homepage hero, used when the offer page had no photo).
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

**Display:** surface `bstoked_rating` / `tripadvisor_rating` (+ counts) as trust badges linking to the matching `*_url`; expect many `tripadvisor_*` to be null (domain-corroborated only). `review_match_notes` is audit-only — don't show it.

> ⚠️ The old card read `vessel_name / vessel_type / typical_duration_days / price_per_person_eur` from `cruise_providers`. Those are sparse manual-enrichment fields — **prefer `cruise_offers` for vessel/price/duration going forward.**

### `cruise_locations` (existing — still drives map/search)
Per-provider spots with `country/region/spot_name/lat/lng/confidence`. The country-chip search in `web/lib/match-cruise.ts` + `cruise-destinations.ts` still uses this. Offers do not replace it; they enrich each provider.

### `region_conditions` (per-region water/wind — the display source for conditions)

Water/wind are properties of the **region**, so cruises **inherit** them — read conditions from here, matched on the offer's `(country, region)`, **not** from the offer's raw `water_conditions`/`wind_strength`.

| Column | Type | Notes |
|---|---|---|
| `region_key` | text (PK) | normalized `"country\|region"` (region `""` when absent) |
| `country` / `region` | text | |
| `water_conditions` | text[] | **union**: `flat` / `choppy` / `waves` (a region can have several) |
| `wind_strength` | text[] | **range**: `light` / `medium` / `strong` |
| `note` | text | one short traveler-facing sentence |
| `confidence` | text | `high` / `medium` / `low` — lower when sparse, conflicting, or LLM-inferred |
| `source_count` | int | providers that reported real conditions (`0` = LLM general-knowledge fallback) |

Lookup for a given offer:
```sql
select water_conditions, wind_strength, note, confidence, source_count
from region_conditions
where region_key = lower(coalesce(:country,'')) || '|' || lower(coalesce(:region,''));
```

Built by `pnpm cli region-conditions` — an LLM consensus per region that prefers what providers state and falls back to general kite-knowledge (lower `confidence`, `source_count = 0`) when none do. Use `confidence`/`source_count` to show conditions **softly** when they're inferred rather than provider-stated.

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
  .createSignedUrls(paths, 60 * 60); // 1-hour TTL; returns [{ path, signedUrl, error }], 1:1 with paths

// each item can fail independently — drop the ones with an error
const imageUrls = (data ?? []).filter(d => !d.error && d.signedUrl).map(d => d.signedUrl);
```

Pick one delivery model:
- **Signed URLs** (above) — simplest. Sign in the same server request that returns offers. URLs expire (re-sign on each load); fine for a swipe deck.
- **Proxy route** — `GET /api/cruise-image?path=…` that streams bytes from Storage (service role). Stable, cacheable URLs under your own domain; slightly more egress through the Next server.

Either keeps the bucket non-public. Do **not** make the bucket public.

This **replaces the old per-card live OG scrape** (`/api/og` + client-side logo filtering in `SwipeCard.tsx`): offers ship pre-curated, compressed, logo-filtered images.

- `images` is **always an array, never null**. When an offer's own page yields no usable photo, the pipeline falls back to the operator's **homepage hero image**, flagged **`fallback: true`** on that image — so a cruise is almost never imageless. `images` is empty only in the rare case the homepage had no usable image either; check `images.length > 0` and keep `/api/og` as the last-resort fallback. (A `fallback: true` image is operator-generic, not offer-specific — you may want a subtle "representative image" treatment.)
- Render images in ascending **`sort`** order (`0` = primary) — it's the stable display sequence; don't rely on array order.

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

Notes for display **and querying**:
- Treat nullable booleans as **"unknown"**, not false (don't render "no lessons" when it's just unstated). When filtering a facet, use `.eq('beginner_friendly', true)` — it matches only explicit trues and correctly excludes unknowns; avoid negated filters that sweep in nulls.
- Filtering by `price_from_eur` (or any numeric) **excludes null-valued rows** by SQL NULL semantics — `.gte('price_from_eur', 1500)` will not return offers with unknown pricing. Fetch unfiltered and sort/filter client-side if you need to keep them. `price_from_eur` itself is approximate (USD/GBP roughly converted) — show the original via `pricing.raw` / `currency` when present.
- `country` is **case-sensitive and nullable** — use `.ilike()` for case-insensitive matching, or filter by `continent` for broad buckets.
- **Exclude `is_reseller = true` by default** — these are affiliate listings (the site resells another operator's cruise). They mis-attribute and duplicate the real operator; surface them only behind an explicit "include resellers" toggle, if at all.
- **Re-run pruning:** re-running the extractor for a provider deletes offers whose title/slug changed. Don't persist `cruise_offers.id` as a permanent reference — the stable key is **`(cruise_provider_id, slug)`**.
- `extraction_confidence` is data-quality, **not** a user-facing rating — use the review fields for trust signals.
- A provider with zero `cruise_offers` rows is valid (extractor found no structured offer) — fall back to `cruise_providers` + `cruise_locations`.

---

## 5. Wind stats (per-country)

A separate, **already-built** enrichment (not part of the offer tables): country-level kite-wind probabilities scraped from bstoked.net, in `web/lib/wind-stats.ts`.

```ts
import { windMonthsForCountry } from '@/lib/wind-stats';

const months = windMonthsForCountry(offer.country); // number[12] (Jan→Dec), 0–100, or undefined
```

- Each value is the **percent of "windy days"** (≥3h in a row of ≥12 kn at a good local spot) for that month, January→December.
- **Country-level, not per-offer/spot** — look it up by `offer.country`. The helper is case-insensitive with a small alias table (`cabo verde`→`Cape Verde`, `uk`→`United Kingdom`, `grenada`→ Grenadines proxy, …).
- Returns **`undefined`** when bstoked doesn't cover the country — fall back to estimated data (the existing component does this automatically).
- Render with the existing **`<WindBars seed={provider.id} months={months} />`** (a 12-month strip with the current month highlighted; shows a deterministic mock curve when `months` is absent), or build your own from the array.
- Auto-generated; regenerate by re-scraping the bstoked map page's `data-data` attribute.

### Also available as a DB table: `wind_stats`

So you can query wind data directly (no need to import the lib). Same numbers as `windMonthsForCountry()`.

| Column | Type | Notes |
|---|---|---|
| `country` | text (PK) | bstoked country name; common variants (`usa`, `uk`, `grenada`, …) are included as extra rows |
| `months` | smallint[] | 12 values, **Jan→Dec**, each `0–100` (% windy days) |
| `is_alias` | bool | true for the variant rows (same data as their canonical country) |
| `updated_at` | timestamptz | |

```sql
select months from wind_stats where lower(country) = lower('Egypt');
-- months[1] = Jan … months[12] = Dec  (Postgres arrays are 1-indexed;
-- supabase-js returns a 12-element JS array, [Jan … Dec])
```

Lookup is case-insensitive via the `lower(country)` index, and the alias rows mean a raw `offer.country` (e.g. "USA", "Cabo Verde") matches without extra mapping. Returns `null`/empty when bstoked doesn't cover the country — fall back to estimated data. The table mirrors `web/lib/wind-stats.ts`; regenerate both together when bstoked data changes.

---

## 6. Out of scope / not built
- No frontend, API routes, or types for offers yet — all yours to design.
- `price_from_eur` is a heuristic conversion; if you need exact FX, do it at read time from `pricing` + `currency`.
- **No per-offer reviews** — all review signals (`bstoked_*`, `tripadvisor_*`) are **provider-level**, shared across that provider's offers.
- `source_text` is the **full page text, server-side only** (for the future booking agent) — never render it; use `summary` for any UI copy.
- Booking flow (`BookingRequestForm`, `/api/booking/*`) is a separate, gated feature — see `docs/booking-email-flow.md`.

**Questions on the data?** Ping the backend owner; the pipeline code is in `src/pipeline/extract-cruise-offers.ts` and `src/pipeline/extract-cruise-reviews.ts`.
