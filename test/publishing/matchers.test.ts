import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appDepartures, appFacts, canonical, claimValueHash, isPublicUrl, type CardRow } from '../../src/publishing/catalog-values.js';
import { pageZones, type EvidencePage } from '../../src/publishing/evidence-page.js';
import { findDateRange, findNumber, findPhrase, findPrice, findQuote, longestSharedRun, nameVariants } from '../../src/publishing/match.js';

const page = (html: string): EvidencePage => ({ url: 'https://example.com/camp', fetchedAt: '2026-10-21T00:00:00Z', ok: true, htmlSha256: '', textSha256: '', zones: pageZones(html), linkHosts: [] });

test('canonical: sorted keys, arrays kept in order (gate parity)', () => {
  assert.equal(canonical({ b: 1, a: [2, { d: null, c: 'x' }] }), '{"a":[2,{"c":"x","d":null}],"b":1}');
  assert.match(claimValueHash('id', 'f'.repeat(64), 'type', 'camp'), /^[a-f0-9]{64}$/);
});

test('publicUrl: https only, no query or fragment', () => {
  assert.ok(isPublicUrl('https://kitesailing.ch/en/school/camps/kite-camp-egypt'));
  assert.ok(!isPublicUrl('https://www.kitesurfadventure.com.br/maranhaonatural?srsltid=x'));
  assert.ok(!isPublicUrl('http://example.com/'));
  assert.ok(!isPublicUrl('https://example.com/#packages'));
});

test('departure labels match the KCS format, past and sold-out slots dropped', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  const d = appDepartures([
    { start_date: '2026-10-24', end_date: '2026-10-31', status: 'on_request' },
    { start_date: '2026-10-31', end_date: '2026-11-07', status: 'available' },
    { start_date: '2026-12-28', end_date: '2027-01-04', status: 'limited' },
    { start_date: '2026-10-01', end_date: '2026-10-08', status: 'available' },
    { start_date: '2026-11-14', end_date: '2026-11-21', status: 'sold_out' },
  ], now);
  assert.deepEqual(d.map(x => x.label), [
    'Oct 24-31, 2026 \u2013 On request; availability unconfirmed',
    'Oct 31-Nov 7, 2026',
    'Dec 28, 2026-Jan 4, 2027 \u2013 Limited availability; confirmation required',
  ]);
});

test('appFacts: operator website with a query string is not a usable fact', () => {
  const row = { offer_id: 'o', title: 'T', summary: 'S', package_type: 'camp', country: 'Brazil', region: 'Ceará', source_url: 'https://x.com/a',
    operator_id: '00000000-0000-4000-8000-000000000000', provider_name: 'X', provider_website_url: 'https://x.com/?srsltid=1' } as unknown as CardRow;
  const f = appFacts(row, new Date());
  assert.equal(f.values.operator, undefined);
  assert.deepEqual(f.values.location, { country: 'Brazil', destination: 'Ceará, Brazil' });
});

test('matchers: prices, numeric dates, names, quotes', () => {
  const p = page('<html><head><title>Kite Camp Egypt | Swiss Kitesurf GmbH</title></head><body><p>When? 17. - 24.10 / 24. - 31.10 / 31.10 - 7.11</p>'
    + '<p>Board &amp; lodging only CHF&nbsp;950 per person. Season 7.2. &ndash; 25.4.2026. Desde 1.290 &euro;</p><p>Del 12 al 19 de abril</p></body></html>');
  assert.ok(findPrice(p, 950, 'CHF'));
  assert.ok(findPrice(p, 1290, 'EUR'));
  assert.equal(findPrice(p, 290, 'EUR'), null);
  assert.ok(findDateRange(p, '2026-10-24', '2026-10-31'));
  assert.ok(findDateRange(p, '2026-10-31', '2026-11-07'));
  assert.ok(findDateRange(p, '2027-04-12', '2027-04-19'));
  assert.equal(findDateRange(p, '2026-11-14', '2026-11-21'), null);
  assert.ok(findNumber(p, 25) && findNumber(p, 2026) && findNumber(p, 31));
  assert.ok(nameVariants('Swiss Snowkiting School (Kite Rider GmbH)').includes('Swiss Snowkiting School'));
  assert.ok(findPhrase(p, 'Swiss Kitesurf'));
  assert.ok(findQuote(p, 'board & lodging only  CHF 950'));
  assert.equal(findQuote(p, 'board and lodging only'), null);
  assert.equal(longestSharedRun('Board & lodging only CHF 950 per person here', p).words, 7);
});
