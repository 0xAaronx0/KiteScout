-- ============================================================
-- Map display mode per country + spot-state regions for USA and Brazil
-- ============================================================
-- Aaron 2026-10-23 ("option A please"; Canada "ausblenden, solange wir dort keine offers
-- haben (und mit offers dann nur regions zeigen)"; Russia "als no data zeigen"):
--
--   country_climate_stats.map_display  how the map colours a country, for ALL layers
--                                      (air, water, UV, wind incl. wind_stats):
--     'country'       country row colours the whole country, region rows override their
--                     admin-1 units (default, unchanged behaviour)
--     'regions_only'  only the admin-1 units of region rows are coloured, the rest of
--                     the country shows "no data" (USA, Brazil; Canada once it has offers)
--     'hidden'        nothing is coloured, "no data" (Russia; Canada without offers)
--   Set by `pnpm cli climate-stats` from WIND/MAP config in src/pipeline/climate.ts;
--   alias rows follow their canonical country.
--
-- New regions so that every US/Brazil state with offers is a region (option A):
--   US-NC  North Carolina  Outer Banks (the US country point)
--   BR-NE  Ceara, Piaui, Maranhao, Rio Grande do Norte  Cumbuco (the Brazil country point)
-- Existing: US-FL, US-HI, US-OR, BR-SC, BR-SE (RJ+SP). Both new points reuse cached cells,
-- so no new Copernicus fetch is needed.
--
-- Safe to re-run: IF NOT EXISTS, guarded constraint, ON CONFLICT DO NOTHING.
-- Rollback: ALTER TABLE country_climate_stats DROP COLUMN map_display;
--           DELETE FROM climate_region_points WHERE region_key IN ('US-NC','BR-NE');
--           DELETE FROM region_climate_stats  WHERE region_key IN ('US-NC','BR-NE');
-- ============================================================

ALTER TABLE country_climate_stats ADD COLUMN IF NOT EXISTS map_display TEXT NOT NULL DEFAULT 'country';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'country_climate_stats_map_display') THEN
    ALTER TABLE country_climate_stats ADD CONSTRAINT country_climate_stats_map_display
      CHECK (map_display IN ('country', 'regions_only', 'hidden'));
  END IF;
END $$;

INSERT INTO climate_region_points (region_key, country, region_name, iso_3166_2, spot_name, lat, lng, elevation_m) VALUES
  ('US-NC', 'United States', 'North Carolina', '{US-NC}', 'Outer Banks (Waves, NC)', 35.57, -75.47, NULL),
  ('BR-NE', 'Brazil', 'Ceará, Piauí, Maranhão and Rio Grande do Norte', '{BR-CE,BR-PI,BR-MA,BR-RN}', 'Cumbuco', -3.63, -38.73, NULL)
ON CONFLICT (region_key) DO NOTHING;
