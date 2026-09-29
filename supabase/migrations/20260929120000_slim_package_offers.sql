-- ============================================================
-- package_offers → the cruise field set (Aaron, 2026-09-29)
-- ============================================================
-- Packages (camp/tour/accommodation/experience/course) now use the same fields
-- as cruises. Only three package-specific columns remain:
--   package_type  camp | tour | accommodation | experience | course
--   rooms         room / unit types (accommodation)
--   price_unit    package | per_night | per_day | other  (the app otherwise shows "p.p.")
--
-- app_package_cards is rebuilt with EXACTLY the column names, order and types of
-- the live app_cruise_offer_cards (71 columns, 2026-09-29) plus those three
-- appended, so the KCS app can reuse its cruise schema + mapper. Cruise-only
-- columns are typed NULLs. There is no provider table for packages: the listing
-- is its own "provider" (provider_id = offer id, provider_name NULL) so the app
-- keeps the provider block, which carries the type label (provider_trip_types),
-- languages and the bstoked rating badge.
--
-- Dropped detail (spot tags, day programme, payment/cancellation terms, host
-- stats, videos, …) stays readable for the Scout chat via source_text.
--
-- Rows are kept (ALTER, not re-create); new columns start empty and are filled
-- by `pnpm cli bstoked-packages seed …` right after this migration (it keeps
-- the existing curated images).
-- Safe to re-run: IF [NOT] EXISTS everywhere. Touches no cruise object.
-- Rollback: git show b48344e:supabase/migrations/20260925120000_create_package_offers.sql
--   on a dropped package_offers + re-seed with the scraper from b48344e.
-- ============================================================

-- The old view references columns dropped below.
DROP VIEW IF EXISTS app_package_cards;

ALTER TABLE package_offers
  DROP COLUMN IF EXISTS source,                    -- also drops UNIQUE (source, source_listing_id)
  DROP COLUMN IF EXISTS location_label,            -- → itinerary_spots[0]
  DROP COLUMN IF EXISTS lat,                       -- → itinerary_spots[0]
  DROP COLUMN IF EXISTS lng,                       -- → itinerary_spots[0]
  DROP COLUMN IF EXISTS pickup_location,           -- → departure_port
  DROP COLUMN IF EXISTS itineraries,               -- → source_text
  DROP COLUMN IF EXISTS spot_conditions,           -- water_conditions covers it
  DROP COLUMN IF EXISTS wind_probability,          -- app uses country wind_stats
  DROP COLUMN IF EXISTS kite_services,             -- → kite_lessons / equipment_rental
  DROP COLUMN IF EXISTS conditions_text,           -- → source_text
  DROP COLUMN IF EXISTS suitable_for,              -- → suitable_for_non_kiters / family_friendly
  DROP COLUMN IF EXISTS ambience,
  DROP COLUMN IF EXISTS experience_types,
  DROP COLUMN IF EXISTS dietary_options,
  DROP COLUMN IF EXISTS flight_search_assistance,
  DROP COLUMN IF EXISTS extra_expenses,            -- → optional_services
  DROP COLUMN IF EXISTS duration_nights,           -- → duration_days (nights + 1)
  DROP COLUMN IF EXISTS price_from,                -- → price_pp_cabin (+ price_from_eur)
  DROP COLUMN IF EXISTS price_currency,            -- → currency / price_pp_cabin_currency
  DROP COLUMN IF EXISTS payment_terms,             -- → source_text
  DROP COLUMN IF EXISTS deposit_pct,
  DROP COLUMN IF EXISTS cancellation_policy,       -- → source_text
  DROP COLUMN IF EXISTS description_sections,      -- → source_text
  DROP COLUMN IF EXISTS video_urls,                -- YouTube; the app plays MP4 hero videos only
  DROP COLUMN IF EXISTS host_name,
  DROP COLUMN IF EXISTS host_source_id,
  DROP COLUMN IF EXISTS host_member_since,
  DROP COLUMN IF EXISTS host_response_rate,
  DROP COLUMN IF EXISTS host_response_time,
  DROP COLUMN IF EXISTS host_verified,
  DROP COLUMN IF EXISTS scraped_at;

