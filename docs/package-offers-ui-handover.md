# Package Offers (camps, tours, accommodation) - UI Handover

**Status 2026-09-25:** backend live in Supabase with **3 example rows, one per new type**. Backend
only, no frontend was written. Source of the data: bstoked.net listings.

> **TL;DR:** Read the new view **`app_package_cards`** (server-only, service-role key), exactly like
> `app_cruise_offer_cards`. One row per package; `package_type` is `camp`, `tour` or
> `accommodation`. Images use the **same private `cruise-images` bucket and the same signing** as
> cruises. Cruises are untouched and stay in `app_cruise_offer_cards`.

---

## 1. Example rows (live)

| `package_type` | `offer_id` | Listing | What it exercises |
|---|---|---|---|
| `camp` | `6d45d2b9-e78f-4718-af6a-4df657f1e663` | Kite Camp Essaouira With Daily Coaching (Morocco) | package price (€700 / 6 nights), rating 5.0 (1 review), day-by-day programme, 3 room types |
| `tour` | `761ff68a-a98e-443d-ad67-3065e6ecc015` | Kitesurf Brazil: 8 Days, 4 Spots, 1 Epic Trip (Ceará) | 2 alternative routes, 4 itinerary stops (2 with coords), no own map pin (see §5) |
| `accommodation` | `b0b6967f-cd18-4ab9-838f-c0c71bf0a8c4` | Nature Surf House (Tarifa, Spain) | per-night price (€20), 4 room types, extra expenses, YouTube video |

All three have 12 images, cancellation tiers, host info and coordinates.

## 2. Reading

- `select * from app_package_cards` with the service-role key, server-side only. The view has
  `security_invoker = true` and no anon/authenticated grants (same posture as the cruise view).
- The view only returns `is_active` rows and leaves out internal columns (`source_text`,
  `host_source_id`, `scraped_at`).
- Schema source: migration `supabase/migrations/20260925120000_create_package_offers.sql` in
  `0xAaronx0/KiteScout`. Need another column? Ask for it; it gets appended to the view.

## 3. Fields

Columns marked **(=)** have the same name and meaning as in `app_cruise_offer_cards`, so the cruise
mapping can be reused. **Nullable booleans mean "unknown", not false.**

| Column | Type | Notes |
|---|---|---|
| `offer_id` (=) | uuid | primary key |
| `package_type` | text | `camp` / `tour` / `accommodation` (`experience` / `course` allowed, none seeded) |
| `title` (=), `slug` (=) | text | `slug` is not unique; open listings by `offer_id` |
| `source`, `source_listing_id`, `source_url` (=) | text | `bstoked`, the bstoked id, the bstoked listing page (see §5 booking) |
| `continent` (=), `country` (=), `region` (=) | text | |
| `location_label` | text | as bstoked shows it, e.g. `Tarifa, Spain` |
| `lat`, `lng` | float | map pin (tours: the pickup point, see §5) |
| `pickup_location` | text | e.g. `Fortaleza airport` |
| `itinerary_spots` (=) | jsonb | ordered stops, same shape as cruises; tours only |
| `itineraries` | jsonb | day-by-day programme; a listing can have several routes (shape §4) |
| `skill_levels` (=) | text[] | `beginner` / `intermediate` / `advanced` |
| `wind_strength` (=) | text[] | `light` / `medium` / `strong`; **usually empty** (few hosts state it) |
| `wind_probability` | text | bstoked bucket, e.g. `80 - 100%` |
| `water_conditions` (=) | text[] | `flat` / `choppy` / `waves` (cruise vocabulary) |
| `spot_conditions` | text[] | finer raw tags: `shallow` / `flat` / `small_waves` / `big_waves` / `choppy` |
| `kite_services` | text[] | `gear_rental` / `gear_storage` / `lessons` / `spot_guidance` / `rescue` |
| `kite_lessons` (=), `equipment_rental` (=) | bool | derived from `kite_services` |
| `conditions_text` | text | prose about the spot |
| `suitable_for` | text[] | `solo` / `group` / `family` / `couple` / `non_rider` |
| `suitable_for_non_kiters` (=), `family_friendly` (=) | bool | derived from `suitable_for` |
| `ambience`, `experience_types` | text[] | e.g. `relaxed`, `lively bars` / `collective`, `private` |
| `meal_plan` (=) | text | **as published** (e.g. `Breakfast`, `Half board`), not the cruise enum |
| `dietary_options` | text[] | `vegetarian` / `vegan` / `special diets` |
| `flight_search_assistance` | bool | |
| `languages` | text[] | host languages |
| `included_services` (=), `optional_services` (=) | text[] | free-text labels |
| `extra_expenses` | text[] | not included, paid locally |
| `accommodation` (=) | text | prose |
| `rooms` | jsonb | room / unit types, **no prices** (bstoked prices them per date) |
| `duration_nights` | int | package length; null for per-night stays |
| `price_from`, `price_currency`, `price_unit` | numeric, text, text | see §5 price label |
| `price_basis_note` (=), `pricing` (=) | text, jsonb | provenance; `pricing.raw` is the original label |
| `payment_terms`, `deposit_pct` | text, int | e.g. `20% upfront and the rest later directly to the host.` |
| `cancellation_policy` | jsonb | refund tiers (shape §4) |
| `summary` (=) | text | the host's own summary (not AI-written) |
| `description_sections` | jsonb | remaining prose sections in page order (`The Destination`, `The Experience`, …) |
| `images` (=) | jsonb | same contract as cruises (§4) |
| `hero_video_url` (=) | text | null for all bstoked rows |
| `video_urls` | text[] | YouTube watch URLs as published |
| `host_name`, `host_member_since`, `host_response_rate`, `host_response_time`, `host_verified` | | bstoked shows the host's first name only |
| `bstoked_rating`, `bstoked_review_count` | numeric, int | on the listing itself; `0` reviews = none |
| `extraction_confidence` (=), `manually_verified` (=), `updated_at` (=) | | |

