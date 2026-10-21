# Supabase Live State — verified ledger

**Last verified: 2026-07-10** (read-only REST probes against the live DB with the service-role
key; method at the bottom). This file is the answer to "which migrations are actually applied,
and what does the live DB really look like?" — questions the migration files alone cannot answer,
because **migrations are run manually by Aaron in the SQL editor**.

> **Truth hierarchy (standing rule from Aaron, 2026-07-10):** the live app
> (kitescout.bstoked.net), the `MartinMarzi/KiteCruiseScout` repo (`origin/main`), and the live
> Supabase are the truth. Docs — including this one — can be stale. When a doc and the live
> state disagree, probe the live state (see "How to re-verify") and fix the doc.

## Row counts (volatile — snapshot 2026-07-10)

| Object | Count | Notes |
|---|---|---|
| `cruise_providers` | 98 total | status: **95 `new` (active), 2 `dead`, 1 `duplicate`** |
| `cruise_offers` | 164 | |
| `app_cruise_offer_cards` (view) | 163 | 1 offer excluded by the view's dead/duplicate-provider filter (inferred — `duplicate_of` is 0 rows) |
| `cruise_locations` | 398 | |
| `offer_media_candidates` | 7 725 | status: 6 197 candidate, 36 selected (pending apply), 1 492 applied, 0 rejected |
| offers with `hero_video_url` | 35 | |
| providers with `contact_email` | 93 total / **91 of 95 active** | the 4 active gaps are exhausted research (memory `provider-email-coverage`) |
| review **links**: google / TA / bstoked | 39 / 26 / 13 (same on active basis; ≥1 source: 54/95) | memory "Google 39, TA 26" counts links |
| review **ratings**: google / TA / bstoked | 38 / 16 / 6 | numeric rating present; `avg_rating` set on 47 |

## Migration ledger

Both repos ship migrations against the **same** Supabase project. Applied = verified empirically
(object/column responds via REST), not from any log.

### This repo (`0xAaronx0/KiteScout`, `supabase/migrations/`)

