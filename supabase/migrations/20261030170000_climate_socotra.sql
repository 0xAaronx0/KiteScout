-- ============================================================
-- Socotra: full climate including wind
-- ============================================================
-- Aaron 2026-10-30: the island of Socotra (Yemen) gets all map layers including wind, while mainland Yemen
-- stays grey. KCS splits Socotra's polygons off the Yemen atlas unit under the name 'Socotra' (KCS branch
-- claude/climate-only-units), so this row colours the island only.
-- Point: Qalansiyah lagoon on the north-west coast (sea level). Wind: no Bstoked row, so the normal policy
-- gives the ERA5 share of kiteable days (water is >= 10 C all year). `pnpm cli climate-stats` fetches the cell
-- and ERA5 wind; UV with clouds needs `pnpm cli climate-uv-cloudy`.
--
-- Additive only. Safe to re-run. Rollback:
--   DELETE FROM country_climate_stats  WHERE country = 'Socotra';
--   DELETE FROM climate_country_points WHERE country = 'Socotra';
-- ============================================================

INSERT INTO climate_country_points (country, is_alias, spot_name, lat, lng, elevation_m) VALUES
  ('Socotra', FALSE, 'Qalansiyah, Socotra', 12.69, 53.49, 0)
ON CONFLICT (country) DO NOTHING;
