// writeSamples on a manifest without real failures (e.g. a pilot subset where every offer verified):
// the KCS reproduction reads eight named sample files, so each failure case falls back to a synthetic one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REQUIRED_FIELDS } from '../../src/publishing/catalog-values.js';
import type { Manifest } from '../../src/publishing/manifest.js';
import { writeSamples } from '../../src/publishing/samples.js';

const V1 = join(import.meta.dirname, '../../publishing/manifest/v1');
const FIRST = 'f14b748cb041032eaa751100204545d624be777f4f236afbac596bfab051b27a';

test('samples: a manifest of healthy entries only still yields all eight sample files', () => {
  const m = JSON.parse(readFileSync(join(V1, `${FIRST}.json`), 'utf8')) as Manifest;
  const side = JSON.parse(readFileSync(join(V1, m.evidence), 'utf8')) as { offers: Array<{ offerId: string }> };
  const healthy = m.entries.filter(e => e.status === 'active' && e.snapshot.complete && e.rights.status === 'permitted'
    && REQUIRED_FIELDS.every(f => e.claims.some(c => c.field === f)));
  assert.ok(healthy.length >= 1);
  const keep = new Set(healthy.map(e => e.offerId));
  const dir = mkdtempSync(join(tmpdir(), 'geo-samples-'));
  writeFileSync(join(dir, `${FIRST}.json`), JSON.stringify({ ...m, entries: healthy }));
  writeFileSync(join(dir, m.evidence), JSON.stringify({ ...side, offers: side.offers.filter(o => keep.has(o.offerId)) }));
  writeFileSync(join(dir, 'latest.json'), JSON.stringify({ path: `${FIRST}.json` }));

  const out = join(dir, 'samples');
  writeSamples(dir, out);
  assert.deepEqual(readdirSync(out).sort(), ['absent-required-claim.json', 'healthy.json', 'partial-source-failure.json', 'removed-offer.json',
    'revoked-rights.json', 'stale-optional-fact.json', 'stale-revision.json', 'unknown-price-dates.json']);
  const absent = JSON.parse(readFileSync(join(out, 'absent-required-claim.json'), 'utf8')) as { cases: Array<{ synthetic: boolean; evidence: Manifest['entries'][number]; expect: { status: string; diagnostics: Array<{ field: string; code: string }> } }> };
  assert.equal(absent.cases.length, 1);
  const [c] = absent.cases;
  assert.equal(c.synthetic, true);
  assert.ok(!c.evidence.claims.some(x => x.field === 'description'));
  assert.equal(c.expect.status, 'held');
  assert.ok(c.expect.diagnostics.some(d => d.field === 'description' && d.code === 'missing_evidence'));
});
