-- ============================================================
-- Cruise locations: validated per-provider cruise-specific spots
-- ============================================================
-- Distinct from provider_locations (which has all trip types).
-- Each row represents a location where a provider verifiably
-- offers kite cruises / liveaboards, extracted from their website.
-- ============================================================

CREATE TABLE cruise_locations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cruise_provider_id    UUID        NOT NULL REFERENCES cruise_providers(id) ON DELETE CASCADE,
  country               TEXT        NOT NULL,
  region                TEXT,
  spot_name             TEXT,
  lat                   DECIMAL(9,6),
  lng                   DECIMAL(10,6),
  confidence            TEXT        NOT NULL DEFAULT 'medium'
                                    CHECK (confidence IN ('high', 'medium', 'low')),
  notes                 TEXT,       -- e.g. "November–April season", "Grenadines circuit"
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (cruise_provider_id, country, region, spot_name)
);

CREATE INDEX idx_cruise_locations_provider ON cruise_locations (cruise_provider_id);
CREATE INDEX idx_cruise_locations_country  ON cruise_locations (country);
CREATE INDEX idx_cruise_locations_coords   ON cruise_locations (lat, lng) WHERE lat IS NOT NULL;
