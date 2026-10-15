-- ---------------------------------------------------------------------------
-- Per-spot kite conditions (Aaron 2026-10-15).
--
-- region_conditions has ONE row per country (built from cruises, where a country is usually one
-- area). Stays and camps sit at individual spots, and a country can hold very different ones
-- (Spain: Tarifa vs Fuerteventura vs the Costa Brava), so conditions need a spot level.
--
-- A spot is a cluster of offer locations: same country, within radius_km of (lat, lng).
-- The product app picks the nearest spot whose radius contains the offer's first itinerary
-- spot (itinerary_spots[0] lat/lng, already in app_package_cards), and falls back to
-- region_conditions by country when no spot matches. No view change needed.
--
--   water_conditions  flat | choppy | waves (several allowed)
--   wind_strength     light | medium | strong (a range)
--   best_months       months (1-12) with the most reliable wind
--   skill_levels      beginner | intermediate | advanced the spot suits
--   source            llm_knowledge (model, from the provider texts + its own knowledge) | provider_text | manual
--   reviewed          true once a human checked the row (llm_knowledge rows start false)
--
-- Written by pnpm cli spot-conditions. Table is new and additive: nothing reads it until the
-- app PR lands.
-- Rollback: DROP TABLE IF EXISTS spot_conditions;
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spot_conditions (
  spot_key          TEXT PRIMARY KEY,                       -- "<country slug>/<spot slug>", e.g. spain/tarifa
  country           TEXT NOT NULL,
  name              TEXT NOT NULL,
  region            TEXT,
  lat               DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng               DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  radius_km         NUMERIC NOT NULL DEFAULT 15 CHECK (radius_km > 0),
  water_conditions  TEXT[]  NOT NULL DEFAULT '{}',
  wind_strength     TEXT[]  NOT NULL DEFAULT '{}',
  best_months       SMALLINT[] NOT NULL DEFAULT '{}',
  skill_levels      TEXT[]  NOT NULL DEFAULT '{}',
  note              TEXT,
  confidence        TEXT    NOT NULL DEFAULT 'low' CHECK (confidence IN ('high','medium','low')),
  source            TEXT    NOT NULL DEFAULT 'llm_knowledge' CHECK (source IN ('llm_knowledge','provider_text','manual')),
  offer_count       INTEGER NOT NULL DEFAULT 0,
  reviewed          BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spot_conditions_country ON spot_conditions (lower(country));

-- Server-side reads only (the app uses the service role, like the climate tables).
ALTER TABLE spot_conditions ENABLE ROW LEVEL SECURITY;
