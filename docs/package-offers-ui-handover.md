# Package Offers (camps, tours, accommodation, experiences, courses) - UI Handover

**Status 2026-09-29:** live in Supabase with **5 example rows, one per type**. Source: bstoked.net
listings. Backend only, no frontend was written.

> **TL;DR:** Read the view **`app_package_cards`** exactly like `app_cruise_offer_cards`. Its first
> **71 columns are identical to the cruise view** (same names, order and types), so the existing
> cruise zod schema and mapper accept the rows unchanged (verified against KCS
> `src/features/catalog/supabase.ts` on `origin/main`). Three package columns are appended:
> **`package_type`**, **`price_unit`**, **`rooms`**. Images use the same private `cruise-images`
> bucket and signing as cruises.

> **Changed 2026-09-29:** the first version of this view (63 package-specific columns) is gone. If
> you built against it, switch to the cruise column names below.

---

## 1. Example rows (live)

| `package_type` | `offer_id` | Listing | What it exercises |
|---|---|---|---|
| `camp` | `6d45d2b9-e78f-4718-af6a-4df657f1e663` | Kite Camp Essaouira With Daily Coaching (Morocco) | package price €700 p.p., 7 days, rating 5.0 (1 review), 3 room types |
| `tour` | `761ff68a-a98e-443d-ad67-3065e6ecc015` | Kitesurf Brazil: 8 Days, 4 Spots, 1 Epic Trip (Ceará) | route with 4 stops, 2 of them with map pins |
| `accommodation` | `b0b6967f-cd18-4ab9-838f-c0c71bf0a8c4` | Nature Surf House (Tarifa, Spain) | **per-night** price (€20), 4 room types |
| `experience` | `2f07762a-eb40-4d26-a306-1d15637b0008` | Premium Kitesurfing Getaway in the North of Qatar | 5-star hotel + kiting, full board, €521 p.p., host currency USD |
| `course` | `bbb19c98-0fe3-4b03-b746-69fa7a258b47` | Kitesurfing Private and Partner Training (El Gouna, Egypt) | price without unit (`price_unit = other`), only 6 images |

## 2. Reading

- `select * from app_package_cards`, server-side with the service-role key (no anon grants,
  `security_invoker`), same as the cruise view.
- Schema: migrations `20260925120000_create_package_offers.sql` + `20260929120000_slim_package_offers.sql`
  in `0xAaronx0/KiteScout`.

## 3. How the cruise columns are filled for packages

Everything not listed here is filled exactly like for cruises (`title`, `summary`, `images`,
`skill_levels`, `kite_lessons`, `included_services`, `accommodation`, …).

| Column | For packages |
|---|---|
| `provider_trip_types` | `[package_type]`, e.g. `["camp"]`. The mapper's `tripType` therefore reads "camp" instead of "kite cruise" with no code change |
| `provider_id` | = `offer_id`. There is no provider table for packages; the listing is its own "provider" so the mapper keeps the provider block (type label, languages, bstoked badge) |
| `provider_name`, `provider_root_domain`, `provider_website_url`, `provider_contact_email`, `provider_contact_form_url` | `null` (bstoked shows only the host's first name, no contact) |
| `provider_languages` | the host's languages |
| `provider_bstoked_url` / `_rating` / `_review_count`, `provider_avg_rating` | the bstoked listing and its rating (avg = bstoked, the only source) |
| `itinerary_spots` | map pins, same shape as cruises: tours = route stops (null coords = label only); all others = one spot at the listing's location |
| `departure_port` | the "typical pickup" (airport, school, hotel) |
| `duration_days` | nights + 1, cruise convention (the mapper shows `duration_days - 1` nights); null for per-night stays and courses |
| `price_pp_cabin` + `price_pp_cabin_currency` | the bstoked "from" price as a whole number, **see `price_unit`** |
| `price_from_eur` | only for package prices (sortable trip price); null for per-night / per-unit prices |
| `optional_services` | paid add-ons incl. costs paid locally |
| `meal_plan` | cruise vocabulary (`breakfast`, `half_board`, `full_board`, …) |
| `countries` | `[country]` |
| `booking_modes` | `[]` |
| `vessel_*`, `season_*`, `dates`, `capacity_guests`, `comfort_level`, `offer_*`, TripAdvisor / Google, `price_charter_week*` | `null` |
| `is_reseller` | `false` |

## 4. The three package columns (the only UI changes needed)

| Column | Values | UI |
|---|---|---|
| `package_type` | `camp` / `tour` / `accommodation` / `experience` / `course` | type badge / filter (already flows into `tripType` via `provider_trip_types`) |
| `price_unit` | `package` / `per_night` / `per_day` / `other` | the cruise mapper renders `price_pp_cabin` as "from EUR X p.p.". Correct for `package`; for `per_night` show "/ night", for `per_day` "/ day", for `other` just "from EUR X" |
| `rooms` | `[{ "name", "description", "features": [] }]` | optional list of room / unit types (mainly accommodation); no prices (bstoked prices them per date) |

## 5. Gotchas

- **Prices:** EUR as bstoked displays them. Never convert. `pricing.host_currency` (e.g. USD) is
  informational; bstoked does not publish the amount in the host's currency.
- **Booking / CTA (open product decision, Aaron):** no provider email. `source_url` is the bstoked
  listing page, where an inquiry would go today. Keep packages out of the provider-email inquiry
  flow until that's decided (with `provider_contact_email = null` it has nobody to write to).
- **More detail:** day programme, payment/cancellation terms, spot notes, host stats and YouTube
  links are not columns; they are in `source_text` (table only, not in the view, like cruises)
  for the Scout chat.
- **Images:** max 12, ordered by `sort` (0 = hero), bstoked's gallery order; the experience's hero
  was re-curated by hand. Expect some heroes to need curation on rollout.

## 6. What comes next

- Full rollout on request: bstoked lists 31 camps, 3 tours, 13 accommodations, 4 experiences,
  1 course. One command in this repo: `pnpm cli bstoked-packages seed <bstoked ids…>` (`list`
  shows all ids). Re-seeding keeps existing images (`--refresh-images` to reload).
- 3 listings (7129, 6892, 6903) carry a broken type id (`2088`) on bstoked's side; they look like
  courses and are skipped until someone confirms the type.
