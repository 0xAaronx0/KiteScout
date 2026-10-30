-- ---------------------------------------------------------------------------
-- Hide switch for single cruise listings (Aaron 2026-10-30).
--
-- cruise_offers.is_active BOOLEAN NOT NULL DEFAULT true, the same switch package_offers already has
-- (app_package_cards filters `WHERE p.is_active`). false = the listing stays in the table with all data, media and
-- monitoring, but the product view no longer serves it. Use it for listings that may come back (first case: the
-- discontinued British Virgin Islands cruise of Ocean Ad-Ventures, 583f2391-7bd4-4554-a7dc-d1925ba88424, whose
-- page returns 404 since mid October). Default true: every existing and future row stays visible; nothing is
-- hidden by this migration itself.
--
-- VIEW SAFETY: app_cruise_offer_cards is owned by BOTH repos (this one and MartinMarzi/KiteCruiseScout). The new
-- definition is the live one (20261029120000_offer_audience_note, applied 2026-10-29, 75 columns, last
-- `audience_note`, `season_months`) with ONE extra WHERE condition `and c.is_active`. No column is added, removed,
-- renamed or reordered, so KCS and every reader see the same column contract. app_package_cards is not touched.
--
-- Drift guard: aborts (nothing changed) unless the live cruise view is exactly the expected base definition or
-- already the new one, and has security_invoker=true. Existing view options, owner and grants are kept.
--
-- Safe to re-run. Rollback: re-run the cruise block of 20261029120000_offer_audience_note (CREATE OR REPLACE with
-- the base body; it has the same columns), then ALTER TABLE public.cruise_offers DROP COLUMN is_active;
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.cruise_offers ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.cruise_offers.is_active IS
  'false = hidden from the product view app_cruise_offer_cards (data, media and monitoring kept); like package_offers.is_active';

DROP VIEW IF EXISTS pg_temp.active_base_cruise_cards, pg_temp.active_new_cruise_cards;

-- expected live definition (= target of 20261029120000_offer_audience_note, cruise view)
CREATE TEMP VIEW active_base_cruise_cards AS
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

-- new definition (= base + `and c.is_active`)
CREATE TEMP VIEW active_new_cruise_cards AS
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

DO $guard$
DECLARE
  live regclass := to_regclass('public.app_cruise_offer_cards');
  def text;
BEGIN
  IF live IS NULL THEN
    RAISE EXCEPTION 'cruise is_active: app_cruise_offer_cards missing (drift)';
  END IF;
  def := pg_get_viewdef(live, true);
  IF def IS DISTINCT FROM pg_get_viewdef('pg_temp.active_base_cruise_cards'::regclass, true)
     AND def IS DISTINCT FROM pg_get_viewdef('pg_temp.active_new_cruise_cards'::regclass, true) THEN
    RAISE EXCEPTION 'cruise is_active: % view drift: live definition is neither the expected base nor the new one', live;
  END IF;
  IF NOT coalesce((SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class WHERE oid = live), false) THEN
    RAISE EXCEPTION 'cruise is_active: % view drift: security_invoker is not on', live;
  END IF;
END
$guard$;

-- CREATE OR REPLACE resets unspecified view options: reuse every existing option. Owner, grants and columns are
-- kept. The body is the new temp view's definition, so the guard and the replacement can never disagree.
DO $replace$
DECLARE options text;
BEGIN
  SELECT string_agg(format('%I=%L', split_part(opt, '=', 1), split_part(opt, '=', 2)), ', ')
    INTO options FROM pg_class c, unnest(c.reloptions) opt
   WHERE c.oid = 'public.app_cruise_offer_cards'::regclass;
  EXECUTE format('CREATE OR REPLACE VIEW public.app_cruise_offer_cards WITH (%s) AS %s', options,
                 pg_get_viewdef('pg_temp.active_new_cruise_cards'::regclass, true));
END
$replace$;

DROP VIEW pg_temp.active_base_cruise_cards, pg_temp.active_new_cruise_cards;

COMMIT;
