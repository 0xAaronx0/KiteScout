-- KiteScout initial schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- One row per unique kite travel / rental business, keyed by root domain
CREATE TABLE providers (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT,
  root_domain       TEXT        UNIQUE NOT NULL,
  website_url       TEXT,
  primary_country   TEXT,
  primary_region    TEXT,
  description       TEXT,
  contact_email     TEXT,
  contact_form_url  TEXT,
  languages         TEXT[]      NOT NULL DEFAULT '{}',
  trip_types        TEXT[]      NOT NULL DEFAULT '{}',
  discovery_source  TEXT,
  status            TEXT        NOT NULL DEFAULT 'new'
                                CHECK (status IN ('new', 'verified', 'dead', 'duplicate')),
  duplicate_of      UUID        REFERENCES providers(id),
  last_verified_at  TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Countries / regions / spots where a provider operates
-- (one provider can run camps in Egypt AND Morocco AND Brazil)
CREATE TABLE provider_locations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID        NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  country     TEXT        NOT NULL,
  region      TEXT,
  spot_name   TEXT,
  lat         DECIMAL(9,6),
  lng         DECIMAL(10,6),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every search query we plan to run or have run
CREATE TABLE discovery_queries (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  query         TEXT        NOT NULL,
  language      TEXT        NOT NULL,
  search_engine TEXT        NOT NULL DEFAULT 'tavily',
  page          INTEGER     NOT NULL DEFAULT 1,
  executed_at   TIMESTAMPTZ,
  num_results   INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (query, language, search_engine, page)
);

-- Raw URLs returned by searches, before provider extraction
CREATE TABLE raw_search_results (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id    UUID        NOT NULL REFERENCES discovery_queries(id) ON DELETE CASCADE,
  url         TEXT        NOT NULL,
  title       TEXT,
  snippet     TEXT,
  provider_id UUID        REFERENCES providers(id),
  processed   BOOLEAN     NOT NULL DEFAULT FALSE,
  error       TEXT,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (query_id, url)
);

-- Keep updated_at current on providers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER providers_updated_at
  BEFORE UPDATE ON providers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Indexes for pipeline hot paths
CREATE INDEX idx_providers_status          ON providers (status);
CREATE INDEX idx_providers_country         ON providers (primary_country);
CREATE INDEX idx_queries_pending           ON discovery_queries (created_at) WHERE executed_at IS NULL;
CREATE INDEX idx_results_unprocessed       ON raw_search_results (fetched_at) WHERE NOT processed;
CREATE INDEX idx_results_provider          ON raw_search_results (provider_id);
