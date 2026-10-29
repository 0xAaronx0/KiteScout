-- ---------------------------------------------------------------------------
-- audience_note + season_months in the product views (Aaron 2026-10-29).
--
-- cruise_offers.audience_note / package_offers.audience_note  TEXT NULL, e.g. 'Russian-language trip'
--   (first case: cruise offer 7f1a5f7c-798e-4e92-b564-dff1110b2fa2, the Russian-language version of a Red Sea
--   liveaboard). NULL = a general listing. The product keeps a non-NULL note out of "Featured", shows the note
--   and lists that language first. No backfill here: the values are set separately.
--
-- season_months: the existing SMALLINT[] column (20261028130000_offer_season_months, applied 2026-10-28) is
--   exposed in both views. 277 active package rows have it while the package view's season_start_month /
--   season_end_month are always NULL, so the product could not show "open (Apr-Oct)" for packages.
--
-- DEPENDS ON 20261028120000_views_require_image, which must run FIRST (order set by the deployer 2026-10-29).
-- VIEW SAFETY: both views are owned by BOTH repos (this one and MartinMarzi/KiteCruiseScout). Each new definition
-- is the view state after 20261028120000 with `audience_note`, then `season_months` appended as the LAST two
-- columns; no existing column changes name, type, order or expression:
--   app_package_cards       = target of 20261028120000 (= 20261021191245 + image filter, 79 columns) + 2 = 81
--   app_cruise_offer_cards  = target of 20261028120000 (= 20261021120000 + image filter, 73 columns) + 2 = 75
-- The image filter changes only the WHERE clause, so the column lists equal the live ones (diff-checked
-- 2026-10-29: 79 / 73, last column `disciplines` in both; KCS origin/main has no view migration newer than
-- 20260710090000). KCS's zod schemas ignore unknown columns. Run before 20261028120000, the guard aborts.
--
-- Drift guard: aborts (nothing changed) unless each live view is either exactly the expected base definition
-- or already the new one, and has security_invoker=true. Existing view options, owner and grants are kept.
--
-- Safe to re-run. Rollback: CREATE OR REPLACE cannot drop a column - DROP VIEW both views (check dependents
-- first), recreate them WITH (security_invoker = true) from the target bodies of 20261028120000 (then REVOKE ALL
-- ... FROM anon, authenticated), then
-- ALTER TABLE package_offers DROP COLUMN audience_note; ALTER TABLE cruise_offers DROP COLUMN audience_note;
-- (season_months stays: it belongs to 20261028130000.)
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.cruise_offers  ADD COLUMN IF NOT EXISTS audience_note TEXT;
ALTER TABLE public.package_offers ADD COLUMN IF NOT EXISTS audience_note TEXT;

COMMENT ON COLUMN public.cruise_offers.audience_note IS
  'market or language group the listing is aimed at (e.g. ''Russian-language trip''); NULL = general listing';
COMMENT ON COLUMN public.package_offers.audience_note IS
  'market or language group the listing is aimed at (e.g. ''Russian-language trip''); NULL = general listing';

DROP VIEW IF EXISTS pg_temp.audience_base_package_cards, pg_temp.audience_new_package_cards,
                    pg_temp.audience_base_cruise_cards, pg_temp.audience_new_cruise_cards;

-- expected live definition (= target of 20261028120000_views_require_image, package view)
CREATE TEMP VIEW audience_base_package_cards AS
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
;

-- new definition (= base + audience_note + season_months)
CREATE TEMP VIEW audience_new_package_cards AS
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

-- expected live definition (= target of 20261028120000_views_require_image, cruise view)
CREATE TEMP VIEW audience_base_cruise_cards AS
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
;

-- new definition (= base + audience_note + season_months)
CREATE TEMP VIEW audience_new_cruise_cards AS
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
;

DO $guard$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['package', 'cruise'] LOOP
    DECLARE
      live regclass := to_regclass(CASE v WHEN 'package' THEN 'public.app_package_cards' ELSE 'public.app_cruise_offer_cards' END);
      def text;
    BEGIN
      IF live IS NULL THEN
        RAISE EXCEPTION 'audience_note: % view missing (drift)', v;
      END IF;
      def := pg_get_viewdef(live, true);
      IF def IS DISTINCT FROM pg_get_viewdef(format('pg_temp.audience_base_%s_cards', v)::regclass, true)
         AND def IS DISTINCT FROM pg_get_viewdef(format('pg_temp.audience_new_%s_cards', v)::regclass, true) THEN
        RAISE EXCEPTION 'audience_note: % view drift: live definition is neither the expected base nor the new one', live;
      END IF;
      IF NOT coalesce((SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class WHERE oid = live), false) THEN
        RAISE EXCEPTION 'audience_note: % view drift: security_invoker is not on', live;
      END IF;
    END;
  END LOOP;
END
$guard$;

-- CREATE OR REPLACE resets unspecified view options: reuse every existing option (security_invoker and any
-- other, e.g. security_barrier). Owner, grants and the existing columns are kept. The body is the new temp
-- view's definition, so the guard and the replacement can never disagree.
DO $replace$
DECLARE
  v text;
  target text;
  options text;
BEGIN
  FOREACH v IN ARRAY ARRAY['package', 'cruise'] LOOP
    target := CASE v WHEN 'package' THEN 'public.app_package_cards' ELSE 'public.app_cruise_offer_cards' END;
    SELECT string_agg(format('%I=%L', split_part(opt, '=', 1), split_part(opt, '=', 2)), ', ')
      INTO options FROM pg_class c, unnest(c.reloptions) opt
     WHERE c.oid = target::regclass;
    EXECUTE format('CREATE OR REPLACE VIEW %s WITH (%s) AS %s', target, options,
                   pg_get_viewdef(format('pg_temp.audience_new_%s_cards', v)::regclass, true));
  END LOOP;
END
$replace$;

DROP VIEW pg_temp.audience_base_package_cards, pg_temp.audience_new_package_cards,
          pg_temp.audience_base_cruise_cards, pg_temp.audience_new_cruise_cards;

COMMIT;
