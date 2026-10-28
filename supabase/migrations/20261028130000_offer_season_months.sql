-- ---------------------------------------------------------------------------
-- season_months + season_evidence on package_offers and cruise_offers: the months (1-12) of an offer's stated season as a set,
-- for the month filter on the KCS travel map (offer_bookable_months). A set, not start/end, because several
-- destinations have two distinct wind seasons (Aaron 2026-10-28: "zwei oder sogar mehr Saisonfenster", e.g.
-- Kenya, Zanzibar, Sri Lanka, Hatteras).
--
-- Why: 276 of 335 app-visible packages have no known month (live 2026-10-28); package_offers had no season
-- columns at all, the package views pass NULL. cruise_offers keeps season_start_month/season_end_month for a
-- single window; season_months is only set where one window is not enough. Filled by
-- `pnpm cli season-extract apply` only after Aaron's OK (evidence quote from the provider's own page).
-- Package ingest and the cruise extraction/observe paths never write these columns.
--
-- season_evidence (both tables): what season-extract wrote and why ({source, months, quote, url, basis,
-- checked_at}). Seasons are re-read twice a year (`season-extract --recheck`, Aaron 2026-10-28: opening periods
-- and event dates change); `apply --update` only overwrites where the stored months still equal
-- season_evidence.months, so a hand correction is never overwritten.
--
-- Additive only: the app views stay unchanged; `pnpm cli bookable-months` reads the column from the tables
-- directly (season_months wins over start/end). Safe to re-run.
-- Rollback: ALTER TABLE public.package_offers DROP COLUMN season_months, DROP COLUMN season_evidence;
--           ALTER TABLE public.cruise_offers  DROP COLUMN season_months, DROP COLUMN season_evidence;
-- ---------------------------------------------------------------------------
BEGIN;

ALTER TABLE public.package_offers
  ADD COLUMN IF NOT EXISTS season_months SMALLINT[]
  CONSTRAINT package_offers_season_months_check CHECK (
    season_months IS NULL OR (cardinality(season_months) BETWEEN 1 AND 12
      AND season_months <@ ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]::smallint[]));

ALTER TABLE public.cruise_offers
  ADD COLUMN IF NOT EXISTS season_months SMALLINT[]
  CONSTRAINT cruise_offers_season_months_check CHECK (
    season_months IS NULL OR (cardinality(season_months) BETWEEN 1 AND 12
      AND season_months <@ ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]::smallint[]));

ALTER TABLE public.package_offers ADD COLUMN IF NOT EXISTS season_evidence JSONB;
ALTER TABLE public.cruise_offers  ADD COLUMN IF NOT EXISTS season_evidence JSONB;

COMMENT ON COLUMN public.package_offers.season_months IS
  'Months (1-12) of the stated season / opening period, several windows allowed; {1..12} = open all year. Set by season-extract after review.';
COMMENT ON COLUMN public.cruise_offers.season_months IS
  'Months (1-12) of the stated season when one start/end window is not enough (two wind seasons); wins over season_start/end_month in bookable-months. Set by season-extract after review.';

COMMENT ON COLUMN public.package_offers.season_evidence IS
  'season-extract provenance {source, months, quote, url, basis, checked_at}; basis for the half-yearly recheck.';
COMMENT ON COLUMN public.cruise_offers.season_evidence IS
  'season-extract provenance {source, months, quote, url, basis, checked_at}; basis for the half-yearly recheck.';

COMMIT;
