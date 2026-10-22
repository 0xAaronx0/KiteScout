-- MartinMarzi/KiteCruiseScout#345. Source-only proposal; not applied by this PR.
-- Baseline: 20261021120000_offer_disciplines.sql at edaa059239c05b53a3cb44546ea19d310d1b3c6e.
-- Stop on view drift. Do not replay historical migrations or run a blanket db push.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- Match the calendar convention used by the catalog normalizer.
SET LOCAL timezone = 'UTC';
CREATE TEMP VIEW kcs_345_expected_package_cards AS
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
      WHERE s.package_offer_id = p.id AND s.active
        AND p.package_type IN ('tour', 'camp')
        AND s.start_date IS NOT NULL
        AND s.start_date >= current_date) AS dates,   -- a departure that has started is no longer bookable
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
    p.disciplines
FROM public.package_offers p
LEFT JOIN public.providers o
  ON o.id = p.operator_id AND o.status NOT IN ('dead', 'duplicate')
WHERE p.is_active;
DO $guard$
BEGIN
  IF to_regclass('public.app_package_cards') IS NULL
    OR pg_get_viewdef('public.app_package_cards'::regclass, true)
       IS DISTINCT FROM pg_get_viewdef('pg_temp.kcs_345_expected_package_cards'::regclass, true)
    OR NOT coalesce((SELECT 'security_invoker=true' = ANY(reloptions)
                     FROM pg_class WHERE oid = 'public.app_package_cards'::regclass), false)
  THEN
    RAISE EXCEPTION 'app_package_cards drift: reconcile current definition/security before applying issue 345';
  END IF;
END
$guard$;
DROP VIEW pg_temp.kcs_345_expected_package_cards;

-- CREATE OR REPLACE resets unspecified view options. Reuse every existing option,
-- including security_barrier/check_option if present; owner, ACL and columns are retained.
DO $replace$
DECLARE options text;
BEGIN
  SELECT string_agg(format('%I=%L', split_part(opt, '=', 1), split_part(opt, '=', 2)), ', ')
    INTO options FROM pg_class c, unnest(c.reloptions) opt
    WHERE c.oid = 'public.app_package_cards'::regclass;
  EXECUTE format('CREATE OR REPLACE VIEW public.app_package_cards WITH (%s) AS %s', options, $view$
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
    p.disciplines
FROM public.package_offers p
LEFT JOIN public.providers o
  ON o.id = p.operator_id AND o.status NOT IN ('dead', 'duplicate')
WHERE p.is_active
$view$);
END
$replace$;
COMMIT;
