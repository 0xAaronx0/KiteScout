// Aaron 2026-10-31: a cruise's duration_days = nights + 1 (a Saturday-to-Saturday week = 8 days).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DURATION_RULE, NIGHTS_RULE, cleanNights, proposeTripDuration, sameTripDuration } from '../../src/pipeline/trip-duration.js';

// extract-cruise-offers.ts needs API keys at import time, so its wiring is checked in the source text.
const extractor = readFileSync(new URL('../../src/pipeline/extract-cruise-offers.ts', import.meta.url), 'utf8');

test('the extraction prompt states the nights + 1 rule for duration_days', () => {
  assert.ok(extractor.includes('"duration_days": integer or null (${DURATION_RULE}),'));
  // Aaron 2026-10-31: nights are the stored fact; the extraction asks for them and derives days only as a fallback.
  assert.ok(extractor.includes('"duration_nights": integer or null (${NIGHTS_RULE}),'));
  assert.ok(extractor.includes('duration_nights: cleanNights(offer.duration_nights),'));
  assert.match(NIGHTS_RULE, /Saturday-to-Saturday week or 'one week' = 7/);
  assert.match(DURATION_RULE, /^trip length in days = nights \+ 1: '7 nights', 'Saturday to Saturday', 'one week' or a price per week = 8; '7 days \/ 6 nights' = 7/);
});

test('the full re-extraction diff treats ±1 day as the nights-vs-days ambiguity, not a change', () => {
  assert.equal(sameTripDuration(8, 7), true);
  assert.equal(sameTripDuration(7, 8), true);
  assert.equal(sameTripDuration(8, 10), false);
  assert.equal(sameTripDuration(null, 8), false);
  assert.equal(sameTripDuration(null, null), true);
  assert.match(extractor, /if \(f === 'duration_days' && sameTripDuration\(before\.duration_days, after\.duration_days\)\) continue;/);
});

test('cleanNights keeps 0..60 integers (digit strings too) and drops everything else', () => {
  assert.deepEqual([7, '7', 0, 60].map(cleanNights), [7, 7, 0, 60]);
  assert.deepEqual([-1, 61, 7.5, 'seven', null, undefined, '7 nights'].map(cleanNights), [null, null, null, null, null, null, null]);
});

test('audit proposal: departure spans first, then days/nights pairs, nights, week wording', () => {
  const dep = (start: string, end: string) => ({ start_date: start, end_date: end });
  assert.deepEqual(proposeTripDuration({ durationDays: 7, texts: ['7-Day Red Sea'],
    dates: [dep('2026-09-19', '2026-09-26'), dep('2026-10-03', '2026-10-10'), dep('2026-10-17', '2026-10-26')] }),
    { days: 8, nights: 7, basis: 'departures', note: '3 departure(s), mostly 7 nights' });
  assert.equal(proposeTripDuration({ durationDays: 7, dates: [dep('2026-05-02', '2026-05-08')], texts: [] }).days, 7);
  assert.equal(proposeTripDuration({ durationDays: 7, dates: null, texts: ['Duration 1 week (7 days / 6 nights)'] }).days, 7);
  assert.equal(proposeTripDuration({ durationDays: 7, dates: null, texts: ['Kite Safari Itinerary - 8 Days / 7 Nights, Saturday to Saturday'] }).days, 8);
  assert.equal(proposeTripDuration({ durationDays: 7, dates: null, texts: ['a 7-night private, all-inclusive sailing holiday'] }).days, 8);
  assert.deepEqual(proposeTripDuration({ durationDays: 7, dates: null, texts: [null, '1 Week all inclusive prices start from 25,000$'] }),
    { days: 8, nights: 7, basis: 'week', note: 'week wording, nights not stated (week rule: 7 nights)' });
  assert.equal(proposeTripDuration({ durationDays: 7, dates: null, texts: ['Und rund 1 Woche vor dem Trip starten wir die Gruppe'] }).days, null);
  assert.deepEqual(proposeTripDuration({ durationDays: 7, dates: [], texts: ['Sail for 7 days in the Cyclades'] }),
    { days: null, nights: null, basis: 'none', note: 'no nights in the stored data' });
});
