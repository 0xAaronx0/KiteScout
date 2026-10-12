-- ---------------------------------------------------------------------------
-- Offer slots: price + availability per date/unit for adapter-ingested
-- package offers (accommodation / tour / camp), refreshed daily by
-- `pnpm cli offers ingest --slots`. Modeled on kiezdad's events +
-- verfuegbarkeit_verlauf: current state per slot, history only on change.
--
-- Also: offer_sources (per-adapter fetch state + run history) and a view
-- update so the KCS app gets future departures in app_package_cards.dates.
--
-- VIEW SAFETY: app_package_cards is owned by BOTH repos (KCS migration
-- 20261006100020 is the live definition). This CREATE OR REPLACE keeps every
-- column, name, type and order identical and changes only one expression:
--   dates : NULL::jsonb -> future active slots of tours/camps
-- (provider_bstoked_url stays p.source_url: the provider rating applies to all
-- of a provider's offers - Aaron 2026-10-12.)
-- Run AFTER verifying the live view still matches 20261006100020.
-- ---------------------------------------------------------------------------
BEGIN;

CREATE TABLE public.offer_slots (
  id                 BIGSERIAL    PRIMARY KEY,
  package_offer_id   UUID         NOT NULL REFERENCES public.package_offers(id) ON DELETE CASCADE,
  slot_key           TEXT         NOT NULL,   -- stable per offer: "2026-10-26", "double|2026-07", ...
  start_date         DATE,
  end_date           DATE,
  unit               TEXT,                    -- room type / package variant / route; NULL = the offer
  price              NUMERIC(12,2),           -- original currency, never converted
  currency           TEXT         CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  price_unit         TEXT         CHECK (price_unit IN ('package', 'per_night', 'per_day', 'per_week')),
  price_basis        TEXT         CHECK (price_basis IN ('person', 'room', 'group')),
  occupancy          SMALLINT,
  availability       TEXT         NOT NULL CHECK (availability IN
                       ('available', 'limited', 'on_request', 'waitlist', 'sold_out', 'closed', 'unknown')),
  availability_text  TEXT,                    -- provider's own words
  spots_left         INTEGER,                 -- per slot; trip-wide capacity is repeated on each leg (KiteActive)
  date_precision     TEXT         NOT NULL DEFAULT 'day' CHECK (date_precision IN ('day', 'month', 'season')),
  price_valid_until  DATE,                    -- early-bird prices (Dakhla Downwind Challenge)
  price_total        NUMERIC(12,2),           -- raw total when price was normalized per person (suite for 2)
  package_nights     SMALLINT,                -- nights a 'package' price covers (Panama: 5-night stay)
  min_nights         SMALLINT,                -- minimum stay when arriving in this slot (Omnibees per-day restriction)
  active             BOOLEAN      NOT NULL DEFAULT true,  -- false = no longer offered by the source
  first_seen_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_seen_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  changed_at         TIMESTAMPTZ  NOT NULL DEFAULT now(), -- last price/availability change
  UNIQUE (package_offer_id, slot_key),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX offer_slots_offer_active_idx ON public.offer_slots (package_offer_id, start_date) WHERE active;

-- One row per change of availability / price / spots ("sold out since Tuesday").
CREATE TABLE public.offer_slot_history (
  slot_id       BIGINT       NOT NULL REFERENCES public.offer_slots(id) ON DELETE CASCADE,
  availability  TEXT         NOT NULL,
  price         NUMERIC(12,2),
  currency      TEXT,
  spots_left    INTEGER,
  at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX offer_slot_history_slot_idx ON public.offer_slot_history (slot_id, at DESC);

-- Per adapter: what it is, when it last ran, what changed (hashes), run history.
CREATE TABLE public.offer_sources (
  key                 TEXT         PRIMARY KEY,            -- adapter key; package_offers.source_listing_id = 'site:' || key
  package_offer_id    UUID         REFERENCES public.package_offers(id) ON DELETE SET NULL,
  name                TEXT         NOT NULL,
  kind                TEXT         NOT NULL CHECK (kind IN ('accommodation', 'tour', 'camp')),
  slot_method         TEXT         NOT NULL CHECK (slot_method IN
                        ('booking_engine', 'jsonld', 'html_dates', 'price_table', 'platform')),
  url                 TEXT         NOT NULL,
  active              BOOLEAN      NOT NULL DEFAULT true,  -- operator-owned after the first insert
  last_run_at         TIMESTAMPTZ,
  last_ok_at          TIMESTAMPTZ,
  last_error          TEXT,
  content_hash        TEXT,
  slots_hash          TEXT,
  content_changed_at  TIMESTAMPTZ,
  slots_changed_at    TIMESTAMPTZ,
  history             JSONB        NOT NULL DEFAULT '[]',  -- last 30 runs: {at, mode, slots, bookable, ms, error?}
  quote               JSONB                                -- live quote recipe for the app: {engine:'omnibees'|'leao', ...ids}; NULL = no live quote
);

-- service role only (same policy as 20260711150000_revoke_anon_table_grants)
ALTER TABLE public.offer_slots        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_slot_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_sources      ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.offer_slots, public.offer_slot_history, public.offer_sources FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.offer_slots_id_seq FROM anon, authenticated;

-- app_package_cards: identical to KCS 20261006100020 except `dates`.
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
    p.operator_id
FROM public.package_offers p
LEFT JOIN public.providers o
  ON o.id = p.operator_id AND o.status NOT IN ('dead', 'duplicate')
WHERE p.is_active;

COMMIT;