There are **no `provider_*` columns**: bstoked does not publish the operator's business name or contact.

## 4. JSON shapes (real values)

```jsonc
// itineraries: one entry per route
[{ "title": "8 Days Wild Wind Route",
   "days": [{ "title": "Day 1-3 Jericoacora/Macapá", "text": "A vast area of flat and shallow water …\n\n-Breakfast\n-Transfer …" }] }]

// itinerary_spots: same as cruises; lat/lng null when geocoding was unsure → label only, no pin
[{ "name": "Delta do Parnaíba", "country": "Brazil", "region": null, "lat": -2.90, "lng": -41.78, "order": 2 }]

// rooms
[{ "name": "Double Room with Common Bathroom",
   "description": "Double room for families with a double bed and a single bed. Common bathroom.",
   "features": ["Walking distance to spot"] }]

// cancellation_policy: refund_pct applies when cancelling between min and max days before start (max null = open-ended)
[{ "min_days_before": 90, "max_days_before": null, "refund_pct": 100 },
 { "min_days_before": 60, "max_days_before": 90, "refund_pct": 70 },
 { "min_days_before": 0,  "max_days_before": 30, "refund_pct": 0 }]

// pricing
{ "raw": "From €1872 / 7 nights", "card_label": "€1872 (7 nights from)", "host_currency": "USD", "duration_days": null }

// images: sort 0 = hero; sign `path` from the private cruise-images bucket (same as cruises)
[{ "path": "packages/camp/kite-camp-essaouira-with-daily-coaching-6980/0.webp", "sort": 0,
   "width": 1280, "height": 853, "bytes": 36584, "caption": null,
   "source_url": "https://bstoked.azureedge.net/l-6980-….jpg?width=1920",
   "rights": { "status": "provider_site", "source_host": "bstoked.azureedge.net", … } }]
```

## 5. Display rules and gotchas

- **Price label:** `price_unit = package` → "from €700 / 6 nights" (`duration_nights`);
  `per_night` → "from €20 / night"; `per_day` → "/ day"; `other` → show `pricing.raw`.
  `price_from` is the EUR price bstoked displays. **Never convert currencies offer-side.**
  `pricing.host_currency` (e.g. USD) is informational only; bstoked does not publish the amount
  in the host's currency.
- **Booking / CTA (open product decision, Aaron):** there is no provider email for these rows.
  `source_url` is the bstoked listing page, which is where an inquiry would go today. Don't wire
  these into the provider-email inquiry flow until that's decided.
- **Tour map pin:** multi-stop tours have no single location on bstoked, so `lat`/`lng` is the
  geocoded pickup point (7893: Fortaleza airport). Use `itinerary_spots` for the route; stops
  with null coords show as labels only.
- **Wind:** `wind_strength` is mostly empty. Prefer the country-level `wind_stats` (as for
  cruises) plus `wind_probability`.
- **Text:** `summary`, `conditions_text`, `accommodation`, section and day texts contain `\n`
  paragraph breaks; render them as paragraphs.
- **Images:** max 12, ordered by `sort`. Same signing code as cruises works unchanged.
- **Rating:** `bstoked_rating` + `bstoked_review_count` belong to the listing, not a provider.
  Review texts are not public on bstoked, so there are none.

## 6. What comes next

- Full rollout on request: bstoked currently lists 31 camps, 3 tours, 13 accommodations (plus
  4 experiences, 1 course). Seeding more is one command in this repo:
  `pnpm cli bstoked-packages seed <bstoked ids…>` (`list` shows all ids). The row shape stays the same.
- Not built yet: per-date room prices, availability, operator identity, review texts.
