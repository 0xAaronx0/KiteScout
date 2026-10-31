-- ---------------------------------------------------------------------------
-- Trip length in NIGHTS (Aaron 2026-10-31).
--
-- Providers state nights ("7 nights", Saturday to Saturday); duration_days (= nights + 1, so a week is 8 days) has
-- been read in both directions by people and sessions. New column duration_nights on cruise_offers and
-- package_offers: the nights as the provider states them, null when unknown. The app shows 7 nights as "1 week".
-- duration_days stays unchanged for every existing reader (KCS, monitor, adapters); writers move over step by step.
-- This migration adds empty columns only: no row value changes.
--
-- VIEW SAFETY: app_cruise_offer_cards and app_package_cards are owned by BOTH repos (this one and
-- MartinMarzi/KiteCruiseScout). Each new definition is the live one plus duration_nights as the LAST column:
--   cruise view: base = 20261030120000_cruise_offer_is_active (applied 2026-10-30, 75 columns) -> 76
--   package view: base = 20261030140000_operator_reviews (applied 2026-10-30, 81 columns) -> 82
-- No column is removed, renamed, retyped or reordered.
--
-- Drift guard per view: aborts (nothing changed, the column adds roll back too) unless the live view is exactly the
-- expected base or already the new one, and has security_invoker=true. View options, owner and grants are kept.
--
-- Safe to re-run. Rollback: re-run the cruise block of 20261030120000_cruise_offer_is_active and the package block
-- of 20261030140000_operator_reviews (they define the same columns minus the last), then
--   ALTER TABLE public.cruise_offers DROP COLUMN duration_nights;
--   ALTER TABLE public.package_offers DROP COLUMN duration_nights;
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.cruise_offers ADD COLUMN IF NOT EXISTS duration_nights smallint
  CHECK (duration_nights IS NULL OR duration_nights BETWEEN 0 AND 60);
ALTER TABLE public.package_offers ADD COLUMN IF NOT EXISTS duration_nights smallint
  CHECK (duration_nights IS NULL OR duration_nights BETWEEN 0 AND 60);

COMMENT ON COLUMN public.cruise_offers.duration_nights IS
  'Nights of the trip as the provider states them (7 = a Saturday-to-Saturday week); null = not stated. Preferred over duration_days.';
COMMENT ON COLUMN public.package_offers.duration_nights IS
  'Nights of the trip as the provider states them (7 = a Saturday-to-Saturday week); null = not stated. Preferred over duration_days.';
COMMENT ON COLUMN public.cruise_offers.duration_days IS
  'Legacy trip length in days = nights + 1 (a week = 8). Prefer duration_nights.';
COMMENT ON COLUMN public.package_offers.duration_days IS
  'Legacy trip length in days = nights + 1 (a week = 8). Prefer duration_nights.';

DROP VIEW IF EXISTS pg_temp.nights_base_cruise_cards, pg_temp.nights_new_cruise_cards;