| Migration | Applied? | Evidence (2026-07-10) |
|---|---|---|
| `20260430…`–`20260505…` (discovery schema, cruise_providers/locations) | ✅ | tables respond, live data |
| `20260609000000_create_booking_tables` | ❌ **NOT applied** | `booking_requests`, `inquiries`, `suppressions` → 404. File is also **untracked** in git. |
| `20260614000000_create_cruise_monitoring` | ✅ | `cruise_watch`, `cruise_changes` → 200 |
| `20260623…` (cruise_offers + review links + source_text + provider_pages + reseller) | ✅ | tables/columns respond |
| `20260624…` (wind_stats, offer attributes, region_conditions) | ✅ | tables → 200 |
| `20260708000000_add_google_reviews` | ✅ | `google_rating` → 200 |
| `20260709000000_add_avg_rating_and_media_candidates` | ✅ | `avg_rating` → 200, `offer_media_candidates` → 200 |
| `20260710160000_add_standardized_prices` | ✅ **applied 2026-07-10** (v2; live-verifiziert: View 149 Zeilen, 0 Reseller, Preisspalten vorhanden) | 5 Preisspalten (Originalwährung!) + Reseller-Hartfilter in der View. **Backfill gelaufen** (150 Offers geschrieben): 59x pp, 31x charter/Woche, 12x beide, 71x ohne (= Price on request); Herleitung je Offer in `price_basis_note`. |
| `20260925120000_create_package_offers` | ✅ **applied 2026-09-25** (Aaron; `package_offers` + `app_package_cards` → 200) | New `package_offers` table (camps/tours/accommodation from bstoked) + new view `app_package_cards`. Additive only: no cruise table/view touched (cruise view still 149, cruise_offers 164 after apply). **Seeded 2026-09-25/26** with 5 examples via `pnpm cli bstoked-packages seed 6980 7893 6951 7896 6955` (camp / tour / accommodation / experience / course, under `cruise-images/packages/`). |
| `20261021120000_offer_disciplines` | ✅ **applied 2026-10-21** (Aaron via SQL editor; pre-check: live `pg_get_viewdef` md5 `app_package_cards` = e574f474… (3298 chars), `app_cruise_offer_cards` = 93507269… (2420 chars), equal to the PGlite builds; verified after via REST: both columns 200, `app_package_cards` 79 cols (last `disciplines`) 305 rows, `app_cruise_offer_cards` 73 cols 148 rows, `package_offers` 311, `cruise_offers` 164 (all unchanged); `cs.{snowkite}` 13 / `cs.{wingfoil}` 99 / `cs.{kitesurf}` 292 packages, cruises wingfoil 63 / kitesurf 148) | `package_offers.disciplines` + `cruise_offers.disciplines` (`text[]`, NOT NULL, default `{kitesurf}`, CHECK non-empty and `<@ {kitesurf,snowkite,wingfoil}`), appended at the END of `app_package_cards` (79 cols) and `app_cruise_offer_cards` (73 cols); filter with `@>` / PostgREST `cs`. Backfill: 13 snowkite + 99 kitesurf+wingfoil packages by `source_listing_id`, 63 kitesurf+wingfoil cruises by id. Source of truth: adapter `disciplines` (packages), `src/lib/disciplines.ts` in the cruise extractor (cruises). Code pushed after the apply. KCS#239. |
| `20261014120000_package_live_availability` | ✅ **applied 2026-10-14** (Claude via SQL editor after Aaron's OK; pre-check: live `pg_get_viewdef` md5 = the 20261009120000 view built in PGlite (365d6022…, 3201 chars); verified after: `app_package_cards` 78 cols, last four `operator_id, live_availability, availability_checked_at, instant_booking`, 224 rows, `package_offers` 230, cruise view 148) | `package_offers.live_availability` (bool, default false), `availability_checked_at` (timestamptz), `instant_booking` (bool, default false), appended to `app_package_cards`. Badge-ready, two levels (rule from Aaron 2026-10-14, `badgeCols` in `src/offers/ingest.ts`): `live_availability` = open future date in the provider's own engine on the last complete live run; `instant_booking` = instantly bookable site (adapter `instantBooking`, verified per site) AND future dates (live: open date; else a priced future slot not sold out/closed). Capabilities: `liveAvailability` 40 adapters, `instantBooking` 98. State 2026-10-14: 38 live badges, 64 instant badges (36 live-checked, 28 bookable online directly). `availability_checked_at` moves on every complete live run. App does not read them yet (KCS PR: badges "Live availability" / "Instant booking"). |
| `20261009120000_offer_slots` | ✅ **applied 2026-10-12** (Aaron; verified: `offer_slots`, `offer_slot_history`, `offer_sources` → 200; `app_package_cards` 75 cols, 20 rows; cruise view 149 unchanged) | Price/availability per date or unit for adapter-ingested packages (`src/offers/`, `pnpm cli offers ingest --slots`): `offer_slots` (current state, `active=false` on retraction, `date_precision`, `price_valid_until`, `price_total`, `package_nights`, `min_nights`), `offer_slot_history` (one row per change), `offer_sources` (per adapter: hashes, run history, `quote` = live-quote recipe read by the KCS route `/api/catalog/quote`). View: CREATE OR REPLACE of KCS `20261006100020`, identical except `dates` = future dated slots of tours/camps (diff-checked; `provider_bstoked_url` kept as `source_url` per Aaron). **Filled 2026-10-12**: 123 slots after the first run; accommodation bands by price/availability change (Vila Guará 50 bands + 18 room samples, Kite Village 15 night bands). Any future view migration (either repo) must keep the `dates` expression. |
| `20260930120000_add_cruise_rooms` | ✅ **applied 2026-09-30** (Aaron; view 72 cols, first 71 unchanged; all 149 view rows pass the KCS zod schema) | `cruise_offers.rooms` (jsonb, default `[]`) + `app_cruise_offer_cards` = live 71 columns verbatim (CREATE OR REPLACE) + `rooms`; `app_package_cards` re-created so both share 72 columns. Validated in PGlite against the live column list; a view missing a column is rejected. Coordinate with KCS (both repos own the cruise view). **Filled 2026-09-30** via `pnpm cli cruise-rooms --from <reviewed dry run>`: **49 offers with cabins** (9 bstoked-matched, 40 from text; 124 cabins, 58 priced: 53 provider_site / 5 bstoked); price rule A: provider site sets the price, bstoked prices only where the site has none (3 offers, `price_source: bstoked`); 12 open bstoked cabin photos in `offer_media_candidates` (note `cabin: <name>`; 5 of an ambiguous match set to `rejected`). Pending offers extracted the same day via OpenRouter (LLM calls moved from Anthropic direct to OpenRouter, commit after 5ac007f). |
| `20260929120000_slim_package_offers` | ✅ **applied 2026-09-29** (Aaron; live: `package_offers` 44 cols, `app_package_cards` 74 cols) | Packages moved onto the cruise field set: 31 package-only columns dropped, 7 cruise-named added; view rebuilt so its first 71 columns are identical (name/order/type) to `app_cruise_offer_cards`, + `package_type`, `price_unit`, `rooms`. `provider_id` = offer id, `provider_trip_types` = `[package_type]`. Rows/ids kept; re-seeded 2026-09-29 (images kept). All view rows pass the KCS view-row zod schema. Same day, no migration: `rooms` gained price_from/price_currency/price_unit/priced_months/image_sort (12 monthly bstoked samples) and `images` got one captioned photo per room; + example accommodation 7154 (6 rows total). |
| `20261019120000_create_country_climate_stats` | ✅ **applied 2026-10-19** (Claude via SQL editor after Aaron's OK; validated in PGlite, run twice; verified after via REST: `climate_country_points` 96, `country_climate_stats` 0 = not filled yet) | Climate per country and month for the KCS map layers (KCS#207), next to `wind_stats`. `climate_country_points`: one kite spot per `wind_stats` country incl. the 9 alias rows (seed = `docs/country_uv_stats_reference.csv`; elevation 0 = coastal override, 7 lake spots keep the lake elevation). `country_climate_stats`: `country` PK + `air_temp_min_months` / `air_temp_max_months` / `water_temp_months` (NULL at lakes) / `uv_months` / `uv_clear_sky_months` (12 values Jan..Dec), `sources`, `point_basis` (`kite_spot`), `updated_at`; cells via `climate_points` (FK). RLS on, no policies (service role only). **Filled 2026-10-21** (run 39574177973: 135 Copernicus cells, 0 failures; REST: `country_climate_stats` 96 rows). Source: Copernicus instead of the free Open-Meteo API (non-commercial only) - air/water temp ERA5 via CDS (secret `CDS_API_KEY`), UV = computed whole-number clear-sky noon max as guide value (Aaron 2026-10-21), `src/pipeline/copernicus.ts`. Known limit: ERA5 nearest grid point is often sea at island/coastal spots -> daytime max ~2-3 C low (e.g. Boracay 27-29 C). The same run moved 450 `offer_climate_stats` rows onto the cells it touched; Copernicus cells overwrote Open-Meteo cells sharing a 0.1-degree key. Rollback: `DROP TABLE country_climate_stats, climate_country_points;`. |
| `20261021130000_region_climate_stats` (file renamed from 20261021120000 on 2026-10-21 to avoid a version clash with offer_disciplines; SQL unchanged) | ✅ **applied 2026-10-21** (Claude via SQL editor after Aaron's OK; validated in PGlite, run twice; verified after via REST: `climate_region_points` 13, `climate_country_points` 96 -> 111, `region_climate_stats` filled by the next `climate-stats` run) | Climate regions for large countries with offers (Aaron 2026-10-21): `climate_region_points` (region_key, country, region_name, `iso_3166_2` text[] = admin-1 units the app colours, kite spot = median offer spot) + `region_climate_stats` (same arrays as `country_climate_stats`). Regions only where the climate differs from the country point: US-FL, US-HI, US-OR, AU-WA, AU-SA, AU-QLD, BR-SC, BR-SE (RJ+SP), ES-CN, ES-CT, MX-ROO, MA-NORTH (MA-01..09), JP-47; NSW snowkite deliberately not a region (Aaron). Unlisted admin-1 units fall back to the country row. Also 15 offer countries without a point added (Antigua, Bahamas, Portugal, Turks & Caicos, French Polynesia, Saint Martin, Grenada, Cook Islands, Tonga, Belgium, Cyprus, Greenland, Iceland, Barbados, Antarctica); the job adds future offer countries itself (median offer spot). Rollback: `DROP TABLE region_climate_stats, climate_region_points;` + delete the 15 country points. |
| `20261021180000_climate_wind_uv_cloudy` | ✅ **applied 2026-10-21** (Claude via SQL editor after Aaron's OK; validated in PGlite, run twice; verified after via REST: new columns present and NULL until filled, `climate_region_points` 14) | Wind + UV with clouds (Aaron 2026-10-21). `climate_points.wind_kiteable_months` (ERA5 share of kiteable days: >= 12 kn for >= 3 consecutive hours 08-19 local solar time, 2016-2025), `uv_cloudy_months` + `uv_cloudy_source` (CAMS all-sky daily max around noon, ADS, 2024-2025, one-off fill via `pnpm cli climate-uv-cloudy`). `country_climate_stats` / `region_climate_stats`: `wind_months` (Bstoked where real, i.e. not the placeholder 10; else ERA5 only in months with water >= 10 C; else NULL = no data; lakes without water temp get no ERA5 fill), `wind_source_months` (`bstoked`/`era5`/NULL per month), `uv_cloudy_months`, `uv_cloudy_source`. `sources` text unchanged (KCS pins it). Region IT-82 Sicily (Lo Stagnone). ERA5 vs Bstoked fit is weak (RMSE 28 pp, r 0.52), hence no calibration. Rollback: drop the new columns + delete region IT-82. |
| `20260711150000_revoke_anon_table_grants` | ✅ **applied 2026-07-11** (Aaron; Verify-Query danach: `anon_grants = NULL` auf allen Tables) | Defense-in-depth: revoked die inerten anon/authenticated-Default-Grants auf 14 älteren Tables + default privileges. Kein App-Impact (beide Apps nutzen nur service role). |

### KCS repo (`MartinMarzi/KiteCruiseScout`, `supabase/migrations/`)

| Migration | Applied? | Evidence |
|---|---|---|
| `20260625131500/143000`, `20260630120000` (create/extend/filter `app_cruise_offer_cards`) | ✅ (superseded by later view versions) | view responds |
| `20260625130000_create_country_wind_stats` | ✅ | `wind_stats` → 200 |
| `20260707152000_create_inquiry_messaging_tables` | ✅ | `inquiry_batches`, `provider_inquiries`, `inquiry_email_events`, `email_template_settings` → 200 |
| `20260708133000_create_analytics_events` | ✅ | `analytics_events` → 200 |
| `20260710090000_add_hero_video_and_google_to_cards_view` | ✅ **← this is the LIVE view definition** | live view has `hero_video_url`, `provider_google_*`, `provider_avg_rating`; lacks the price columns from our unapplied `20260710160000` |

## `app_cruise_offer_cards` — the shared view

- **DDL lives in migrations in BOTH repos** (KCS created it; our `20260710160000` is the next
  pending redefinition). The live definition as of 2026-07-10 = KCS `20260710090000`.
- **⚠️ Cross-repo hazard:** both repos use `CREATE OR REPLACE VIEW`. Whoever applies a view
  migration MUST make it a **superset of the current live view** (append columns at the END —
  `CREATE OR REPLACE VIEW` forbids reordering/removing), or they silently drop the other repo's
  columns and break the deployed app. Before applying: diff your definition against the live
  column list (probe below).
- View semantics: `security_invoker = true`, `REVOKE ALL … FROM anon, authenticated` (service
  role only); filters `duplicate_of IS NULL` and provider status not in (`dead`, `duplicate`).
- Live columns (2026-07-10, 68): offer fields (`offer_id`, `title`, `slug`, `source_url`,
  geography `continent/country/countries/region/departure_port/itinerary_spots`, vessel,
  `booking_modes`, suitability flags, season/dates, `pricing`/`price_from_eur`/`currency`/
  `offer_price_confidence`, `summary`, `images`, `hero_video_url`, `is_reseller`/`operated_by`,
  `extraction_confidence`/`manually_verified`, `updated_at`) + flattened provider fields
  (`provider_id/name/root_domain/website_url/contact_email/contact_form_url/languages/trip_types/
  passenger_capacity/cabin_count/verified_at/last_verified_at` + `provider_bstoked_*`,
  `provider_tripadvisor_*`, `provider_google_*`, `provider_avg_rating`,
  `provider_reviews_checked_at`).

## Storage buckets

- `cruise-images` — **private**; app signs paths server-side (1 h expiry). Never delete objects
  when re-curating; reassign `sort` instead.
- `cruise-videos` — **public** (deliberate: provider marketing clips, no PII; a `<video>` tag
  can't send auth headers, private would force signed URLs + lose CDN caching); holds the MP4s
  **and** their `-poster.jpg` stills (`src/lib/videos.ts` uploads both).
- **Bucket config hardened 2026-07-11** (verified via `GET /storage/v1/bucket`):
  `cruise-videos` → size limit 15 MB, MIME `['video/mp4','image/jpeg']` (JPEG needed for
  posters!); `cruise-images` → size limit 5 MB, MIME `['image/webp']`. Guardrail against
  pipeline bugs — only the service role can write anyway.

## RLS / privacy posture (verified 2026-07-11, SQL-editor probe)

- **All 19 public tables: `rls_enabled = true`, 0 policies → deny-all** for anon/authenticated.
  Nothing is publicly readable; the apps are unaffected because both use only the service-role
  key (which bypasses RLS). REST without a key → 401.
- **No anon grants remain on any table** (since `20260711150000_revoke_anon_table_grants`,
  applied 2026-07-11): the KCS-era tables never had them; the 14 older tables' inert default
  grants are revoked, and default privileges block them on future tables.
- `app_cruise_offer_cards` view: `security_invoker = true` + `REVOKE ALL FROM anon,
  authenticated` (service role only) — unchanged.
- Probe SQL for re-verification lives as a comment at the bottom of the
  `20260711150000` migration file.

## How to re-verify (the probe pattern)

Read-only, no SQL access needed — service-role key + PostgREST:

```bash
set -a && source web/.env.local && set +a
H1="apikey: $SUPABASE_SERVICE_ROLE_KEY"; H2="Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
# count:            curl -s -D - -o /dev/null -H "$H1" -H "$H2" -H "Prefer: count=exact" -H "Range: 0-0" "$SUPABASE_URL/rest/v1/<table>?select=id"   → content-range: 0-0/N
# object exists:    GET "$SUPABASE_URL/rest/v1/<table>?limit=1"            → 200 applied / 404 missing
# column exists:    GET "…/rest/v1/<table>?select=<column>&limit=1"        → 200 applied / 400 missing
# live view schema: GET "…/rest/v1/app_cruise_offer_cards?limit=1" | jq '.[0] | keys'
```

When you re-verify, update the date at the top and any changed rows.
