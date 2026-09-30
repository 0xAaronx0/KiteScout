-- ============================================================
-- Room / cabin types for cruises (Aaron, 2026-09-29)
-- ============================================================
-- Cruises get the same `rooms` field as packages: one entry per cabin type with
-- its "from" price and (once curated) a captioned photo in `images`:
--   [{ "name": "Seaview Cabin - Upper Deck", "description": "…", "features": [],
--      "price_from": 1700, "price_currency": "EUR",
--      "price_unit": "package" | "per_cabin" | "per_night" | "per_day" | "other",
--      "priced_months": [1, …, 12],   -- months with a sampled price ([] = not sampled)
--      "image_sort": null }]          -- sort of the cabin's captioned photo in images
--
-- app_cruise_offer_cards: CREATE OR REPLACE with the live definition (71 columns,
-- = 20260710160000, verified against the live view 2026-09-29) + `rooms` appended.
-- CREATE OR REPLACE refuses to run if an existing column would be dropped, renamed,
-- retyped or moved, so such a mismatch fails loudly instead of breaking the app
-- (it does not check the expression behind a column: keep the select list verbatim). KCS's zod schema ignores
-- unknown columns, so the deployed app is unaffected until it reads `rooms`.
--
-- app_package_cards is re-created so both views share their first 72 columns
-- (cruise 71 + rooms); the package-only columns follow. It has no consumers yet.
--
-- Safe to re-run. Rollback: re-run the view block of 20260710160000 for the
-- cruise view (CREATE OR REPLACE cannot drop a column: DROP VIEW + CREATE there),
-- then ALTER TABLE cruise_offers DROP COLUMN rooms.
-- ============================================================

ALTER TABLE cruise_offers
  ADD COLUMN IF NOT EXISTS rooms JSONB NOT NULL DEFAULT '[]';

create or replace view public.app_cruise_offer_cards
with (security_invoker = true)
as
select
  c.id as offer_id,
  c.title,
  c.slug,
  c.source_url,
  c.continent,
  c.country,
  c.region,
  c.countries,
  c.departure_port,
  c.itinerary_spots,
  c.vessel_name,
  c.vessel_type,
  c.booking_modes,
  c.beginner_friendly,
  c.kite_lessons,
  c.equipment_rental,
  c.season_text,
  c.duration_days,
  c.pricing,
  c.price_from_eur,
  c.currency,
  c.summary,
  c.images,
  c.extraction_confidence,
  c.manually_verified,
  c.is_reseller,
  c.operated_by,
  c.updated_at,
  p.id as provider_id,
  p.name as provider_name,
  p.root_domain as provider_root_domain,
  p.website_url as provider_website_url,
  p.contact_email as provider_contact_email,
  p.contact_form_url as provider_contact_form_url,
  p.languages as provider_languages,
  p.trip_types as provider_trip_types,
  p.passenger_capacity as provider_passenger_capacity,
  p.cabin_count as provider_cabin_count,
  p.verified_at as provider_verified_at,
  p.last_verified_at as provider_last_verified_at,
  c.skill_levels,
  c.included_services,
  c.optional_services,
  c.comfort_level,
  c.suitable_for_non_kiters,
  c.family_friendly,
  c.accommodation,
  c.meal_plan,
  c.capacity_guests,
  c.cabin_count as offer_cabin_count,
  c.price_confidence as offer_price_confidence,
  c.season_start_month,
  c.season_end_month,
  c.dates,
  p.bstoked_url as provider_bstoked_url,
  p.bstoked_rating as provider_bstoked_rating,
  p.bstoked_review_count as provider_bstoked_review_count,
  p.tripadvisor_url as provider_tripadvisor_url,
  p.tripadvisor_rating as provider_tripadvisor_rating,
  p.tripadvisor_review_count as provider_tripadvisor_review_count,
  p.reviews_checked_at as provider_reviews_checked_at,
  c.hero_video_url,
  p.google_url as provider_google_url,
  p.google_rating as provider_google_rating,
  p.google_review_count as provider_google_review_count,
  p.avg_rating as provider_avg_rating,
  c.price_pp_cabin,
  c.price_pp_cabin_currency,
  c.price_charter_week,
  c.price_charter_week_currency,
  c.price_basis_note,
  -- appended 2026-09-29 (cabin / room types)
  c.rooms
from public.cruise_offers c
left join public.cruise_providers p on p.id = c.cruise_provider_id
where c.duplicate_of is null
  and coalesce(p.status, 'new') not in ('dead', 'duplicate')
  -- Reseller-Angebote hart inaktiv (Aaron 2026-07-10): nie im Produkt zeigen
  and coalesce(c.is_reseller, false) = false;

revoke all on public.app_cruise_offer_cards from anon, authenticated;

-- ============================================================
-- Package view: same first 72 columns as the cruise view, then package-only
-- ============================================================
DROP VIEW IF EXISTS app_package_cards;

CREATE VIEW app_package_cards
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
  p.bstoked_rating        AS provider_avg_rating,
  p.price_pp_cabin,
  p.price_pp_cabin_currency,
  NULL::integer           AS price_charter_week,
  NULL::text              AS price_charter_week_currency,
  p.price_basis_note,
  p.rooms,
  -- package-only
  p.package_type,
  p.price_unit
FROM package_offers p
WHERE p.is_active;

REVOKE ALL ON app_package_cards FROM anon, authenticated;
