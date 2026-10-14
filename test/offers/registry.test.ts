// Every adapter exported from src/offers/adapters/*.ts must be in the registry (kiezdad registry-vollstaendig).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { adapters } from '../../src/offers/registry.js';

const NOT_REGISTERED: Record<string, string> = {};

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
