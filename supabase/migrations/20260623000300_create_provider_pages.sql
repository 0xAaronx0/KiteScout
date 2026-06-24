-- ============================================================
-- provider_pages: full crawled-text corpus per cruise provider
-- ============================================================
-- One row per crawled page of a provider's website (sitemap-first crawl).
-- Stores the readable text so the booking agent can later answer free-form
-- questions, and so offer extraction never misses an unlinked page.
--
-- Text-only (no HTML) to keep it small; content_hash enables cheap
-- change-detection / incremental updates.
--
-- Populated by `pnpm cli cruise-offers` (as a byproduct of the crawl).
-- Safe to re-run: CREATE ... IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS provider_pages (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cruise_provider_id    UUID        NOT NULL REFERENCES cruise_providers(id) ON DELETE CASCADE,
  url                   TEXT        NOT NULL,
  title                 TEXT,
  text                  TEXT,
  content_hash          TEXT,
  fetched_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (cruise_provider_id, url)
);

CREATE INDEX IF NOT EXISTS idx_provider_pages_provider ON provider_pages (cruise_provider_id);
