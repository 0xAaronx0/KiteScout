-- Never show a listing without at least one image (Aaron 2026-10-26).
-- Adds ONE condition to each app view: images is a non-empty JSON array. Columns, order, options, owner and grants
-- stay as they are (CREATE OR REPLACE keeps ACL/owner; options are re-applied explicitly).
-- Baselines (live, unchanged since): app_package_cards = 20261021191245_retain_coarse_package_slot_windows (applied
-- 2026-10-22), app_cruise_offer_cards = 20261021120000_offer_disciplines (applied 2026-10-21). KCS has no view
-- migration after 20261006100020. Guarded: aborts on any other live definition; a second run is a no-op.
-- State before (2026-10-28, REST): app_package_cards 335 rows / 0 without images, app_cruise_offer_cards 148 / 0.
-- Rollback: re-run the app_package_cards block of 20261021191245 and the app_cruise_offer_cards block of 20261021120000.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL timezone = 'UTC';

-- app_package_cards
CREATE TEMP VIEW img_pkg_current AS
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
WHERE p.is_active;
CREATE TEMP VIEW img_pkg_target AS
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
  -- Aaron 2026-10-26: never show a listing without at least one image
  AND CASE WHEN jsonb_typeof(p.images) = 'array' THEN jsonb_array_length(p.images) > 0 ELSE false END;
DO $replace$
DECLARE live text; options text;
BEGIN
  live := pg_get_viewdef('public.app_package_cards'::regclass, true);
  IF live = pg_get_viewdef('pg_temp.img_pkg_target'::regclass, true) THEN
    RAISE NOTICE 'app_package_cards: image filter already in place, nothing to do';
  ELSIF live IS DISTINCT FROM pg_get_viewdef('pg_temp.img_pkg_current'::regclass, true)
     OR NOT coalesce((SELECT 'security_invoker=true' = ANY(reloptions) FROM pg_class WHERE oid = 'public.app_package_cards'::regclass), false) THEN
    RAISE EXCEPTION 'app_package_cards drift: the live definition is neither the expected current view nor the target; reconcile first';
  ELSE
    -- CREATE OR REPLACE resets unspecified options: reuse every existing one (security_invoker, security_barrier ...)
    SELECT string_agg(format('%I=%L', split_part(opt, '=', 1), split_part(opt, '=', 2)), ', ')
      INTO options FROM pg_class c, unnest(c.reloptions) opt WHERE c.oid = 'public.app_package_cards'::regclass;
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
  -- Aaron 2026-10-26: never show a listing without at least one image
  AND CASE WHEN jsonb_typeof(p.images) = 'array' THEN jsonb_array_length(p.images) > 0 ELSE false END
$view$);
  END IF;
END
$replace$;
DROP VIEW pg_temp.img_pkg_current;
DROP VIEW pg_temp.img_pkg_target;

-- app_cruise_offer_cards
CREATE TEMP VIEW img_cruise_current AS
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
  c.disciplines
from public.cruise_offers c
left join public.cruise_providers p on p.id = c.cruise_provider_id
where c.duplicate_of is null
  and coalesce(p.status, 'new') not in ('dead', 'duplicate')
  -- Reseller-Angebote hart inaktiv (Aaron 2026-07-10): nie im Produkt zeigen
  and coalesce(c.is_reseller, false) = false;
CREATE TEMP VIEW img_cruise_target AS
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
  c.disciplines
from public.cruise_offers c
left join public.cruise_providers p on p.id = c.cruise_provider_id
where c.duplicate_of is null
  and coalesce(p.status, 'new') not in ('dead', 'duplicate')
  -- Reseller-Angebote hart inaktiv (Aaron 2026-07-10): nie im Produkt zeigen
  and coalesce(c.is_reseller, false) = false
  -- Aaron 2026-10-26: never show a listing without at least one image
  and case when jsonb_typeof(c.images) = 'array' then jsonb_array_length(c.images) > 0 else false end;
DO $replace$
DECLARE live text; options text;
BEGIN
  live := pg_get_viewdef('public.app_cruise_offer_cards'::regclass, true);
  IF live = pg_get_viewdef('pg_temp.img_cruise_target'::regclass, true) THEN
    RAISE NOTICE 'app_cruise_offer_cards: image filter already in place, nothing to do';
  ELSIF live IS DISTINCT FROM pg_get_viewdef('pg_temp.img_cruise_current'::regclass, true)
     OR NOT coalesce((SELECT 'security_invoker=true' = ANY(reloptions) FROM pg_class WHERE oid = 'public.app_cruise_offer_cards'::regclass), false) THEN
    RAISE EXCEPTION 'app_cruise_offer_cards drift: the live definition is neither the expected current view nor the target; reconcile first';
  ELSE
    -- CREATE OR REPLACE resets unspecified options: reuse every existing one (security_invoker, security_barrier ...)
    SELECT string_agg(format('%I=%L', split_part(opt, '=', 1), split_part(opt, '=', 2)), ', ')
      INTO options FROM pg_class c, unnest(c.reloptions) opt WHERE c.oid = 'public.app_cruise_offer_cards'::regclass;
    EXECUTE format('CREATE OR REPLACE VIEW public.app_cruise_offer_cards WITH (%s) AS %s', options, $view$
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
  c.disciplines
from public.cruise_offers c
left join public.cruise_providers p on p.id = c.cruise_provider_id
where c.duplicate_of is null
  and coalesce(p.status, 'new') not in ('dead', 'duplicate')
  -- Reseller-Angebote hart inaktiv (Aaron 2026-07-10): nie im Produkt zeigen
  and coalesce(c.is_reseller, false) = false
  -- Aaron 2026-10-26: never show a listing without at least one image
  and case when jsonb_typeof(c.images) = 'array' then jsonb_array_length(c.images) > 0 else false end
$view$);
  END IF;
END
$replace$;
DROP VIEW pg_temp.img_cruise_current;
DROP VIEW pg_temp.img_cruise_target;

COMMIT;
