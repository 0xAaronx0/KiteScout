// wetsuit recommendation per spot-month (Aaron 2026-10-29): water band + air step + (future) wind step
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACCESSORY_RULES, AIR_MARGIN_C, COLD_AIR_C, STRONG_WIND_KN, WETSUIT_LEVELS, wetsuitFor,
} from '../../src/lib/wetsuit.js';

test('water bands: inclusive lower bounds, warm to cold', () => {
  const at = (waterC: number) => wetsuitFor({ waterC, airMaxC: 40 })!.level;
  assert.equal(at(29), 'lycra');
  assert.equal(at(25), 'lycra');
  assert.equal(at(24.9), 'shorty');
  assert.equal(at(22), 'shorty');
  assert.equal(at(19), 'three_quarter');
  assert.equal(at(18.9), 'full_3_2');
  assert.equal(at(12), 'full_4_3');
  assert.equal(at(8), 'full_5_4');
  assert.equal(at(7.9), 'full_6_5');
  assert.equal(at(-1), 'full_6_5');
});

test('air step: daytime air below band floor + margin adds one level, never more', () => {
  // Hurghada January (live: water 22.4, air max 21.4): shorty band, cool air -> 3/4 suit
  assert.deepEqual(pick(wetsuitFor({ waterC: 22.4, airMaxC: 21.4 })), ['three_quarter', 'shorty', 1]);
  // exactly floor + margin passes
  assert.equal(wetsuitFor({ waterC: 25.5, airMaxC: 25 + AIR_MARGIN_C })!.level, 'lycra');
  assert.equal(wetsuitFor({ waterC: 25.5, airMaxC: 25 + AIR_MARGIN_C - 0.1 })!.level, 'shorty');
  // very cold air still only one step
  assert.equal(wetsuitFor({ waterC: 20, airMaxC: 0 })!.level, 'full_3_2');
  // coldest level has no floor and stays capped
  assert.equal(wetsuitFor({ waterC: 5, airMaxC: -10 })!.level, 'full_6_5');
  // unknown air: no step
  assert.equal(wetsuitFor({ waterC: 22.4, airMaxC: null })!.airStep, 0);
});

test('wind step only with a wind speed; reported as no_data otherwise', () => {
  const none = wetsuitFor({ waterC: 26, airMaxC: 30 })!;
  assert.equal(none.wind, 'no_data'); assert.equal(none.windStep, 0); assert.equal(none.level, 'lycra');
  const calm = wetsuitFor({ waterC: 26, airMaxC: 30, windKn: STRONG_WIND_KN - 1 })!;
  assert.equal(calm.wind, 'used'); assert.equal(calm.level, 'lycra');
  assert.equal(wetsuitFor({ waterC: 26, airMaxC: 30, windKn: STRONG_WIND_KN })!.level, 'shorty');
  // air + wind: two steps, capped at the coldest level
  assert.equal(wetsuitFor({ waterC: 22.4, airMaxC: 21.4, windKn: 25 })!.level, 'full_3_2');
  assert.equal(wetsuitFor({ waterC: 9, airMaxC: 5, windKn: 25 })!.level, 'full_6_5');
});

test('accessories from water, cold air forces gloves and hood', () => {
  const warm = wetsuitFor({ waterC: 18, airMaxC: 25 })!;
  assert.deepEqual([warm.boots, warm.gloves, warm.hood], ['no', 'no', 'no']);
  const mid = wetsuitFor({ waterC: 13, airMaxC: 18 })!;
  assert.deepEqual([mid.boots, mid.gloves, mid.hood], ['optional', 'no', 'no']);
  const cool = wetsuitFor({ waterC: 11, airMaxC: 15 })!;
  assert.deepEqual([cool.boots, cool.gloves, cool.hood], ['recommended', 'optional', 'optional']);
  const cold = wetsuitFor({ waterC: 7, airMaxC: 12 })!;
  assert.deepEqual([cold.boots, cold.gloves, cold.hood], ['recommended', 'recommended', 'recommended']);
  const coldAir = wetsuitFor({ waterC: 13, airMaxC: COLD_AIR_C - 1 })!;
  assert.deepEqual([coldAir.boots, coldAir.gloves, coldAir.hood], ['optional', 'recommended', 'recommended']);
});

test('no water temperature (no sea cell): no recommendation', () => {
  assert.equal(wetsuitFor({ waterC: null, airMaxC: 30 }), null);
  assert.equal(wetsuitFor({ waterC: Number.NaN, airMaxC: 30 }), null);
});

test('data/wetsuit-recommendations.json mirrors the code constants', () => {
  const json = JSON.parse(readFileSync(new URL('../../data/wetsuit-recommendations.json', import.meta.url), 'utf8'));
  assert.deepEqual(json.levels, WETSUIT_LEVELS);
  assert.equal(json.airMarginC, AIR_MARGIN_C);
  assert.equal(json.strongWindKn, STRONG_WIND_KN);
  assert.equal(json.coldAirC, COLD_AIR_C);
  assert.deepEqual(json.accessories, ACCESSORY_RULES);
});

function pick(a: ReturnType<typeof wetsuitFor>) {
  return [a!.level, a!.baseLevel, a!.airStep];
}
