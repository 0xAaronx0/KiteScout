-- ============================================================
-- Cruise provider monitoring: detect changes on kite-cruise
-- provider websites without re-running the full LLM discovery.
--
-- These hold real monitoring history, so this migration is
-- ADDITIVE (CREATE TABLE/INDEX IF NOT EXISTS) — it never drops
-- existing rows. Re-running it is safe.
--
-- Self-contained: references cruise_providers only; does NOT
-- alter cruise_providers (that table is a derived snapshot that
-- its own migration drops + recreates).
-- ============================================================

-- One watched URL per row (starts as the provider's website / homepage,
-- but the schema supports several watched pages per provider later on).
CREATE TABLE IF NOT EXISTS cruise_watch (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cruise_provider_id   UUID        NOT NULL REFERENCES cruise_providers(id) ON DELETE CASCADE,
  url                  TEXT        NOT NULL,
  content_hash         TEXT,                       -- sha256 of normalized page text
  content_snapshot     TEXT,                       -- readable text snapshot, for diffing
  etag                 TEXT,                       -- HTTP ETag for conditional GETs
  last_modified        TEXT,                       -- HTTP Last-Modified header value
  fetch_method         TEXT        NOT NULL DEFAULT 'direct'
                                   CHECK (fetch_method IN ('direct', 'tavily')),
  last_checked_at      TIMESTAMPTZ,
  last_changed_at      TIMESTAMPTZ,
  consecutive_failures INTEGER     NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cruise_provider_id, url)
);

-- Index for "which watches are due for a check" (oldest / never-checked first).
CREATE INDEX IF NOT EXISTS idx_cruise_watch_due ON cruise_watch (last_checked_at NULLS FIRST);

-- Changelog of detected, traveler-relevant changes.
CREATE TABLE IF NOT EXISTS cruise_changes (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cruise_provider_id UUID        NOT NULL REFERENCES cruise_providers(id) ON DELETE CASCADE,
  watch_id           UUID        REFERENCES cruise_watch(id) ON DELETE SET NULL,
  url                TEXT,
  change_type        TEXT,        -- new_offer | price_change | dates_change | removed_offer | content_update | none
  summary            TEXT,        -- short human-readable description
  details            JSONB,       -- { offers: [...], changes: ["..."] }
  significant        BOOLEAN     NOT NULL DEFAULT TRUE,
  seen               BOOLEAN     NOT NULL DEFAULT FALSE,
  detected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cruise_changes_provider ON cruise_changes (cruise_provider_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_cruise_changes_unseen   ON cruise_changes (detected_at DESC) WHERE NOT seen;
