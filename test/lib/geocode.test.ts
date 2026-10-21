import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { geocodeSpot } from '../../src/lib/geocode.js';

// Recorded Nominatim answers (2026-10-21) where the top hit is the municipality
// boundary and the town on the coast comes second. Fetch is stubbed per query.
const fixture = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/nominatim/${f}.json`, import.meta.url), 'utf8')) as
  { query: string; hits: unknown[] };

async function withNominatim<T>(files: string[], run: () => Promise<T>): Promise<T> {
  const answers = new Map(files.map(fixture).map(f => [f.query, f.hits]));
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const q = new URL(String(url)).searchParams.get('q')!;
    return new Response(JSON.stringify(answers.get(q) ?? []), { status: 200 });
  }) as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = realFetch; }
}

test('geocodeSpot: Riohacha picks the town boundary, not the county 34 km inland', async () => {
  const g = await withNominatim(['riohacha'], () => geocodeSpot('Riohacha', 'La Guajira', 'Colombia'));
  assert.deepEqual(g, { lat: 11.5449387, lng: -72.9150522 });
});

test('geocodeSpot: Máncora picks the place=town node over the municipality boundary', async () => {
  const g = await withNominatim(['mancora'], () => geocodeSpot('Máncora', 'Piura', 'Peru'));
  assert.deepEqual(g, { lat: -4.1030531, lng: -81.0481341 });
});

test('geocodeSpot: Sidi Kaouki picks the coastal village over the commune boundary', async () => {
  const g = await withNominatim(['sidi-kaouki'], () => geocodeSpot('Sidi Kaouki', 'Marrakesh-Safi', 'Morocco'));
  assert.deepEqual(g, { lat: 31.3556693, lng: -9.7978441 });
});
