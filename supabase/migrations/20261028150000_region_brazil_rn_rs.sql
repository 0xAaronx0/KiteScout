-- ============================================================
-- Regions BR-RN Rio Grande do Norte + BR-RS Rio Grande do Sul; BR-NE without RN
-- ============================================================
-- Aaron 2026-10-28 (Brazil wind research, "Werte passen"): the RN east corner keeps the trade
-- wind in Jan-Jun clearly better than the north coast (3 models + guides), and Rio Grande do
-- Sul has its own season; Brazil is map_display 'regions_only', so RS showed "no data".
--   BR-RN  point = São Miguel do Gostoso (median of the 6 RN offers, 2 of them there)
--   BR-RS  point = Tramandaí (no offers yet; the state's main kite area next to Lagoa dos
--          Barros / Osório, mid-coast)
--   BR-NE  keeps Cumbuco, now Ceará, Piauí and Maranhão only.
-- Wind for BR-RN / BR-RS comes from REGION_BSTOKED (src/pipeline/climate.ts, source 'bstoked');
-- BR-NE keeps the Brazil wind_stats row. The BR-RS cell is not cached yet: the next
-- `pnpm cli climate-stats` fetches it (ERA5); UV with clouds needs `pnpm cli climate-uv-cloudy`.
--
-- ORDER: the KCS map must already know BR-RN/BR-RS and the new BR-NE code list (CLIMATE_REGIONS
-- in src/features/map/regional-climate.ts + regenerated boundary files). KCS drops a region row
-- whose iso_3166_2 differs from its allowlist, so BR-NE is "no data" between the KCS deploy and
-- this migration: run it right after the KCS deploy, then `pnpm cli climate-stats`.
-- region_climate_stats BR-NE is updated here too, so the switch does not wait for the job.
--
-- Safe to re-run. Rollback:
--   DELETE FROM climate_region_points WHERE region_key IN ('BR-RN','BR-RS');
--   DELETE FROM region_climate_stats  WHERE region_key IN ('BR-RN','BR-RS');
--   UPDATE climate_region_points SET region_name = 'Ceará, Piauí, Maranhão and Rio Grande do Norte',
--     iso_3166_2 = '{BR-CE,BR-PI,BR-MA,BR-RN}' WHERE region_key = 'BR-NE';
--   UPDATE region_climate_stats  SET region_name = 'Ceará, Piauí, Maranhão and Rio Grande do Norte',
--     iso_3166_2 = '{BR-CE,BR-PI,BR-MA,BR-RN}' WHERE region_key = 'BR-NE';
-- ============================================================

INSERT INTO climate_region_points (region_key, country, region_name, iso_3166_2, spot_name, lat, lng, elevation_m) VALUES
  ('BR-RN', 'Brazil', 'Rio Grande do Norte', '{BR-RN}', 'São Miguel do Gostoso', -5.12, -35.63, NULL),
  ('BR-RS', 'Brazil', 'Rio Grande do Sul', '{BR-RS}', 'Tramandaí', -29.98, -50.13, NULL)
ON CONFLICT (region_key) DO NOTHING;

UPDATE climate_region_points SET region_name = 'Ceará, Piauí and Maranhão', iso_3166_2 = '{BR-CE,BR-PI,BR-MA}'
  WHERE region_key = 'BR-NE';
UPDATE region_climate_stats SET region_name = 'Ceará, Piauí and Maranhão', iso_3166_2 = '{BR-CE,BR-PI,BR-MA}'
  WHERE region_key = 'BR-NE';
