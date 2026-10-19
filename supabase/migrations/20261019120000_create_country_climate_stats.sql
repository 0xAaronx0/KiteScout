-- ============================================================
-- Climate per country and month (map layers next to wind_stats)
-- ============================================================
-- Two tables:
--   climate_country_points  one representative kite spot per wind_stats country
--                           (same country names incl. the is_alias rows, which share
--                           their canonical country's spot). Seeded here from
--                           docs/country_uv_stats_reference.csv (2026-10-12).
--                           Edit a row to move a country's point; the job follows.
--   country_climate_stats   one row per country with the climate of that spot;
--                           what the app should read (join on country like wind_stats).
--
-- Climate comes from the same cell cache as offer_climate_stats (climate_points,
-- 0.1-degree cells, nearest cached cell within 0.075 deg). Countries use Copernicus
-- cells only (Aaron 2026-10-19: the free Open-Meteo API is non-commercial only):
--   air_temp_max_months / air_temp_min_months  mean daily max/min 2 m, deg C
--                                    (ERA5 hourly point series via CDS, 2016-2025)
--   water_temp_months                mean SST, deg C (ERA5, nearest sea grid point);
--                                    NULL without a sea grid point within 0.25 deg
--   uv_months / uv_clear_sky_months  mean daily max UV index (CAMS global forecasts
--                                    via ADS, 40 x UV dose, 2023-2025)
-- See src/pipeline/copernicus.ts; climate_points.sources names the source of each cell.
-- All *_months arrays: 12 values, January..December.
--
-- elevation_m on climate_country_points: 0 = coastal, else the lake surface elevation
-- (Argentina, Armenia, Austria, Macedonia, Nepal, Nicaragua, Switzerland). Used as the
-- downscaling override only by the Open-Meteo fetcher; raw ERA5 has no downscaling.
--
-- Refresh: pnpm cli climate-stats (weekly GitHub Action .github/workflows/
-- climate-stats.yml) fills/updates every country; only cells not yet cached are fetched.
--
-- Safe to re-run: IF NOT EXISTS + ON CONFLICT DO NOTHING (edited points are kept).
-- ============================================================

CREATE TABLE IF NOT EXISTS climate_country_points (
  country       TEXT PRIMARY KEY,                -- exactly as in wind_stats.country
  is_alias      BOOLEAN NOT NULL DEFAULT FALSE,  -- mirrors wind_stats.is_alias
  spot_name     TEXT NOT NULL,
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  elevation_m   INTEGER,                         -- air-temp downscaling override (NULL = terrain)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS country_climate_stats (
  country               TEXT PRIMARY KEY,        -- exactly as in wind_stats.country
  is_alias              BOOLEAN NOT NULL DEFAULT FALSE,
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
  CONSTRAINT country_climate_stats_12_months CHECK (
    cardinality(uv_months) = 12 AND cardinality(uv_clear_sky_months) = 12
    AND cardinality(air_temp_max_months) = 12 AND cardinality(air_temp_min_months) = 12
    AND (water_temp_months IS NULL OR cardinality(water_temp_months) = 12))
);

-- Same posture as every other table: RLS on, no policies (service role only).
ALTER TABLE climate_country_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE country_climate_stats  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE climate_country_points FROM anon, authenticated;
REVOKE ALL ON TABLE country_climate_stats  FROM anon, authenticated;

INSERT INTO climate_country_points (country, is_alias, spot_name, lat, lng, elevation_m) VALUES
  ('Albania', false, 'Zvërnec, Vlorë', 40.49, 19.42, 0),
  ('Argentina', false, 'Dique Cuesta del Viento', -30.17, -69.08, 1530),
  ('Armenia', false, 'Lake Sevan', 40.55, 45.0, 1900),
  ('Australia', false, 'Lancelin', -31.02, 115.33, 0),
  ('Austria', false, 'Podersdorf, Neusiedler See', 47.85, 16.83, 115),
  ('Belize', false, 'Caye Caulker', 17.75, -88.03, 0),
  ('Bonaire', false, 'Atlantis Beach', 12.1, -68.29, 0),
  ('Brazil', false, 'Cumbuco', -3.63, -38.73, 0),
  ('British Virgin Islands', false, 'Trellis Bay', 18.45, -64.53, 0),
  ('Bulgaria', false, 'Shabla', 43.54, 28.59, 0),
  ('Canada', false, 'Squamish', 49.7, -123.15, 0),
  ('Cape Verde', false, 'Santa Maria, Sal', 16.6, -22.91, 0),
  ('Chile', false, 'Matanzas', -33.96, -71.87, 0),
  ('China', false, 'Pingtan', 25.5, 119.79, 0),
  ('Colombia', false, 'Cabo de la Vela', 12.2, -72.15, 0),
  ('Costa Rica', false, 'Bahía Salinas', 11.05, -85.72, 0),
  ('Croatia', false, 'Viganj', 43.0, 17.1, 0),
  ('Cuba', false, 'Varadero', 23.15, -81.25, 0),
  ('Denmark', false, 'Klitmøller', 57.04, 8.49, 0),
  ('Dominican Republic', false, 'Cabarete', 19.76, -70.41, 0),
  ('Ecuador', false, 'Santa Marianita', -0.97, -80.79, 0),
  ('Egypt', false, 'El Gouna', 27.4, 33.68, 0),
  ('El Salvador', false, 'El Cuco', 13.17, -88.11, 0),
  ('Estonia', false, 'Pärnu', 58.37, 24.5, 0),
  ('Fiji', false, 'Nadi / Namotu', -17.85, 177.19, 0),
  ('Finland', false, 'Hanko', 59.83, 22.95, 0),
  ('France', false, 'Leucate', 42.91, 3.05, 0),
  ('Germany', false, 'Fehmarn', 54.44, 11.19, 0),
  ('Greece', false, 'Pounda, Paros', 37.03, 25.11, 0),
  ('Guadeloupe', false, 'Sainte-Anne', 16.22, -61.38, 0),
  ('Guatemala', false, 'Monterrico', 13.89, -90.48, 0),
  ('Honduras', false, 'Roatán', 16.33, -86.53, 0),
  ('India', false, 'Rameswaram', 9.28, 79.31, 0),
  ('Indonesia', false, 'Sanur, Bali', -8.7, 115.26, 0),
  ('Iran', false, 'Qeshm', 26.95, 56.27, 0),
  ('Ireland', false, 'Brandon Bay', 52.27, -10.05, 0),
  ('Israel', false, 'Michmoret', 32.41, 34.87, 0),
  ('Italy', false, 'Porto Pollo, Sardinia', 41.19, 9.32, 0),
  ('Japan', false, 'Enoshima, Shonan', 35.31, 139.48, 0),
  ('Kenya', false, 'Diani', -4.32, 39.58, 0),
  ('Latvia', false, 'Jūrmala', 56.97, 23.8, 0),
  ('Lebanon', false, 'Batroun', 34.25, 35.66, 0),
  ('Lithuania', false, 'Klaipėda', 55.71, 21.1, 0),
  ('Macedonia', false, 'Lake Ohrid', 41.1, 20.8, 693),
  ('Madagascar', false, 'Sakalava Bay, Diego Suarez', -12.27, 49.38, 0),
  ('Maldives', false, 'North Malé Atoll', 4.17, 73.51, 0),
  ('Martinique', false, 'Le Vauclin', 14.55, -60.84, 0),
  ('Mauritius', false, 'Le Morne', -20.46, 57.31, 0),
  ('Mexico', false, 'La Ventana', 24.05, -109.99, 0),
  ('Montenegro', false, 'Ulcinj, Velika Plaža', 41.88, 19.33, 0),
  ('Morocco', false, 'Dakhla', 23.77, -15.94, 0),
  ('Mozambique', false, 'Tofo', -23.85, 35.55, 0),
  ('Namibia', false, 'Walvis Bay', -22.95, 14.49, 0),
  ('Nepal', false, 'Pokhara', 28.21, 83.96, 742),
  ('Netherlands', false, 'Scheveningen', 52.11, 4.27, 0),
  ('New Zealand', false, 'Takapuna, Auckland', -36.79, 174.77, 0),
  ('Nicaragua', false, 'Ometepe, Lake Nicaragua', 11.53, -85.69, 32),
  ('Norway', false, 'Lista', 58.09, 6.63, 0),
  ('Oman', false, 'Masirah', 20.67, 58.88, 0),
  ('Panama', false, 'Punta Chame', 8.65, -79.7, 0),
  ('Papua New Guinea', false, 'Port Moresby', -9.48, 147.15, 0),
  ('Peru', false, 'Máncora', -4.1, -81.05, 0),
  ('Philippines', false, 'Boracay', 11.97, 121.93, 0),
  ('Poland', false, 'Jastarnia, Hel', 54.7, 18.68, 0),
  ('Puerto Rico', false, 'Isla Verde', 18.45, -66.02, 0),
  ('Romania', false, 'Mamaia', 44.25, 28.62, 0),
  ('Russia', false, 'Anapa', 44.89, 37.32, 0),
  ('Saint Lucia', false, 'Cas en Bas', 14.08, -60.94, 0),
  ('Saint Vincent and the Grenadines', false, 'Union Island', 12.6, -61.42, 0),
  ('Senegal', false, 'Ngor, Dakar', 14.75, -17.51, 0),
  ('Slovenia', false, 'Portorož', 45.51, 13.59, 0),
  ('South Africa', false, 'Bloubergstrand, Cape Town', -33.81, 18.46, 0),
  ('South Korea', false, 'Jeju', 33.45, 126.56, 0),
  ('Spain', false, 'Tarifa', 36.01, -5.6, 0),
  ('Sri Lanka', false, 'Kalpitiya', 8.23, 79.76, 0),
  ('Sweden', false, 'Varberg', 57.1, 12.25, 0),
  ('Switzerland', false, 'Silvaplana', 46.46, 9.79, 1791),
  ('Taiwan', false, 'Penghu', 23.57, 119.58, 0),
  ('Tanzania', false, 'Paje, Zanzibar', -6.27, 39.54, 0),
  ('Thailand', false, 'Hua Hin', 12.57, 99.96, 0),
  ('Tunisia', false, 'Djerba', 33.87, 10.86, 0),
  ('Turkey', false, 'Alaçatı', 38.26, 26.38, 0),
  ('Ukraine', false, 'Odesa', 46.43, 30.76, 0),
  ('United Kingdom', false, 'Sandbanks, Poole', 50.68, -1.95, 0),
  ('United States', false, 'Outer Banks (Waves, NC)', 35.57, -75.47, 0),
  ('Venezuela', false, 'Los Roques', 11.85, -66.75, 0),
  ('Vietnam', false, 'Mui Ne', 10.95, 108.29, 0),
  ('usa', true, 'Outer Banks (Waves, NC)', 35.57, -75.47, 0),
  ('united states of america', true, 'Outer Banks (Waves, NC)', 35.57, -75.47, 0),
  ('us', true, 'Outer Banks (Waves, NC)', 35.57, -75.47, 0),
  ('uk', true, 'Sandbanks, Poole', 50.68, -1.95, 0),
  ('great britain', true, 'Sandbanks, Poole', 50.68, -1.95, 0),
  ('england', true, 'Sandbanks, Poole', 50.68, -1.95, 0),
  ('cabo verde', true, 'Santa Maria, Sal', 16.6, -22.91, 0),
  ('türkiye', true, 'Alaçatı', 38.26, 26.38, 0),
  ('grenada', true, 'Union Island', 12.6, -61.42, 0)
ON CONFLICT (country) DO NOTHING;