-- expected live definition
CREATE TEMP VIEW nights_base_cruise_cards AS
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
  c.rooms,
  -- appended 2026-10-21 (sports, MartinMarzi/KiteCruiseScout#239)
  c.disciplines,
  -- appended 2026-10-29 (market / language group of the listing)
  c.audience_note,
  -- appended 2026-10-29 (season as a month set, column from 20261028130000_offer_season_months)
  c.season_months
from public.cruise_offers c
left join public.cruise_providers p on p.id = c.cruise_provider_id
where c.duplicate_of is null
  and coalesce(p.status, 'new') not in ('dead', 'duplicate')
  -- Reseller-Angebote hart inaktiv (Aaron 2026-07-10): nie im Produkt zeigen
  and coalesce(c.is_reseller, false) = false
  -- Aaron 2026-10-26: never show a listing without at least one image
  and case when jsonb_typeof(c.images) = 'array' then jsonb_array_length(c.images) > 0 else false end
  -- Aaron 2026-10-30: hide switch for single cruise listings (like package_offers.is_active)
  and c.is_active
;

-- new definition: the live one plus c.duration_nights as the last column
CREATE TEMP VIEW nights_new_cruise_cards AS
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
  c.rooms,
  -- appended 2026-10-21 (sports, MartinMarzi/KiteCruiseScout#239)
  c.disciplines,
  -- appended 2026-10-29 (market / language group of the listing)
  c.audience_note,
  -- appended 2026-10-29 (season as a month set, column from 20261028130000_offer_season_months)
  c.season_months,
  -- appended 2026-10-31 (nights as the provider states them, Aaron 2026-10-31)
  c.duration_nights
from public.cruise_offers c
left join public.cruise_providers p on p.id = c.cruise_provider_id
where c.duplicate_of is null
  and coalesce(p.status, 'new') not in ('dead', 'duplicate')
  -- Reseller-Angebote hart inaktiv (Aaron 2026-07-10): nie im Produkt zeigen
  and coalesce(c.is_reseller, false) = false
  -- Aaron 2026-10-26: never show a listing without at least one image
  and case when jsonb_typeof(c.images) = 'array' then jsonb_array_length(c.images) > 0 else false end
  -- Aaron 2026-10-30: hide switch for single cruise listings (like package_offers.is_active)
  and c.is_active
;

DO $guard$
DECLARE
  live regclass := to_regclass('public.app_cruise_offer_cards');
  def text;
BEGIN
  IF live IS NULL THEN
    RAISE EXCEPTION 'duration_nights: app_cruise_offer_cards missing (drift)';
  END IF;
  def := pg_get_viewdef(live, true);
  IF def IS DISTINCT FROM pg_get_viewdef('pg_temp.nights_base_cruise_cards'::regclass, true)
     AND def IS DISTINCT FROM pg_get_viewdef('pg_temp.nights_new_cruise_cards'::regclass, true) THEN
    RAISE EXCEPTION 'duration_nights: % view drift: live definition is neither the expected base nor the new one', live;
  END IF;
  IF NOT coalesce((SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class WHERE oid = live), false) THEN
    RAISE EXCEPTION 'duration_nights: % view drift: security_invoker is not on', live;
  END IF;
END
$guard$;

-- CREATE OR REPLACE resets unspecified view options: reuse every existing option. Owner, grants and the existing
-- columns are kept; the body is the new temp view's definition, so the guard and the replacement never disagree.
DO $replace$
DECLARE options text;
BEGIN
  SELECT string_agg(format('%I=%L', split_part(opt, '=', 1), split_part(opt, '=', 2)), ', ')
    INTO options FROM pg_class c, unnest(c.reloptions) opt
   WHERE c.oid = 'public.app_cruise_offer_cards'::regclass;
  EXECUTE format('CREATE OR REPLACE VIEW public.app_cruise_offer_cards WITH (%s) AS %s', options,
                 pg_get_viewdef('pg_temp.nights_new_cruise_cards'::regclass, true));
END
$replace$;

DROP VIEW pg_temp.nights_base_cruise_cards, pg_temp.nights_new_cruise_cards;

DROP VIEW IF EXISTS pg_temp.nights_base_package_cards, pg_temp.nights_new_package_cards;

-- expected live definition
CREATE TEMP VIEW nights_base_package_cards AS
SELECT
    p.id AS offer_id,
    p.title,
    p.slug,
    p.source_url,
    p.continent,
    p.country,
    p.region,
    CASE WHEN p.country IS NULL THEN '{}'::text[]
         ELSE ARRAY[p.country] END AS countries,
    p.departure_port,
    p.itinerary_spots,
    NULL::text AS vessel_name,
    NULL::text AS vessel_type,
    '{}'::text[] AS booking_modes,
    p.beginner_friendly,
    p.kite_lessons,
    p.equipment_rental,
    NULL::text AS season_text,
    p.duration_days,
    p.pricing,
    p.price_from_eur,
    p.currency,
    p.summary,
    p.images,
    p.extraction_confidence,
    p.manually_verified,
    false AS is_reseller,
    NULL::text AS operated_by,
    p.updated_at,
    p.id AS provider_id,
    o.name AS provider_name,
    o.root_domain AS provider_root_domain,
    o.website_url AS provider_website_url,
    o.contact_email AS provider_contact_email,
    o.contact_form_url AS provider_contact_form_url,
    p.languages AS provider_languages,
    ARRAY[p.package_type] AS provider_trip_types,
    NULL::integer AS provider_passenger_capacity,
    NULL::integer AS provider_cabin_count,
    o.verified_at AS provider_verified_at,
    o.last_verified_at AS provider_last_verified_at,
    p.skill_levels,
    p.included_services,
    p.optional_services,
    NULL::text AS comfort_level,
    p.suitable_for_non_kiters,
    p.family_friendly,
    p.accommodation,
    p.meal_plan,
    NULL::integer AS capacity_guests,
    NULL::integer AS offer_cabin_count,
    NULL::text AS offer_price_confidence,
    NULL::smallint AS season_start_month,
    NULL::smallint AS season_end_month,
    -- future dated departures/weeks of tours and camps; KCS hides sold_out/closed itself
    (SELECT jsonb_agg(jsonb_build_object(
              'start_date', s.start_date, 'end_date', s.end_date, 'status', s.availability,
              'unit', s.unit, 'price', s.price, 'currency', s.currency,
              'price_unit', s.price_unit, 'price_basis', s.price_basis, 'spots_left', s.spots_left,
              'date_precision', s.date_precision, 'price_valid_until', s.price_valid_until)
            ORDER BY s.start_date, s.unit)
       FROM public.offer_slots s
      WHERE s.package_offer_id = p.id
AND s.active
AND p.package_type IN ('tour', 'camp')
AND s.start_date IS NOT NULL
AND isfinite(s.start_date)
AND s.start_date BETWEEN date '0001-01-01' AND date '9999-12-31'
AND CASE
  -- Preserve the source's future-only legacy/day read. Null is not verified exact-date evidence.
  WHEN s.date_precision IS NULL OR s.date_precision = 'day'
    THEN s.start_date >= current_date
  WHEN s.date_precision IN ('month', 'season')
    THEN s.end_date IS NOT NULL
      AND isfinite(s.end_date)
      AND s.end_date BETWEEN date '0001-01-01' AND date '9999-12-31'
      AND s.end_date >= s.start_date
      AND (s.date_precision = 'season'
        OR (extract(year from s.start_date), extract(month from s.start_date))
          = (extract(year from s.end_date), extract(month from s.end_date)))
      -- Coarse bounds describe months, not selectable departure days. Retain the whole ending month.
      -- Component comparisons never cast extreme finite date values to a narrower timestamp.
      AND (extract(year from current_date), extract(month from current_date))
        <= (extract(year from s.end_date), extract(month from s.end_date))
  ELSE false
END) AS dates,   -- exact dates stay future-only; coarse windows retain their ending month
    p.source_url AS provider_bstoked_url,
    p.bstoked_rating AS provider_bstoked_rating,
    p.bstoked_review_count AS provider_bstoked_review_count,
    o.tripadvisor_url AS provider_tripadvisor_url,
    o.tripadvisor_rating::numeric AS provider_tripadvisor_rating,
    o.tripadvisor_review_count AS provider_tripadvisor_review_count,
    o.reviews_checked_at AS provider_reviews_checked_at,
    p.hero_video_url,
    o.google_url AS provider_google_url,
    o.google_rating::numeric AS provider_google_rating,
    o.google_review_count AS provider_google_review_count,
    p.bstoked_rating AS provider_avg_rating,
    p.price_pp_cabin,
    p.price_pp_cabin_currency,
    NULL::integer AS price_charter_week,
    NULL::text AS price_charter_week_currency,
    p.price_basis_note,
    p.rooms,
    p.package_type,
    p.price_unit,
    p.operator_id,
    p.live_availability,
    p.availability_checked_at,
    p.instant_booking,
    -- appended 2026-10-21 (sports, MartinMarzi/KiteCruiseScout#239)
    p.disciplines,
    -- appended 2026-10-29 (market / language group of the listing)
    p.audience_note,
    -- appended 2026-10-29 (season as a month set, column from 20261028130000_offer_season_months)
    p.season_months
FROM public.package_offers p
LEFT JOIN public.providers o
  ON o.id = p.operator_id AND o.status NOT IN ('dead', 'duplicate')
WHERE p.is_active
  -- Aaron 2026-10-26: never show a listing without at least one image
  AND CASE WHEN jsonb_typeof(p.images) = 'array' THEN jsonb_array_length(p.images) > 0 ELSE false END

;

-- new definition: the live one plus p.duration_nights as the last column
CREATE TEMP VIEW nights_new_package_cards AS
SELECT
    p.id AS offer_id,
    p.title,
    p.slug,
    p.source_url,
    p.continent,
    p.country,
    p.region,
    CASE WHEN p.country IS NULL THEN '{}'::text[]
         ELSE ARRAY[p.country] END AS countries,
    p.departure_port,
    p.itinerary_spots,
    NULL::text AS vessel_name,
    NULL::text AS vessel_type,
    '{}'::text[] AS booking_modes,
    p.beginner_friendly,
    p.kite_lessons,
    p.equipment_rental,
    NULL::text AS season_text,
    p.duration_days,
    p.pricing,
    p.price_from_eur,
    p.currency,
    p.summary,
    p.images,
    p.extraction_confidence,
    p.manually_verified,
    false AS is_reseller,
    NULL::text AS operated_by,
    p.updated_at,
    p.id AS provider_id,
    o.name AS provider_name,
    o.root_domain AS provider_root_domain,
    o.website_url AS provider_website_url,
    o.contact_email AS provider_contact_email,
    o.contact_form_url AS provider_contact_form_url,
    p.languages AS provider_languages,
    ARRAY[p.package_type] AS provider_trip_types,
    NULL::integer AS provider_passenger_capacity,
    NULL::integer AS provider_cabin_count,
    o.verified_at AS provider_verified_at,
    o.last_verified_at AS provider_last_verified_at,
    p.skill_levels,
    p.included_services,
    p.optional_services,
    NULL::text AS comfort_level,
    p.suitable_for_non_kiters,
    p.family_friendly,
    p.accommodation,
    p.meal_plan,
    NULL::integer AS capacity_guests,
    NULL::integer AS offer_cabin_count,
    NULL::text AS offer_price_confidence,
    NULL::smallint AS season_start_month,
    NULL::smallint AS season_end_month,
    -- future dated departures/weeks of tours and camps; KCS hides sold_out/closed itself
    (SELECT jsonb_agg(jsonb_build_object(
              'start_date', s.start_date, 'end_date', s.end_date, 'status', s.availability,
              'unit', s.unit, 'price', s.price, 'currency', s.currency,
              'price_unit', s.price_unit, 'price_basis', s.price_basis, 'spots_left', s.spots_left,
              'date_precision', s.date_precision, 'price_valid_until', s.price_valid_until)
            ORDER BY s.start_date, s.unit)
       FROM public.offer_slots s
      WHERE s.package_offer_id = p.id
AND s.active
AND p.package_type IN ('tour', 'camp')
AND s.start_date IS NOT NULL
AND isfinite(s.start_date)
AND s.start_date BETWEEN date '0001-01-01' AND date '9999-12-31'
AND CASE
  -- Preserve the source's future-only legacy/day read. Null is not verified exact-date evidence.
  WHEN s.date_precision IS NULL OR s.date_precision = 'day'
    THEN s.start_date >= current_date
  WHEN s.date_precision IN ('month', 'season')
    THEN s.end_date IS NOT NULL
      AND isfinite(s.end_date)
      AND s.end_date BETWEEN date '0001-01-01' AND date '9999-12-31'
      AND s.end_date >= s.start_date
      AND (s.date_precision = 'season'
        OR (extract(year from s.start_date), extract(month from s.start_date))
          = (extract(year from s.end_date), extract(month from s.end_date)))
      -- Coarse bounds describe months, not selectable departure days. Retain the whole ending month.
      -- Component comparisons never cast extreme finite date values to a narrower timestamp.
      AND (extract(year from current_date), extract(month from current_date))
        <= (extract(year from s.end_date), extract(month from s.end_date))
  ELSE false
END) AS dates,   -- exact dates stay future-only; coarse windows retain their ending month
    p.source_url AS provider_bstoked_url,
    p.bstoked_rating AS provider_bstoked_rating,
    p.bstoked_review_count AS provider_bstoked_review_count,
    o.tripadvisor_url AS provider_tripadvisor_url,
    o.tripadvisor_rating::numeric AS provider_tripadvisor_rating,
    o.tripadvisor_review_count AS provider_tripadvisor_review_count,
    o.reviews_checked_at AS provider_reviews_checked_at,
    p.hero_video_url,
    o.google_url AS provider_google_url,
    o.google_rating::numeric AS provider_google_rating,
    o.google_review_count AS provider_google_review_count,
    p.bstoked_rating AS provider_avg_rating,
    p.price_pp_cabin,
    p.price_pp_cabin_currency,
    NULL::integer AS price_charter_week,
    NULL::text AS price_charter_week_currency,
    p.price_basis_note,
    p.rooms,
    p.package_type,
    p.price_unit,
    p.operator_id,
    p.live_availability,
    p.availability_checked_at,
    p.instant_booking,
    -- appended 2026-10-21 (sports, MartinMarzi/KiteCruiseScout#239)
    p.disciplines,
    -- appended 2026-10-29 (market / language group of the listing)
    p.audience_note,
    -- appended 2026-10-29 (season as a month set, column from 20261028130000_offer_season_months)
    p.season_months,
    -- appended 2026-10-31 (nights as the provider states them, Aaron 2026-10-31)
    p.duration_nights
FROM public.package_offers p
LEFT JOIN public.providers o
  ON o.id = p.operator_id AND o.status NOT IN ('dead', 'duplicate')
WHERE p.is_active
  -- Aaron 2026-10-26: never show a listing without at least one image
  AND CASE WHEN jsonb_typeof(p.images) = 'array' THEN jsonb_array_length(p.images) > 0 ELSE false END

;

DO $guard$
DECLARE
  live regclass := to_regclass('public.app_package_cards');
  def text;
BEGIN
  IF live IS NULL THEN
    RAISE EXCEPTION 'duration_nights: app_package_cards missing (drift)';
  END IF;
  def := pg_get_viewdef(live, true);
  IF def IS DISTINCT FROM pg_get_viewdef('pg_temp.nights_base_package_cards'::regclass, true)
     AND def IS DISTINCT FROM pg_get_viewdef('pg_temp.nights_new_package_cards'::regclass, true) THEN
    RAISE EXCEPTION 'duration_nights: % view drift: live definition is neither the expected base nor the new one', live;
  END IF;
  IF NOT coalesce((SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class WHERE oid = live), false) THEN
    RAISE EXCEPTION 'duration_nights: % view drift: security_invoker is not on', live;
  END IF;
END
$guard$;

-- CREATE OR REPLACE resets unspecified view options: reuse every existing option. Owner, grants and the existing
-- columns are kept; the body is the new temp view's definition, so the guard and the replacement never disagree.
DO $replace$
DECLARE options text;
BEGIN
  SELECT string_agg(format('%I=%L', split_part(opt, '=', 1), split_part(opt, '=', 2)), ', ')
    INTO options FROM pg_class c, unnest(c.reloptions) opt
   WHERE c.oid = 'public.app_package_cards'::regclass;
  EXECUTE format('CREATE OR REPLACE VIEW public.app_package_cards WITH (%s) AS %s', options,
                 pg_get_viewdef('pg_temp.nights_new_package_cards'::regclass, true));
END
$replace$;

DROP VIEW pg_temp.nights_base_package_cards, pg_temp.nights_new_package_cards;

COMMIT;
