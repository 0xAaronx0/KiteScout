-- ---------------------------------------------------------------------------
-- offer_bookable_months: the months (1-12) in which an offer is known to be bookable, one compact row per
-- offer, for the month filter on the KCS travel map (MartinMarzi/KiteCruiseScout#316, Aaron 2026-10-21).
--
-- Why a table and not a view column: the map snapshot deliberately does not transfer the dated-slot JSON
-- (KCS #293), and both app views are owned by both repos. This small table carries only the result.
--
-- Filled daily by `pnpm cli bookable-months` (monitor workflow, after the slot refresh) from the same app
-- views the product reads: season_start_month..season_end_month (wrapping) plus every month touched by a
-- future dated slot that is not cancelled/closed/sold out/unavailable/waitlist and has spots left - the same
-- rules as KCS buildAvailableDates. An offer without a row is "unknown" and stays visible on the map.
--
-- RLS on, no policies: server-side reads with the service role only (like country_climate_stats).
-- Safe to re-run. Rollback: DROP TABLE public.offer_bookable_months;
-- ---------------------------------------------------------------------------
BEGIN;

CREATE TABLE IF NOT EXISTS public.offer_bookable_months (
  catalog_source TEXT NOT NULL CHECK (catalog_source IN ('cruise_offers', 'package_offers')),
  offer_id       UUID NOT NULL,
  months         SMALLINT[] NOT NULL
                 CHECK (cardinality(months) BETWEEN 1 AND 12
                        AND months <@ ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]::smallint[]),
  basis          TEXT NOT NULL CHECK (basis IN ('season', 'dates', 'season+dates')),
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (catalog_source, offer_id)
);

ALTER TABLE public.offer_bookable_months ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.offer_bookable_months IS
  'Months (1-12) an offer is known to be bookable (season + future open dated slots); no row = unknown. Filled by pnpm cli bookable-months.';

COMMIT;
