-- ============================================================
-- Cruise providers: full provider data + vessel enrichment
-- ============================================================
-- Safe to re-run: drops and recreates the table.
DROP TABLE IF EXISTS cruise_providers;

-- ============================================================
-- Denormalized snapshot of every provider that offers kite cruises,
-- plus cruise-specific fields for manual enrichment.
-- Seeded from providers WHERE trip_types @> '{cruise}'.
-- ============================================================

CREATE TABLE cruise_providers (
  -- ----- core identity (mirrors providers) -----
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id             UUID        UNIQUE REFERENCES providers(id) ON DELETE SET NULL,
  name                    TEXT,
  root_domain             TEXT        UNIQUE NOT NULL,
  website_url             TEXT,

  -- ----- location (mirrors providers) -----
  primary_country         TEXT,
  primary_region          TEXT,

  -- ----- content (mirrors providers) -----
  description             TEXT,
  trip_types              TEXT[]      NOT NULL DEFAULT '{}',
  languages               TEXT[]      NOT NULL DEFAULT '{}',
  discovery_source        TEXT,

  -- ----- contact (mirrors providers) -----
  contact_email           TEXT,
  contact_form_url        TEXT,
  whatsapp                TEXT,
  phone                   TEXT,

  -- ----- status (mirrors providers) -----
  status                  TEXT        NOT NULL DEFAULT 'new'
                                      CHECK (status IN ('new', 'verified', 'dead', 'duplicate')),
  duplicate_of            UUID        REFERENCES providers(id),
  notes                   TEXT,
  last_verified_at        TIMESTAMPTZ,
  verified_at             TIMESTAMPTZ,

  -- ----- cruise-specific enrichment (all nullable) -----
  vessel_name             TEXT,
  vessel_type             TEXT        CHECK (vessel_type IN (
                            'catamaran', 'sailing_yacht', 'motor_yacht',
                            'gulet', 'dhow', 'liveaboard', 'speedboat', 'other'
                          )),
  passenger_capacity      INTEGER,
  cabin_count             INTEGER,
  typical_duration_days   INTEGER,
  home_port               TEXT,
  itinerary_notes         TEXT,
  price_per_person_eur    INTEGER,
  manually_verified       BOOLEAN     NOT NULL DEFAULT FALSE,

  -- ----- timestamps -----
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER cruise_providers_updated_at
  BEFORE UPDATE ON cruise_providers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_cruise_providers_status      ON cruise_providers (status);
CREATE INDEX idx_cruise_providers_country     ON cruise_providers (primary_country);
CREATE INDEX idx_cruise_providers_vessel_type ON cruise_providers (vessel_type);
CREATE INDEX idx_cruise_providers_verified    ON cruise_providers (manually_verified);

-- ============================================================
-- Seed from existing cruise providers
-- ============================================================
INSERT INTO cruise_providers (
  provider_id, name, root_domain, website_url,
  primary_country, primary_region,
  description, trip_types, languages, discovery_source,
  contact_email, contact_form_url, whatsapp, phone,
  status, duplicate_of, notes, last_verified_at, verified_at,
  created_at, updated_at
)
SELECT
  id, name, root_domain, website_url,
  primary_country, primary_region,
  description, trip_types, languages, discovery_source,
  contact_email, contact_form_url, whatsapp, phone,
  status, duplicate_of, notes, last_verified_at, verified_at,
  created_at, updated_at
FROM providers
WHERE trip_types @> ARRAY['cruise']
  AND status NOT IN ('dead', 'duplicate');
