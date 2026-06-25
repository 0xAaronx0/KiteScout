-- ============================================================
-- Richer per-offer attributes + per-region conditions
-- ============================================================
-- Adds the fields the UI designer asked for. Conditions (water/wind) are a
-- property of the REGION, so each offer only carries the RAW per-page signal;
-- the displayed conditions live in region_conditions (built by
-- `pnpm cli region-conditions` as an LLM consensus over a region's providers,
-- with a general-knowledge fallback when no provider mentions them).
--
-- RUN THIS BEFORE the next extraction — the offer upsert writes these columns.
-- Safe to re-run.
-- ============================================================

ALTER TABLE cruise_offers
  ADD COLUMN IF NOT EXISTS skill_levels            TEXT[]  NOT NULL DEFAULT '{}',  -- beginner|intermediate|advanced
  ADD COLUMN IF NOT EXISTS water_conditions        TEXT[]  NOT NULL DEFAULT '{}',  -- RAW signal: flat|choppy|waves (display uses region_conditions)
  ADD COLUMN IF NOT EXISTS wind_strength           TEXT[]  NOT NULL DEFAULT '{}',  -- RAW signal: light|medium|strong
  ADD COLUMN IF NOT EXISTS included_services       TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS optional_services       TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS comfort_level           TEXT    CHECK (comfort_level IN ('budget','standard','premium','luxury')),
  ADD COLUMN IF NOT EXISTS suitable_for_non_kiters BOOLEAN,
  ADD COLUMN IF NOT EXISTS family_friendly         BOOLEAN,
  ADD COLUMN IF NOT EXISTS accommodation           TEXT,
  ADD COLUMN IF NOT EXISTS meal_plan               TEXT,                            -- all_inclusive|full_board|half_board|self_catering
  ADD COLUMN IF NOT EXISTS capacity_guests         INTEGER,
  ADD COLUMN IF NOT EXISTS cabin_count             INTEGER,
  ADD COLUMN IF NOT EXISTS price_confidence        TEXT    CHECK (price_confidence IN ('high','medium','low'));

-- Per-region consensus conditions (the display source for water/wind).
CREATE TABLE IF NOT EXISTS region_conditions (
  region_key        TEXT PRIMARY KEY,                 -- normalized "country|region" (region '' when absent)
  country           TEXT NOT NULL,
  region            TEXT,
  water_conditions  TEXT[]  NOT NULL DEFAULT '{}',     -- union: flat|choppy|waves
  wind_strength     TEXT[]  NOT NULL DEFAULT '{}',     -- range: light|medium|strong
  note              TEXT,                              -- short human description
  confidence        TEXT    NOT NULL DEFAULT 'low' CHECK (confidence IN ('high','medium','low')),
  source_count      INTEGER NOT NULL DEFAULT 0,        -- providers that reported real data (0 = LLM-only fallback)
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_region_conditions_country ON region_conditions (lower(country));
