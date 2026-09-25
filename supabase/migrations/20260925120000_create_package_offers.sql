-- ============================================================
-- Package offers: kite camps, tours, accommodation (+ experiences, courses)
-- ============================================================
-- One row per non-cruise kite travel PRODUCT. Cruises stay in `cruise_offers`
-- on purpose: that table has direct readers (monitor sweep, surgical apply,
-- /api/cruise-map, /admin/media) that assume every row is a cruise, and the
-- live product reads it through `app_cruise_offer_cards`. A separate table
-- keeps this expansion at zero blast radius for the live app.
--
-- Column names mirror `cruise_offers` wherever the concept is the same
-- (title, slug, country/region, skill_levels, wind_strength, water_conditions,
-- included/optional_services, accommodation, meal_plan, summary, images,
-- hero_video_url, price_* …) so the frontend can reuse its card mapping.
--
-- First source: bstoked.net listings (`pnpm cli bstoked-packages …`).
-- bstoked hosts are shown by first name only; the listing page (source_url)
-- is the inquiry/booking target for these rows.
--
-- Safe to re-run: CREATE … IF NOT EXISTS / CREATE OR REPLACE, no drops.
-- Rollback: DROP VIEW app_package_cards; DROP TABLE package_offers;
--           (nothing else references them; images live under packages/ in cruise-images)
-- ============================================================

CREATE TABLE IF NOT EXISTS package_offers (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  package_type             TEXT        NOT NULL CHECK (package_type IN (
                             'camp', 'tour', 'accommodation', 'experience', 'course'
                           )),

  -- ----- identity / provenance -----
  title                    TEXT        NOT NULL,
  slug                     TEXT        NOT NULL,             -- slugify(title); NOT unique (bstoked has duplicate titles)
  source                   TEXT        NOT NULL DEFAULT 'bstoked'
                                       CHECK (source IN ('bstoked', 'provider_site', 'manual')),
  source_listing_id        TEXT,                             -- bstoked listing id, e.g. '7349'
  source_url               TEXT,                             -- listing page = inquiry target for bstoked rows

  -- ----- location -----
  continent                TEXT,
  country                  TEXT,
  region                   TEXT,
  location_label           TEXT,                             -- as displayed, e.g. 'Ceará, Brazil'
  lat                      DOUBLE PRECISION,
  lng                      DOUBLE PRECISION,
  pickup_location          TEXT,                             -- "Typical pickup", e.g. 'Fortaleza airport'
  -- Ordered stops (tours), same shape as cruise_offers.itinerary_spots:
  --   [{ "name": "Atins", "country": "Brazil", "region": null, "lat": null, "lng": null, "order": 0 }]
  itinerary_spots          JSONB       NOT NULL DEFAULT '[]',
  -- Day-by-day programme as published; a listing can offer several routes:
  --   [{ "title": "8 Days Classic Route", "days": [{ "title": "Days 1-3 Paracuru", "text": "…" }] }]
  itineraries              JSONB       NOT NULL DEFAULT '[]',

  -- ----- kite conditions -----
  skill_levels             TEXT[]      NOT NULL DEFAULT '{}', -- beginner|intermediate|advanced
  wind_strength            TEXT[]      NOT NULL DEFAULT '{}', -- light|medium|strong (cruise vocabulary)
  water_conditions         TEXT[]      NOT NULL DEFAULT '{}', -- flat|choppy|waves (cruise vocabulary)
  spot_conditions          TEXT[]      NOT NULL DEFAULT '{}', -- raw bstoked tags: shallow|flat|small_waves|big_waves|choppy
  wind_probability         TEXT,                             -- bstoked card bucket, e.g. '60 - 80%'
  kite_services            TEXT[]      NOT NULL DEFAULT '{}', -- gear_rental|gear_storage|lessons|spot_guidance|rescue
  kite_lessons             BOOLEAN,                          -- derived from kite_services (NULL = unknown)
  equipment_rental         BOOLEAN,
  conditions_text          TEXT,

  -- ----- trip characteristics (bool NULL = unknown) -----
  suitable_for             TEXT[]      NOT NULL DEFAULT '{}', -- solo|group|family|couple|non_rider
  suitable_for_non_kiters  BOOLEAN,
  family_friendly          BOOLEAN,
  ambience                 TEXT[]      NOT NULL DEFAULT '{}', -- e.g. relaxed|lively bars|wilderness
  experience_types         TEXT[]      NOT NULL DEFAULT '{}', -- collective|private
  meal_plan                TEXT,                             -- as published, e.g. 'Breakfast'
  dietary_options          TEXT[]      NOT NULL DEFAULT '{}', -- vegetarian|vegan|special diets
  flight_search_assistance BOOLEAN,
  languages                TEXT[]      NOT NULL DEFAULT '{}',

  -- ----- services & stay -----
  included_services        TEXT[]      NOT NULL DEFAULT '{}',
  optional_services        TEXT[]      NOT NULL DEFAULT '{}',
  extra_expenses           TEXT[]      NOT NULL DEFAULT '{}', -- not included, paid locally
  accommodation            TEXT,                             -- prose
  -- Room / unit types (prices are date-dependent on bstoked, so none stored yet):
  --   [{ "name": "Double Room with Common Bathroom", "description": "…", "features": ["Walking distance to spot"] }]
  rooms                    JSONB       NOT NULL DEFAULT '[]',

  -- ----- duration & price (original currency, never converted offer-side) -----
  duration_nights          INTEGER,                          -- package length; NULL for per-night stays
  price_from               NUMERIC(10,2),
  price_currency           TEXT,
  price_unit               TEXT        CHECK (price_unit IN ('package', 'per_night', 'per_day', 'other')),
  price_basis_note         TEXT,
  pricing                  JSONB,                            -- { "raw": "From €1279 / 7 nights", … }

  -- ----- booking policy -----
  payment_terms            TEXT,
  deposit_pct              SMALLINT    CHECK (deposit_pct BETWEEN 0 AND 100),
  -- [{ "min_days_before": 60, "max_days_before": null, "refund_pct": 100 }, …]
  cancellation_policy      JSONB       NOT NULL DEFAULT '[]',

  -- ----- content -----
  summary                  TEXT,
  -- Remaining prose sections in page order: [{ "heading": "The Destination", "text": "…" }]
  description_sections     JSONB       NOT NULL DEFAULT '[]',
  -- Same contract as cruise_offers.images (paths in the private cruise-images bucket,
  -- under packages/<type>/<slug>-<source_listing_id>/):
  --   [{ "path": "…/0.webp", "source_url": "…", "width": 1280, "height": 853, "bytes": 98213,
  --      "caption": null, "sort": 0, "rights": {…} }]
  images                   JSONB       NOT NULL DEFAULT '[]',
  hero_video_url           TEXT,                             -- public cruise-videos bucket (same as cruises)
  video_urls               TEXT[]      NOT NULL DEFAULT '{}', -- external embeds as published (YouTube)

  -- ----- host & trust -----
  host_name                TEXT,                             -- bstoked shows first name only
  host_source_id           TEXT,                             -- bstoked user id
  host_member_since        TEXT,
  host_response_rate       SMALLINT,                         -- percent
  host_response_time       TEXT,
  host_verified            BOOLEAN,
  bstoked_rating           NUMERIC(3,2),
  bstoked_review_count     INTEGER,

  -- ----- meta -----
  source_text              TEXT,                             -- flattened page text for re-extraction
  is_active                BOOLEAN     NOT NULL DEFAULT TRUE,
  extraction_confidence    TEXT        NOT NULL DEFAULT 'high'
                                       CHECK (extraction_confidence IN ('high', 'medium', 'low')),
  manually_verified        BOOLEAN     NOT NULL DEFAULT FALSE,
  scraped_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (source, source_listing_id)
);

