-- ---------------------------------------------------------------------------
-- Live availability and instant booking flags for adapter-ingested package offers (Aaron 2026-10-14).
--
-- package_offers.live_availability       true when the adapter reads availability from the provider's own
--                                         booking system / inventory on every daily `offers ingest --slots`
--                                         run (not printed price tables or page text); set by the ingest from
--                                         OfferAdapter.liveAvailability.
-- package_offers.availability_checked_at last successful availability run for a live offer (NULL otherwise).
-- package_offers.instant_booking         true when the provider's own website takes online bookings with
--                                         immediate confirmation (engine / checkout), false for request-only
--                                         booking; set by the ingest from OfferAdapter.instantBooking. Independent
--                                         of live_availability (a site can be instantly bookable but unreadable
--                                         for us, or readable but request-only).
--
-- VIEW SAFETY: app_package_cards is owned by BOTH repos. This CREATE OR REPLACE is the live definition from
-- 20261009120000_offer_slots (75 columns, diff-checked against the live column list on 2026-10-14) with the three
-- new columns appended at the end; no existing column changes name, type, order or expression.
-- Rollback: CREATE OR REPLACE cannot drop columns - re-run the 20261009120000 view block after
-- DROP VIEW public.app_package_cards (check dependents first), then drop the three columns.
-- ---------------------------------------------------------------------------
BEGIN;

ALTER TABLE public.package_offers
  ADD COLUMN IF NOT EXISTS live_availability BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS availability_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS instant_booking BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.package_offers.live_availability IS
  'true = availability read from the provider''s own booking system on every daily slots run';
COMMENT ON COLUMN public.package_offers.availability_checked_at IS
  'last successful live-availability run (offers ingest --slots); NULL when not live';
COMMENT ON COLUMN public.package_offers.instant_booking IS
  'true = the provider''s own website takes online bookings with immediate confirmation';

CREATE OR REPLACE VIEW public.app_package_cards
WITH (security_invoker = true) AS
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
    p.instant_booking
FROM public.package_offers p
LEFT JOIN public.providers o
  ON o.id = p.operator_id AND o.status NOT IN ('dead', 'duplicate')
WHERE p.is_active;

COMMIT;
