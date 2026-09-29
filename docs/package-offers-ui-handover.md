# Package Offers (camps, tours, accommodation, experiences, courses) - UI Handover

**Status 2026-09-29:** live in Supabase with **6 example rows, one per type + a second accommodation with 9 room types**. Source: bstoked.net
listings. Backend only, no frontend was written.

> **TL;DR:** Read the view **`app_package_cards`** exactly like `app_cruise_offer_cards`. Its first
> **71 columns are identical to the cruise view** (same names, order and types), so the existing
> cruise zod schema and mapper accept the rows unchanged (verified against KCS
> `src/features/catalog/supabase.ts` on `origin/main`). Three package columns are appended:
> **`package_type`**, **`price_unit`**, **`rooms`** (room types with price and a captioned photo, §4). Images use the same private `cruise-images`
> bucket and signing as cruises.

> **Changed 2026-09-29:** the first version of this view (63 package-specific columns) is gone. If
> you built against it, switch to the cruise column names below.

---

## 1. Example rows (live)

| `package_type` | `offer_id` | Listing | What it exercises |
|---|---|---|---|
| `camp` | `6d45d2b9-e78f-4718-af6a-4df657f1e663` | Kite Camp Essaouira With Daily Coaching (Morocco) | package price €700 p.p., 7 days, rating 5.0 (1 review), 3 room types |
| `tour` | `761ff68a-a98e-443d-ad67-3065e6ecc015` | Kitesurf Brazil: 8 Days, 4 Spots, 1 Epic Trip (Ceará) | route with 4 stops, 2 of them with map pins |
| `accommodation` | `b0b6967f-cd18-4ab9-838f-c0c71bf0a8c4` | Nature Surf House (Tarifa, Spain) | **per-night** price (€20), 4 room types but only 1 priced / with photo |
| `accommodation` | `24f89eb6-47a7-486f-8a7e-5700de3685cb` | Kenyaways Beach Accommodation and Restaurant (Kenya) | **the room-types example:** 9 rooms, each with photo, caption and price (€34-64 / night p.p.) |
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
| `rooms` | room / unit types, cheapest first (shape below) | "Rooms and prices" list; tapping a room jumps the slider to `image_sort` |

### Rooms and captioned room photos (agreed with Aaron, 2026-09-29)

```jsonc
// rooms: cheapest first; price = lowest of 12 monthly samples (15th of each month), 2 guests, per person
[{ "name": "Cult - One Queen double Bed (5ft)",
   "description": "This is the best room for budget travellers. …",
   "features": ["Walking distance to spot"],
   "price_from": 34, "price_currency": "EUR",
   "price_unit": "per_night",          // or "package" (for the package length), "per_day", "other"
   "priced_months": [1, 2, 3, …, 12],  // months in which bstoked returned a price for this room
   "image_sort": 3 }]                  // this room's photo in `images` (null = no photo)
```

- `images` = general photos first, then **one photo per room** whose `caption` is ready to show:
  `"Cult - One Queen double Bed (5ft) · from EUR 34 / night p.p."` (or `· price on request`).
  General photos have `caption = null`. Room photos also carry `"room": "<room name>"` (ignored
  by the zod schema).
- The mapper already puts `caption` into the media item's `label`, but the slider only uses it
  as `aria-label` (`match-card-media.tsx:136`). **UI change: render `label` visibly as a caption
  when the image has one.**
- `price_from = null` → "price on request" (bstoked returned no price or €0).

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
  was re-curated by hand. A room's photo is the host's first photo of that room, which is sometimes
  the bathroom or the pool rather than the bed; curate where it matters.
- **bstoked's prices are not always consistent:** for the Qatar experience the headline says
  "from €521 / 5 nights" while its only room costs €1,291 p.p. in the booking step. We show both as
  bstoked publishes them.

## 6. What comes next

- Full rollout on request: bstoked lists 31 camps, 3 tours, 13 accommodations, 4 experiences,
  1 course. One command in this repo: `pnpm cli bstoked-packages seed <bstoked ids…>` (`list`
  shows all ids). Re-seeding keeps existing images (`--refresh-images` to reload).
- 3 listings (7129, 6892, 6903) carry a broken type id (`2088`) on bstoked's side; they look like
  courses and are skipped until someone confirms the type.
