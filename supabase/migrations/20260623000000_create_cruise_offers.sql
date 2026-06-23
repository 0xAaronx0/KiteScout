-- ============================================================
-- Cruise offers: one row per distinct cruise PRODUCT
-- ============================================================
-- A cruise_provider can run several distinct offers (different
-- itineraries / vessels / regions / seasons). This table is the
-- structured, machine-extracted source of truth for those offers,
-- including curated images and the named itinerary stops.
--
-- Populated by `pnpm cli cruise-offers`.
-- Safe to re-run: CREATE … IF NOT EXISTS, no destructive drop.
-- ============================================================

CREATE TABLE IF NOT EXISTS cruise_offers (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cruise_provider_id    UUID        NOT NULL REFERENCES cruise_providers(id) ON DELETE CASCADE,

  -- ----- identity / provenance -----
  title                 TEXT        NOT NULL,             -- e.g. "Grenadines 8-Day Kite Cruise"
  slug                  TEXT        NOT NULL,             -- normalized title → idempotent upsert key
  source_url            TEXT,                             -- page the offer was extracted from

  -- ----- location -----
  continent             TEXT,                             -- derived in code from country
  country               TEXT,
  region                TEXT,
  countries             TEXT[]      NOT NULL DEFAULT '{}',-- multi-country itineraries
  departure_port        TEXT,

  -- ----- itinerary -----
  -- Ordered named spots/anchorages the cruise actually visits (optional per offer):
  --   [{ "name": "Sal Rei", "country": "Cape Verde", "region": null,
  --      "lat": 16.18, "lng": -22.91, "order": 0 }, …]
  itinerary_spots       JSONB       NOT NULL DEFAULT '[]',

  -- ----- vessel (reuses the cruise_providers vessel_type enum) -----
  vessel_name           TEXT,
  vessel_type           TEXT        CHECK (vessel_type IN (
                          'catamaran', 'sailing_yacht', 'motor_yacht',
                          'gulet', 'dhow', 'liveaboard', 'speedboat', 'other'
                        )),

  -- ----- booking & suitability (bool NULL = unknown) -----
  booking_modes         TEXT[]      NOT NULL DEFAULT '{}',-- ⊆ whole_boat | per_cabin | single_spot
  beginner_friendly     BOOLEAN,
  kite_lessons          BOOLEAN,
  equipment_rental      BOOLEAN,

  -- ----- availability -----
  season_text           TEXT,                             -- "June–September"
  season_start_month    SMALLINT    CHECK (season_start_month BETWEEN 1 AND 12),
  season_end_month      SMALLINT    CHECK (season_end_month   BETWEEN 1 AND 12),
  duration_days         INTEGER,
  -- Concrete departures when published:
  --   [{ "start_date": "2026-07-04", "end_date": "2026-07-11",
  --      "price": 1890, "currency": "EUR", "status": "available" }, …]
  dates                 JSONB,

  -- ----- pricing -----
  -- { "per_person": 1890, "per_cabin": 3600, "whole_boat": 14000,
  --   "currency": "EUR", "raw": "from €1,890 p.p. (cabin share)" }
  pricing               JSONB,
  price_from_eur        INTEGER,                          -- normalized → sorting / filtering
  currency              TEXT,                             -- original quote currency (often USD)

  -- ----- content -----
  summary               TEXT,                             -- AI 2–3 sentence summary
  -- Curated, compressed images stored in the private Supabase bucket:
  --   [{ "path": "cruise-offers/<provider>/<slug>/0.webp", "source_url": "…",
  --      "width": 1280, "height": 853, "bytes": 98213, "caption": "catamaran at anchor",
  --      "sort": 0 }, …]
  images                JSONB       NOT NULL DEFAULT '[]',

  -- ----- meta -----
  extraction_confidence TEXT        NOT NULL DEFAULT 'medium'
                                    CHECK (extraction_confidence IN ('high', 'medium', 'low')),
  manually_verified     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (cruise_provider_id, slug)
);

DROP TRIGGER IF EXISTS cruise_offers_updated_at ON cruise_offers;
CREATE TRIGGER cruise_offers_updated_at
  BEFORE UPDATE ON cruise_offers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_cruise_offers_provider   ON cruise_offers (cruise_provider_id);
CREATE INDEX IF NOT EXISTS idx_cruise_offers_country    ON cruise_offers (country);
CREATE INDEX IF NOT EXISTS idx_cruise_offers_continent  ON cruise_offers (continent);
CREATE INDEX IF NOT EXISTS idx_cruise_offers_price      ON cruise_offers (price_from_eur) WHERE price_from_eur IS NOT NULL;
