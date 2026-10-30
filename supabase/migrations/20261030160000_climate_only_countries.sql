-- ============================================================
-- Climate-only countries: temperature and UV for grey areas next to our kite regions
-- ============================================================
-- Aaron 2026-10-30: grey countries/territories get the map's climate layers, never wind:
--   Caribbean (air, water, UV), Europe except Russia and Belarus (air and UV, no water),
--   South-East Asia / Pacific except China (air, water, UV), and Northern Cyprus like the rest of Cyprus
--   (air, water, UV on Cyprus's own point).
-- One point per country in climate_country_points; `pnpm cli climate-stats` fetches the cells
-- (Copernicus) and writes country_climate_stats. Wind and (for Europe) water are left out by
-- CLIMATE_ONLY in src/pipeline/climate.ts (wind policy 'none', showsWater=false); the list there
-- and this one must match. Country names are the KCS atlas unit names (public/atlas-geography.mjs),
-- so the map colours them without aliases; Bosnia and Herzegovina and Serbia have several atlas
-- units that KCS maps onto these rows (unitClimate, KCS branch claude/climate-only-units).
-- Points: a kite or beach spot on the coast where there is one (elevation 0 = sea level), else the
-- capital with its elevation (UV and air temperature depend on it). UV with clouds needs
-- `pnpm cli climate-uv-cloudy` afterwards (CAMS); until then the cloud switch shows clear sky.
--
-- Additive only. Safe to re-run (ON CONFLICT DO NOTHING). Rollback:
--   DELETE FROM country_climate_stats  WHERE country IN (<the 38 names below>);
--   DELETE FROM climate_country_points WHERE country IN (<the 38 names below>);
-- ============================================================

INSERT INTO climate_country_points (country, is_alias, spot_name, lat, lng, elevation_m) VALUES
  -- Caribbean: air, water, UV
  ('Haiti',                        FALSE, 'Cap-Haïtien',                  19.76,  -72.20,    0),
  ('Jamaica',                      FALSE, 'Burwood Beach, Falmouth',      18.50,  -77.68,    0),
  ('Dominica',                     FALSE, 'Roseau',                       15.30,  -61.39,    0),
  ('Trinidad and Tobago',          FALSE, 'Pigeon Point, Tobago',         11.16,  -60.85,    0),
  ('Aruba',                        FALSE, 'Fisherman''s Huts',            12.58,  -70.04,    0),
  ('Curaçao',                      FALSE, 'Sint Joris Bay',               12.20,  -68.82,    0),
  ('Sint Maarten',                 FALSE, 'Simpson Bay',                  18.04,  -63.10,    0),
  ('Anguilla',                     FALSE, 'Shoal Bay',                    18.25,  -63.01,    0),
  ('Montserrat',                   FALSE, 'Little Bay',                   16.80,  -62.21,    0),
  ('Saint Kitts and Nevis',        FALSE, 'Friar''s Bay',                 17.26,  -62.68,    0),
  ('Cayman Islands',               FALSE, 'Kaibo, Grand Cayman',          19.35,  -81.18,    0),
  ('United States Virgin Islands', FALSE, 'Cramer Park, St Croix',        17.76,  -64.60,    0),
  ('Saint Barthélemy',             FALSE, 'Saint-Jean',                   17.90,  -62.84,    0),
  -- Europe except Russia and Belarus: air and UV
  ('Andorra',                      FALSE, 'Andorra la Vella',             42.51,    1.52, 1023),
  ('Bosnia and Herzegovina',       FALSE, 'Sarajevo',                     43.86,   18.41,  520),
  ('Czech Republic',               FALSE, 'Prague',                       50.08,   14.42,  235),
  ('Hungary',                      FALSE, 'Siófok, Lake Balaton',         46.91,   18.05,  105),
  ('Kosovo',                       FALSE, 'Pristina',                     42.66,   21.17,  652),
  ('Liechtenstein',                FALSE, 'Vaduz',                        47.14,    9.52,  455),
  ('Luxembourg',                   FALSE, 'Luxembourg',                   49.61,    6.13,  300),
  ('Malta',                        FALSE, 'Mellieħa Bay',                 35.98,   14.36,    0),
  ('Moldova',                      FALSE, 'Chișinău',                     47.01,   28.86,   85),
  ('Monaco',                       FALSE, 'Monaco',                       43.74,    7.42,    0),
  ('San Marino',                   FALSE, 'San Marino',                   43.94,   12.45,  650),
  ('Serbia',                       FALSE, 'Belgrade',                     44.82,   20.46,  117),
  ('Slovakia',                     FALSE, 'Bratislava',                   48.15,   17.11,  140),
  ('Vatican City',                 FALSE, 'Vatican City',                 41.90,   12.45,   40),
  -- South-East Asia / Pacific except China: air, water, UV
  ('Myanmar',                      FALSE, 'Ngapali Beach',                18.40,   94.32,    0),
  ('Laos',                         FALSE, 'Vientiane',                    17.97,  102.60,  170),
  ('Cambodia',                     FALSE, 'Kep',                          10.48,  104.30,    0),
  ('Malaysia',                     FALSE, 'Cherating',                     4.13,  103.39,    0),
  ('Brunei',                       FALSE, 'Muara Beach',                   5.03,  115.07,    0),
  ('East Timor',                   FALSE, 'Dili',                         -8.55,  125.57,    0),
  ('Singapore',                    FALSE, 'East Coast Park',               1.30,  103.91,    0),
  ('Solomon Islands',              FALSE, 'Honiara',                      -9.43,  159.95,    0),
  ('Vanuatu',                      FALSE, 'Port Vila',                   -17.74,  168.31,    0),
  ('New Caledonia',                FALSE, 'Anse Vata, Nouméa',           -22.30,  166.45,    0),
  -- Northern Cyprus: the same colours as the rest of Cyprus (Cyprus's own point, Kiti), only without wind;
  -- KCS maps the atlas unit 'Turkish Republic of Northern Cyprus' onto this row
  ('Northern Cyprus',              FALSE, 'Kiti, Larnaca',                34.82,   33.55,    0)
ON CONFLICT (country) DO NOTHING;
