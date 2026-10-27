// Every adapter exported from src/offers/adapters/*.ts must be in the registry (kiezdad registry-vollstaendig).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { adapters } from '../../src/offers/registry.js';
import { DEFAULT_DISCIPLINES, DISCIPLINES } from '../../src/offers/types.js';

const NOT_REGISTERED: Record<string, string> = {
  'ucpa-kitesurf-debutant-dakhla': "no general booking e-mail (phone + forms only), so KCS cannot offer an inquiry; hidden on Aaron's word 2026-10-27",
  'ucpa-kitesurf-debutant-djerba': "no general booking e-mail (phone + forms only), so KCS cannot offer an inquiry; hidden on Aaron's word 2026-10-27",
  'ucpa-kitesurf-debutant-essaouira': "no general booking e-mail (phone + forms only), so KCS cannot offer an inquiry; hidden on Aaron's word 2026-10-27",
  'ucpa-kitesurf-debutant-hurghada': "no general booking e-mail (phone + forms only), so KCS cannot offer an inquiry; hidden on Aaron's word 2026-10-27",
  'ucpa-kitesurf-safari-cape-town': "no general booking e-mail (phone + forms only), so KCS cannot offer an inquiry; hidden on Aaron's word 2026-10-27",
};

test('registry is complete and keys are unique', async () => {
  const dir = join(import.meta.dirname, '../../src/offers/adapters');
  const keys = new Set(adapters.map(a => a.key));
  assert.equal(keys.size, adapters.length, 'duplicate adapter key');
  for (const f of readdirSync(dir).filter(f => f.endsWith('.ts'))) {
    const mod = await import(pathToFileURL(join(dir, f)).href);
    for (const v of Object.values(mod)) {
      if (v && typeof v === 'object' && 'key' in v && 'fetchSlots' in v) {
        const key = (v as { key: string }).key;
        if (NOT_REGISTERED[key]) continue;
        assert.ok(keys.has(key), `adapter ${key} (${f}) is not in src/offers/registry.ts`);
      }
    }
  }
});

test('liveAvailability is only set on booking-engine adapters', () => {
  for (const a of adapters) if (a.liveAvailability) assert.equal(a.slotMethod, 'booking_engine', a.key);
  assert.ok(adapters.filter(a => a.liveAvailability).length >= 30);
});

test('disciplines are valid, unique and match snowkite / wing products', () => {
  for (const a of adapters) {
    const d = a.disciplines ?? DEFAULT_DISCIPLINES;
    assert.ok(d.length > 0, `${a.key}: empty disciplines`);
    assert.equal(new Set(d).size, d.length, `${a.key}: duplicate discipline`);
    for (const x of d) assert.ok((DISCIPLINES as readonly string[]).includes(x), `${a.key}: unknown discipline ${x}`);
    // a snowkite product is never also a water-kite product, and its name says so
    if (/snow ?kit/i.test(`${a.key} ${a.name}`)) assert.deepEqual(d, ['snowkite'], a.key);
    if (/\bwing\b|wing ?foil/i.test(a.name)) assert.ok(d.includes('wingfoil'), `${a.key}: wing product without wingfoil`);
  }
  assert.ok(adapters.filter(a => a.disciplines?.includes('snowkite')).length >= 13);
});