ALTER TABLE package_offers
  ADD COLUMN IF NOT EXISTS departure_port          TEXT,
  ADD COLUMN IF NOT EXISTS beginner_friendly       BOOLEAN,
  ADD COLUMN IF NOT EXISTS duration_days           INTEGER,
  ADD COLUMN IF NOT EXISTS price_pp_cabin          INTEGER,
  ADD COLUMN IF NOT EXISTS price_pp_cabin_currency TEXT,
  ADD COLUMN IF NOT EXISTS price_from_eur          INTEGER,
  ADD COLUMN IF NOT EXISTS currency                TEXT;

-- Upsert key for the scraper (replaces the dropped (source, source_listing_id) constraint).
CREATE UNIQUE INDEX IF NOT EXISTS package_offers_source_listing_id_key
  ON package_offers (source_listing_id);

-- ============================================================
-- App read model: app_cruise_offer_cards columns 1:1, then 3 package columns
-- ============================================================
CREATE OR REPLACE VIEW app_package_cards
WITH (security_invoker = true) AS
SELECT
  p.id                    AS offer_id,
  p.title,
  p.slug,
  p.source_url,
  p.continent,
  p.country,
  p.region,
  CASE WHEN p.country IS NULL THEN '{}'::text[] ELSE ARRAY[p.country] END AS countries,
  p.departure_port,
  p.itinerary_spots,
  NULL::text              AS vessel_name,
  NULL::text              AS vessel_type,
  '{}'::text[]            AS booking_modes,
  p.beginner_friendly,
  p.kite_lessons,
  p.equipment_rental,
  NULL::text              AS season_text,
  p.duration_days,
  p.pricing,
  p.price_from_eur,
  p.currency,
  p.summary,
  p.images,
  p.extraction_confidence,
  p.manually_verified,
  FALSE                   AS is_reseller,
  NULL::text              AS operated_by,
  p.updated_at,
  p.id                    AS provider_id,
  NULL::text              AS provider_name,
  NULL::text              AS provider_root_domain,
  NULL::text              AS provider_website_url,
  NULL::text              AS provider_contact_email,
  NULL::text              AS provider_contact_form_url,
  p.languages             AS provider_languages,
  ARRAY[p.package_type]   AS provider_trip_types,
  NULL::integer           AS provider_passenger_capacity,
  NULL::integer           AS provider_cabin_count,
  NULL::timestamptz       AS provider_verified_at,
  NULL::timestamptz       AS provider_last_verified_at,
  p.skill_levels,
  p.included_services,
  p.optional_services,
  NULL::text              AS comfort_level,
  p.suitable_for_non_kiters,
  p.family_friendly,
  p.accommodation,
  p.meal_plan,
  NULL::integer           AS capacity_guests,
  NULL::integer           AS offer_cabin_count,
  NULL::text              AS offer_price_confidence,
  NULL::smallint          AS season_start_month,
  NULL::smallint          AS season_end_month,
  NULL::jsonb             AS dates,
  p.source_url            AS provider_bstoked_url,
  p.bstoked_rating        AS provider_bstoked_rating,
  p.bstoked_review_count  AS provider_bstoked_review_count,
  NULL::text              AS provider_tripadvisor_url,
  NULL::numeric           AS provider_tripadvisor_rating,
  NULL::integer           AS provider_tripadvisor_review_count,
  NULL::timestamptz       AS provider_reviews_checked_at,
  p.hero_video_url,
  NULL::text              AS provider_google_url,
  NULL::numeric           AS provider_google_rating,
  NULL::integer           AS provider_google_review_count,
  p.bstoked_rating        AS provider_avg_rating,     -- mean of available ratings = bstoked only
  p.price_pp_cabin,
  p.price_pp_cabin_currency,
  NULL::integer           AS price_charter_week,
  NULL::text              AS price_charter_week_currency,
  p.price_basis_note,
  -- package-specific (appended)
  p.package_type,
  p.price_unit,
  p.rooms
FROM package_offers p
WHERE p.is_active;

REVOKE ALL ON app_package_cards FROM anon, authenticated;
