-- ============================================================
-- Region CA-BC British Columbia (Canada: map_display 'regions_only' once it has offers)
-- ============================================================
-- Aaron 2026-10-23 ("go fuer alles", deployer question 41: prepare region British Columbia).
-- The first Canada offers (Nitinat Lake, Vancouver Island; e919797) switch Canada from
-- 'hidden' to 'regions_only' on the next climate-stats run; without a region it would stay
-- grey. Point = the offers' spot Nitinat Lake (48.75, -124.74). Its climate cell is not
-- cached yet: the next `pnpm cli climate-stats` fetches it (ERA5, seconds); UV with clouds
-- needs one `pnpm cli climate-uv-cloudy` run afterwards (CAMS, hours). Wind = ERA5 only
-- (not the Canada country point; Canada has no real Bstoked row) - likely underestimates
-- Nitinat's thermal wind, like other thermal spots.
-- KCS side: CA-BC must also be in the map's region allowlist + boundary file.
-- Safe to re-run. Rollback: DELETE FROM climate_region_points WHERE region_key = 'CA-BC';
--                           DELETE FROM region_climate_stats  WHERE region_key = 'CA-BC';
-- ============================================================

INSERT INTO climate_region_points (region_key, country, region_name, iso_3166_2, spot_name, lat, lng, elevation_m) VALUES
  ('CA-BC', 'Canada', 'British Columbia', '{CA-BC}', 'Nitinat Lake, Vancouver Island', 48.75, -124.74, NULL)
ON CONFLICT (region_key) DO NOTHING;
