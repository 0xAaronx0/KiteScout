-- ---------------------------------------------------------------------------
-- package_offers.season_start_month / season_end_month: the stated season of a camp, tour, course or the
-- explicit opening months of an accommodation, for the month filter on the KCS travel map (offer_bookable_months).
--
-- Why: 276 of 335 app-visible packages have no known month (live 2026-10-28); package_offers had no season
-- columns at all, the package views pass NULL. Filled by `pnpm cli season-extract apply` only after Aaron's
-- OK on the review table (evidence quote from the provider's own page); same meaning and range as
-- cruise_offers.season_*. Package ingest never writes these columns (upsert payload has no season keys).
--
-- Additive only: the app views stay unchanged (still NULL for packages); `pnpm cli bookable-months` reads the
-- columns from this table directly. Safe to re-run.
-- Rollback: ALTER TABLE public.package_offers DROP COLUMN season_start_month, DROP COLUMN season_end_month;
-- ---------------------------------------------------------------------------
BEGIN;

ALTER TABLE public.package_offers
  ADD COLUMN IF NOT EXISTS season_start_month SMALLINT CHECK (season_start_month BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS season_end_month   SMALLINT CHECK (season_end_month   BETWEEN 1 AND 12);

COMMENT ON COLUMN public.package_offers.season_start_month IS
  'First month (1-12) of the stated season / opening period; with season_end_month, wraps over the year end; 1..12 = open all year. Set by season-extract after review.';

COMMIT;
