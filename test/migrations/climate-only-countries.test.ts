// climate-only countries (Aaron 2026-10-30): the migration adds exactly the CLIMATE_ONLY countries, twice-safe,
// and keeps existing points (ON CONFLICT DO NOTHING).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { CLIMATE_ONLY } from '../../src/pipeline/climate.js';

const dir = new URL('../../supabase/migrations/', import.meta.url);
const file = (suffix: string) => readFileSync(new URL(readdirSync(dir).find(f => f.endsWith(suffix))!, dir), 'utf8');
const migration = file('_climate_only_countries.sql');

test('inserts exactly the CLIMATE_ONLY countries, idempotent, existing points untouched', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE climate_country_points (country TEXT PRIMARY KEY, is_alias BOOLEAN NOT NULL DEFAULT FALSE,
      spot_name TEXT NOT NULL, lat DOUBLE PRECISION NOT NULL, lng DOUBLE PRECISION NOT NULL, elevation_m INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      INSERT INTO climate_country_points (country, spot_name, lat, lng, elevation_m) VALUES ('Greece', 'Prasonisi', 35.88, 27.76, 0);`);
    await db.exec(migration);
    await db.exec(migration);
    const rows = (await db.query<{ country: string; lat: number; lng: number; elevation_m: number }>('select country, lat, lng, elevation_m from climate_country_points')).rows;
    assert.equal(rows.length, 38);
    assert.deepEqual(rows.filter(r => r.country !== 'Greece').map(r => r.country).sort(), Object.keys(CLIMATE_ONLY).sort());
    for (const r of rows) {
      assert.ok(Math.abs(r.lat) <= 60 && Math.abs(r.lng) <= 180, r.country);
      assert.ok(r.elevation_m >= 0 && r.elevation_m < 1500, r.country);
    }
    for (const gone of ['Russia', 'Belarus', 'China']) assert.equal(rows.some(r => r.country === gone), false, gone);
  } finally { await db.close(); }
});