DROP TRIGGER IF EXISTS package_offers_updated_at ON package_offers;
CREATE TRIGGER package_offers_updated_at
  BEFORE UPDATE ON package_offers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_package_offers_type      ON package_offers (package_type);
CREATE INDEX IF NOT EXISTS idx_package_offers_country   ON package_offers (country);
CREATE INDEX IF NOT EXISTS idx_package_offers_continent ON package_offers (continent);

-- Same posture as every other table: RLS on, no policies → service role only.
ALTER TABLE package_offers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON package_offers FROM anon, authenticated;

-- ============================================================
-- App read model (mirrors app_cruise_offer_cards: server-only, service role)
-- New view, so no superset constraint vs. the live cruise view.
-- ============================================================
CREATE OR REPLACE VIEW app_package_cards
WITH (security_invoker = true) AS
SELECT
  p.id AS offer_id,
  p.package_type,
  p.title,
  p.slug,
  p.source,
  p.source_listing_id,
  p.source_url,
  p.continent,
  p.country,
  p.region,
  p.location_label,
  p.lat,
  p.lng,
  p.pickup_location,
  p.itinerary_spots,
  p.itineraries,
  p.skill_levels,
  p.wind_strength,
  p.water_conditions,
  p.spot_conditions,
  p.wind_probability,
  p.kite_services,
  p.kite_lessons,
  p.equipment_rental,
  p.conditions_text,
  p.suitable_for,
  p.suitable_for_non_kiters,
  p.family_friendly,
  p.ambience,
  p.experience_types,
  p.meal_plan,
  p.dietary_options,
  p.flight_search_assistance,
  p.languages,
  p.included_services,
  p.optional_services,
  p.extra_expenses,
  p.accommodation,
  p.rooms,
  p.duration_nights,
  p.price_from,
  p.price_currency,
  p.price_unit,
  p.price_basis_note,
  p.pricing,
  p.payment_terms,
  p.deposit_pct,
  p.cancellation_policy,
  p.summary,
  p.description_sections,
  p.images,
  p.hero_video_url,
  p.video_urls,
  p.host_name,
  p.host_member_since,
  p.host_response_rate,
  p.host_response_time,
  p.host_verified,
  p.bstoked_rating,
  p.bstoked_review_count,
  p.extraction_confidence,
  p.manually_verified,
  p.updated_at
FROM package_offers p
WHERE p.is_active;

REVOKE ALL ON app_package_cards FROM anon, authenticated;
