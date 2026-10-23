-- ============================================================
-- Region IN-TN Tamil Nadu (India: map_display 'regions_only')
-- ============================================================
-- Aaron 2026-10-23 ("Ja, so"): India shows only regions with offers; today both Indian
-- offers are in Rameswaram, Tamil Nadu (= the India country point, cached cell, so no new
-- fetch; wind follows the India policy 'era5'). China: hidden until it has offers, then
-- regions only (code config in src/pipeline/climate.ts, no data change needed).
-- Safe to re-run. Rollback: DELETE FROM climate_region_points WHERE region_key = 'IN-TN';
--                           DELETE FROM region_climate_stats  WHERE region_key = 'IN-TN';
-- ============================================================

INSERT INTO climate_region_points (region_key, country, region_name, iso_3166_2, spot_name, lat, lng, elevation_m) VALUES
  ('IN-TN', 'India', 'Tamil Nadu', '{IN-TN}', 'Rameswaram', 9.28, 79.31, NULL)
ON CONFLICT (region_key) DO NOTHING;
