-- ============================================================
-- Provider review links: bstoked + TripAdvisor
-- ============================================================
-- External review pages for a cruise provider, matched conservatively.
-- TripAdvisor is only ever stored when DOMAIN-CORROBORATED — i.e. the
-- listing references the operator's own root_domain — because generic
-- TripAdvisor matching by name alone is highly error-prone.
--
-- Stored as columns on cruise_providers (review facts are about the
-- operator/boat, shared across all of that provider's offers).
--
-- Populated by `pnpm cli cruise-reviews`.
-- Safe to re-run: ADD COLUMN IF NOT EXISTS.
-- ============================================================

ALTER TABLE cruise_providers
  ADD COLUMN IF NOT EXISTS bstoked_url               TEXT,
  ADD COLUMN IF NOT EXISTS bstoked_rating            NUMERIC(2,1),
  ADD COLUMN IF NOT EXISTS bstoked_review_count      INTEGER,
  ADD COLUMN IF NOT EXISTS tripadvisor_url           TEXT,
  ADD COLUMN IF NOT EXISTS tripadvisor_rating        NUMERIC(2,1),
  ADD COLUMN IF NOT EXISTS tripadvisor_review_count  INTEGER,
  ADD COLUMN IF NOT EXISTS reviews_checked_at        TIMESTAMPTZ,
  -- Human-auditable evidence for why each link was accepted (domain match, etc.)
  ADD COLUMN IF NOT EXISTS review_match_notes        TEXT;
