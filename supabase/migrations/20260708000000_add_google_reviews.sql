-- ============================================================
-- Google reviews on cruise providers (mirrors the TripAdvisor/
-- bstoked columns from 20260623000100_add_provider_review_links).
-- Populated by `pnpm cli cruise-reviews`.
-- Safe to re-run: ADD COLUMN IF NOT EXISTS, no destructive drop.
-- ============================================================

ALTER TABLE cruise_providers
  ADD COLUMN IF NOT EXISTS google_url           TEXT,
  ADD COLUMN IF NOT EXISTS google_rating        NUMERIC(2,1),
  ADD COLUMN IF NOT EXISTS google_review_count  INTEGER;

COMMENT ON COLUMN cruise_providers.google_url          IS 'Google Maps place URL of the operator (self-linked or Maps-search matched)';
COMMENT ON COLUMN cruise_providers.google_rating       IS 'Google review star rating (0.0–5.0) at last check';
COMMENT ON COLUMN cruise_providers.google_review_count IS 'Number of Google reviews at last check';
