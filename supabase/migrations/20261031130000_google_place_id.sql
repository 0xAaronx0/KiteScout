-- ---------------------------------------------------------------------------
-- Google place ID per provider (Aaron 2026-10-31, KCS#607 option 1).
--
-- KCS shows a Google rating only through a live Places API request on the listing detail page. Google allows
-- storing place IDs indefinitely; rating and review count are never stored. Filled by `pnpm cli google-place-ids`
-- after a checked match (name search near the operator's known Maps location).
--
-- cruise_providers, providers: google_place_id TEXT (format-checked: a place ID, never a URL or a number),
--   google_place_matched_at TIMESTAMPTZ (when the match was made). Additive, NULL by default: nothing changes in
--   the product until rows are written. No view is touched; KCS reads the column server-side by provider id.
--
-- Safe to re-run. Rollback: ALTER TABLE public.cruise_providers / public.providers
--   DROP COLUMN IF EXISTS google_place_id, DROP COLUMN IF EXISTS google_place_matched_at.
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.cruise_providers
  ADD COLUMN IF NOT EXISTS google_place_id         TEXT,
  ADD COLUMN IF NOT EXISTS google_place_matched_at TIMESTAMPTZ;
ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS google_place_id         TEXT,
  ADD COLUMN IF NOT EXISTS google_place_matched_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cruise_providers_google_place_id_format') THEN
    ALTER TABLE public.cruise_providers ADD CONSTRAINT cruise_providers_google_place_id_format
      CHECK (google_place_id IS NULL OR google_place_id ~ '^[A-Za-z0-9_-]{16,255}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'providers_google_place_id_format') THEN
    ALTER TABLE public.providers ADD CONSTRAINT providers_google_place_id_format
      CHECK (google_place_id IS NULL OR google_place_id ~ '^[A-Za-z0-9_-]{16,255}$');
  END IF;
END $$;

COMMENT ON COLUMN public.cruise_providers.google_place_id IS 'Google Places place ID of the operator (stored per Places policy; rating/count are fetched live, never stored)';
COMMENT ON COLUMN public.cruise_providers.google_place_matched_at IS 'When google_place_id was matched and checked';
COMMENT ON COLUMN public.providers.google_place_id IS 'Google Places place ID of the operator (stored per Places policy; rating/count are fetched live, never stored)';
COMMENT ON COLUMN public.providers.google_place_matched_at IS 'When google_place_id was matched and checked';

COMMIT;
