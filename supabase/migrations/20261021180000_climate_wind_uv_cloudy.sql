-- ============================================================
-- Wind per country/region month + UV with clouds + Sicily region
-- ============================================================
-- Aaron 2026-10-21:
--   wind  "Wie von dir vorgeschlagen, aber nur mit Wassertemperatur mindestens etwa
--         10 Grad Celsius": Bstoked windProbability (wind_stats.months) stays the value
--         wherever it is a real number (not the stored placeholder 10). ERA5 share of
--         kiteable days (>= 12 kn for >= 3 consecutive hours, 08-19 local solar time,
--         2016-2025) fills only the placeholder months, countries without a Bstoked row
--         and the regions, and only in months whose water_temp_months >= 10 C. Everything
--         else is NULL = no data. Points without water temperature (lakes, fjords) get no
--         ERA5 fill. No calibration: the ERA5/Bstoked fit is weak (RMSE 28 pp, r 0.52;
--         report in the side-session notes, 2026-10-21).
--   UV    two values: uv_months = computed clear-sky max (unchanged), uv_cloudy_months =
--         CAMS all-sky daily max around local noon (ADS, one-off fill, climatology).
--
-- New columns (all nullable, additive; existing rows unchanged until the job fills them):
--   climate_points          wind_kiteable_months SMALLINT[]  ERA5 share of kiteable days, %
--                           uv_cloudy_months NUMERIC(3,1)[]   CAMS all-sky UV, whole numbers
--                           uv_cloudy_source TEXT
--   country_climate_stats / region_climate_stats
--                           wind_months SMALLINT[]            combined value, % (NULL element = no data)
--                           wind_source_months TEXT[]         per month 'bstoked' | 'era5' | NULL
--                           uv_cloudy_months NUMERIC(3,1)[], uv_cloudy_source TEXT
-- `sources` keeps its exact text (the KCS app pins it).
--
-- Also: region IT-82 Sicily (Lo Stagnone; the Italy country point stays Porto Pollo,
-- Sardinia, as fallback for the rest of Italy).
--
-- Safe to re-run: IF NOT EXISTS, guarded constraints, ON CONFLICT DO NOTHING.
-- ============================================================

ALTER TABLE climate_points        ADD COLUMN IF NOT EXISTS wind_kiteable_months SMALLINT[];
ALTER TABLE climate_points        ADD COLUMN IF NOT EXISTS uv_cloudy_months     NUMERIC(3,1)[];
ALTER TABLE climate_points        ADD COLUMN IF NOT EXISTS uv_cloudy_source     TEXT;

ALTER TABLE country_climate_stats ADD COLUMN IF NOT EXISTS wind_months          SMALLINT[];
ALTER TABLE country_climate_stats ADD COLUMN IF NOT EXISTS wind_source_months   TEXT[];
ALTER TABLE country_climate_stats ADD COLUMN IF NOT EXISTS uv_cloudy_months     NUMERIC(3,1)[];
ALTER TABLE country_climate_stats ADD COLUMN IF NOT EXISTS uv_cloudy_source     TEXT;

ALTER TABLE region_climate_stats  ADD COLUMN IF NOT EXISTS wind_months          SMALLINT[];
ALTER TABLE region_climate_stats  ADD COLUMN IF NOT EXISTS wind_source_months   TEXT[];
ALTER TABLE region_climate_stats  ADD COLUMN IF NOT EXISTS uv_cloudy_months     NUMERIC(3,1)[];
ALTER TABLE region_climate_stats  ADD COLUMN IF NOT EXISTS uv_cloudy_source     TEXT;

DO $$
DECLARE t TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'climate_points_wind_uv_12') THEN
    ALTER TABLE climate_points ADD CONSTRAINT climate_points_wind_uv_12 CHECK (
      (wind_kiteable_months IS NULL OR cardinality(wind_kiteable_months) = 12)
      AND (uv_cloudy_months IS NULL OR cardinality(uv_cloudy_months) = 12));
  END IF;
  FOREACH t IN ARRAY ARRAY['country_climate_stats', 'region_climate_stats'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_wind_uv_12') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (
        (wind_months IS NULL OR cardinality(wind_months) = 12)
        AND (wind_source_months IS NULL OR (cardinality(wind_source_months) = 12
             AND array_remove(wind_source_months, NULL) <@ ARRAY[''bstoked'', ''era5'']::text[]))
        AND (uv_cloudy_months IS NULL OR cardinality(uv_cloudy_months) = 12))', t, t || '_wind_uv_12');
    END IF;
  END LOOP;
END $$;

INSERT INTO climate_region_points (region_key, country, region_name, iso_3166_2, spot_name, lat, lng, elevation_m) VALUES
  ('IT-82', 'Italy', 'Sicily', '{IT-82}', 'Lo Stagnone, Marsala', 37.87, 12.47, NULL)
ON CONFLICT (region_key) DO NOTHING;
