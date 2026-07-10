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
| `20260710160000_add_standardized_prices` | ❌ **NOT applied** (v2: Preis+Währungs-Paare, KEINE _eur-Spalten mehr; + Reseller-Ausschluss) | Probe: `cruise_offers.price_pp_cabin` → 400. **Safe to apply:** DROP+CREATE view, Bestandsspalten identisch in Name+Reihenfolge, hängt 5 Preisspalten an UND filtert `is_reseller=true` hart aus der View (Aaron 2026-07-10: Reseller inaktiv → View 163→149 Zeilen). |

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
- `cruise-videos` — **public**; `hero_video_url` plays directly.
  (Bucket visibility is Supabase config, inferred from the signing/non-signing code paths in KCS.)

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
