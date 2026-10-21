-- ============================================================
-- Climate per region (large countries with offers) + missing offer countries
-- ============================================================
-- Aaron 2026-10-21: large countries with offers get climate regions on the map
-- (USA, Australia, Brazil, Spain, Mexico, Morocco, Japan; Chile stays one point).
-- wind_stats stays per country.
--
--   climate_region_points  one kite spot per region (median offer spot of the region,
--                          from the app views 2026-10-21). iso_3166_2 = the admin-1 units
--                          the app colours with this region. Admin-1 units not listed fall
--                          back to the country row (country_climate_stats), so regions
--                          exist only where the climate differs from the country point.
--   region_climate_stats   one row per region with the climate of that spot (same columns
--                          and units as country_climate_stats); filled by
--                          pnpm cli climate-stats (weekly GitHub Action).
--
-- Also seeds climate_country_points for the 15 countries that have offers but no point
-- yet (no wind_stats row either). New offer countries are added by the job from then on
-- (median offer spot of that country).
--
-- Safe to re-run: IF NOT EXISTS + ON CONFLICT DO NOTHING (edited points are kept).
-- ============================================================

CREATE TABLE IF NOT EXISTS climate_region_points (
  region_key    TEXT PRIMARY KEY,                -- e.g. 'US-HI', 'MA-NORTH'
  country       TEXT NOT NULL,                   -- exactly as in country_climate_stats.country
  region_name   TEXT NOT NULL,
  iso_3166_2    TEXT[] NOT NULL,                 -- admin-1 units this region colours
  spot_name     TEXT NOT NULL,
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  elevation_m   INTEGER,                         -- NULL = sea level
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT climate_region_points_iso CHECK (cardinality(iso_3166_2) >= 1)
);

CREATE TABLE IF NOT EXISTS region_climate_stats (
  region_key            TEXT PRIMARY KEY,
  country               TEXT NOT NULL,
  region_name           TEXT NOT NULL,
  iso_3166_2            TEXT[] NOT NULL,
  point_basis           TEXT NOT NULL DEFAULT 'kite_spot' CHECK (point_basis IN ('kite_spot')),
  point_name            TEXT NOT NULL,
  lat                   DOUBLE PRECISION NOT NULL,
  lng                   DOUBLE PRECISION NOT NULL,
  lat10                 INTEGER NOT NULL,
  lng10                 INTEGER NOT NULL,
  air_temp_min_months   NUMERIC(4,1)[] NOT NULL,
  air_temp_max_months   NUMERIC(4,1)[] NOT NULL,
  water_temp_months     NUMERIC(4,1)[],
  uv_months             NUMERIC(3,1)[] NOT NULL,
  uv_clear_sky_months   NUMERIC(3,1)[] NOT NULL,
  sources               TEXT NOT NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (lat10, lng10) REFERENCES climate_points (lat10, lng10) ON UPDATE CASCADE,
  CONSTRAINT region_climate_stats_12_months CHECK (
    cardinality(uv_months) = 12 AND cardinality(uv_clear_sky_months) = 12
    AND cardinality(air_temp_max_months) = 12 AND cardinality(air_temp_min_months) = 12
    AND (water_temp_months IS NULL OR cardinality(water_temp_months) = 12))
);

-- Same posture as every other table: RLS on, no policies (service role only).
ALTER TABLE climate_region_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE region_climate_stats  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE climate_region_points FROM anon, authenticated;
REVOKE ALL ON TABLE region_climate_stats  FROM anon, authenticated;

INSERT INTO climate_region_points (region_key, country, region_name, iso_3166_2, spot_name, lat, lng, elevation_m) VALUES
  ('US-FL', 'United States', 'Florida', '{US-FL}', 'Grassy Key, Marathon', 24.76, -80.95, NULL),
  ('US-HI', 'United States', 'Hawaii', '{US-HI}', 'North Shore, Maui', 20.90, -156.44, NULL),
  ('US-OR', 'United States', 'Oregon', '{US-OR}', 'Floras Lake, Langlois', 42.90, -124.50, NULL),
  ('AU-WA', 'Australia', 'Western Australia', '{AU-WA}', 'Denham, Shark Bay', -25.92, 113.52, NULL),
  ('AU-SA', 'Australia', 'South Australia', '{AU-SA}', 'Troubridge Island, Yorke Peninsula', -35.12, 137.83, NULL),
  ('AU-QLD', 'Australia', 'Queensland', '{AU-QLD}', 'Haggerstone Island, Cape York', -12.04, 143.30, NULL),
  ('BR-SC', 'Brazil', 'Santa Catarina', '{BR-SC}', 'Praia de Ibiraquera', -28.13, -48.64, NULL),
  ('BR-SE', 'Brazil', 'Rio de Janeiro and São Paulo', '{BR-RJ,BR-SP}', 'Praia Rasa, Búzios', -22.76, -41.94, NULL),
  ('ES-CN', 'Spain', 'Canary Islands', '{ES-CN}', 'Corralejo, Fuerteventura', 28.74, -13.87, NULL),
  ('ES-CT', 'Spain', 'Catalonia', '{ES-CT}', 'Sant Pere Pescador, Bay of Roses', 42.15, 3.11, NULL),
  ('MX-ROO', 'Mexico', 'Quintana Roo', '{MX-ROO}', 'Isla Blanca', 21.37, -86.79, NULL),
  ('MA-NORTH', 'Morocco', 'Northern and central Morocco', '{MA-01,MA-02,MA-03,MA-04,MA-05,MA-06,MA-07,MA-08,MA-09}', 'Essaouira', 31.51, -9.76, NULL),
  ('JP-47', 'Japan', 'Okinawa', '{JP-47}', 'Miyakojima', 24.81, 125.28, NULL)
ON CONFLICT (region_key) DO NOTHING;

INSERT INTO climate_country_points (country, is_alias, spot_name, lat, lng, elevation_m) VALUES
  ('Antigua and Barbuda', false, 'Antigua', 17.09, -61.79, 0),
  ('Bahamas', false, 'Exuma Cays', 24.39, -76.63, 0),
  ('Portugal', false, 'Burgau, Algarve', 37.07, -8.77, 0),
  ('Turks and Caicos Islands', false, 'Long Bay Beach, Providenciales', 21.79, -72.15, 0),
  ('French Polynesia', false, 'Raiatea', -16.82, -151.45, 0),
  ('Saint Martin', false, 'Orient Bay', 18.09, -63.02, 0),
  ('Grenada', false, 'Carriacou', 12.48, -61.44, 0),
  ('Cook Islands', false, 'Aitutaki', -18.86, -159.79, 0),
  ('Tonga', false, 'Vava''u', -18.75, -174.07, 0),
  ('Belgium', false, 'Knokke-Heist', 51.34, 3.27, 0),
  ('Cyprus', false, 'Kiti, Larnaca', 34.82, 33.55, 0),
  ('Greenland', false, 'Kangerlussuaq', 67.01, -50.69, 0),
  ('Iceland', false, 'Snæfellsnes', 64.90, -22.82, 0),
  ('Barbados', false, 'Silver Sands', 13.05, -59.52, 0),
  ('Antarctica', false, 'Paradise Bay, Antarctic Peninsula', -64.85, -62.88, 0)
ON CONFLICT (country) DO NOTHING;
