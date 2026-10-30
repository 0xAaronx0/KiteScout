-- ---------------------------------------------------------------------------
-- Review links and ratings for package operators (Aaron 2026-10-30).
--
-- The review search (bstoked, TripAdvisor, Google) only ever ran for cruise providers. The operators behind the
-- package listings (public.providers, 292 active) get the same columns as cruise_providers, and the package view
-- exposes them instead of the constant NULLs it carried until now. Filled by `pnpm cli operator-reviews`.
--
-- providers: bstoked_url/rating/review_count, tripadvisor_url/rating/review_count, google_url/rating/review_count,
--   avg_rating, reviews_checked_at, review_match_notes (types as on cruise_providers: TEXT, NUMERIC(2,1), INTEGER,
--   TIMESTAMPTZ). Additive, NULL by default: nothing changes in the product until rows are written.
--
-- app_package_cards: the live definition (= target of 20261029120000_offer_audience_note, 81 columns, diff-checked
--   against the live PostgREST column list 2026-10-30, last column season_months) with ONLY these seven expressions
--   changed from NULL to the operator's columns, same names, order and types (ratings cast to plain numeric as the
--   NULL::numeric they replace): provider_tripadvisor_url/_rating/_review_count, provider_reviews_checked_at,
--   provider_google_url/_rating/_review_count. NOT changed: provider_bstoked_url (= the listing's source_url),
--   provider_bstoked_rating/_review_count and provider_avg_rating (= the package row's own bstoked rating): KCS
--   reads them as today. The cruise view is untouched. KCS's zod schema already has these columns.
--
-- Drift guard: aborts (nothing changed) unless the live package view is exactly the expected base definition or
-- already the new one, and has security_invoker=true. Existing view options, owner and grants are kept.
--
-- Safe to re-run. Rollback: re-run the CREATE OR REPLACE with the base body below (pg_temp.opreviews_base_package_cards,
-- i.e. the target of 20261029120000), then ALTER TABLE public.providers DROP COLUMN ... for the twelve columns.
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS bstoked_url               TEXT,
  ADD COLUMN IF NOT EXISTS bstoked_rating            NUMERIC(2,1),
  ADD COLUMN IF NOT EXISTS bstoked_review_count      INTEGER,
  ADD COLUMN IF NOT EXISTS tripadvisor_url           TEXT,
  ADD COLUMN IF NOT EXISTS tripadvisor_rating        NUMERIC(2,1),
  ADD COLUMN IF NOT EXISTS tripadvisor_review_count  INTEGER,
  ADD COLUMN IF NOT EXISTS google_url                TEXT,
  ADD COLUMN IF NOT EXISTS google_rating             NUMERIC(2,1),
  ADD COLUMN IF NOT EXISTS google_review_count       INTEGER,
  ADD COLUMN IF NOT EXISTS avg_rating                NUMERIC(2,1),
  ADD COLUMN IF NOT EXISTS reviews_checked_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_match_notes        TEXT;

DROP VIEW IF EXISTS pg_temp.opreviews_base_package_cards, pg_temp.opreviews_new_package_cards;

-- expected live definition (= target of 20261029120000_offer_audience_note, package view)
CREATE TEMP VIEW opreviews_base_package_cards AS
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
    NULL::text AS provider_tripadvisor_url,
    NULL::numeric AS provider_tripadvisor_rating,
    NULL::integer AS provider_tripadvisor_review_count,
    NULL::timestamp with time zone AS provider_reviews_checked_at,
    p.hero_video_url,
    NULL::text AS provider_google_url,
    NULL::numeric AS provider_google_rating,
    NULL::integer AS provider_google_review_count,
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

-- new definition (= base with the operator's TripAdvisor / Google / checked-at columns instead of NULL)
CREATE TEMP VIEW opreviews_new_package_cards AS
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

DO $guard$
DECLARE
  live regclass := to_regclass('public.app_package_cards');
  def text;
BEGIN
  IF live IS NULL THEN
    RAISE EXCEPTION 'operator_reviews: package view missing (drift)';
  END IF;
  def := pg_get_viewdef(live, true);
  IF def IS DISTINCT FROM pg_get_viewdef('pg_temp.opreviews_base_package_cards'::regclass, true)
     AND def IS DISTINCT FROM pg_get_viewdef('pg_temp.opreviews_new_package_cards'::regclass, true) THEN
    RAISE EXCEPTION 'operator_reviews: % view drift: live definition is neither the expected base nor the new one', live;
  END IF;
  IF NOT coalesce((SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class WHERE oid = live), false) THEN
    RAISE EXCEPTION 'operator_reviews: % view drift: security_invoker is not on', live;
  END IF;
END
$guard$;

-- CREATE OR REPLACE resets unspecified view options: reuse every existing option. Owner, grants and the existing
-- columns are kept. The body is the new temp view's definition, so the guard and the replacement never disagree.
DO $replace$
DECLARE options text;
BEGIN
  SELECT string_agg(format('%I=%L', split_part(opt, '=', 1), split_part(opt, '=', 2)), ', ')
    INTO options FROM pg_class c, unnest(c.reloptions) opt
   WHERE c.oid = 'public.app_package_cards'::regclass;
  EXECUTE format('CREATE OR REPLACE VIEW public.app_package_cards WITH (%s) AS %s', options,
                 pg_get_viewdef('pg_temp.opreviews_new_package_cards'::regclass, true));
END
$replace$;

DROP VIEW pg_temp.opreviews_base_package_cards, pg_temp.opreviews_new_package_cards;

COMMIT;
