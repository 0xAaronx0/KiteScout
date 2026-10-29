// ---------------------------------------------------------------------------
// Wetsuit recommendation for kitesurfing per spot and month (Aaron 2026-10-29: map climate panel info).
// Research, sources and the reasoning behind every threshold: docs/wetsuit-recommendations.md.
// data/wetsuit-recommendations.json mirrors the constants below (a test keeps them identical).
//
// Rule, in order:
//   1. Base level from the water temperature band (manufacturer surf charts, O'Neill / Rip Curl / Mystic).
//   2. Air step: +1 level when the mean daily max air temperature is below the base band's lower water bound
//      + AIR_MARGIN_C. A kiter rides out of the water in >= 12 kn by definition, so wind chill on wet skin makes
//      the daytime air count, not only the water.
//   3. Wind step: +1 level when the mean wind on kiteable days is >= STRONG_WIND_KN. No spot-month wind speed
//      exists in our data yet (only the share of kiteable days), so callers pass null and the step stays 0.
//   4. Accessories from the water temperature; air below COLD_AIR_C makes gloves and hood recommended.
// There is no "thinner" step: "cold water, warm air" can allow a thinner suit (Evolve, MACkite), but our spots are
// windy by definition and we cannot tell calm days, so the rule only ever adds warmth.
// ---------------------------------------------------------------------------

export type WetsuitLevel = 'lycra' | 'shorty' | 'three_quarter' | 'full_3_2' | 'full_4_3' | 'full_5_4' | 'full_6_5';
export type AccessoryNeed = 'no' | 'optional' | 'recommended';

/** warm to cold; waterMinC = inclusive lower bound of the band, null = no lower bound (coldest level) */
export const WETSUIT_LEVELS: readonly { level: WetsuitLevel; label: string; waterMinC: number | null }[] = [
  { level: 'lycra', label: 'Boardshorts or bikini + Lycra', waterMinC: 25 },
  { level: 'shorty', label: 'Shorty or springsuit (1-2 mm)', waterMinC: 22 },
  { level: 'three_quarter', label: '3/4 suit: short-arm full or long john (2 mm)', waterMinC: 19 },
  { level: 'full_3_2', label: 'Full suit 3/2', waterMinC: 16 },
  { level: 'full_4_3', label: 'Full suit 4/3', waterMinC: 12 },
  { level: 'full_5_4', label: 'Full suit 5/4', waterMinC: 8 },
  { level: 'full_6_5', label: 'Full suit 6/5, hooded', waterMinC: null },
];

/** daytime air must be this much warmer than the band's lower water bound, else one level warmer */
export const AIR_MARGIN_C = 3;
/** mean wind on kiteable days at or above this adds one level (needs data we do not have yet) */
export const STRONG_WIND_KN = 20;
/** mean daily max air below this: gloves and hood recommended whatever the water */
export const COLD_AIR_C = 10;
/** water temperature thresholds, exclusive: below recommendedBelowC = recommended, below optionalBelowC = optional */
export const ACCESSORY_RULES: Readonly<Record<'boots' | 'gloves' | 'hood', { recommendedBelowC: number; optionalBelowC: number }>> = {
  boots: { recommendedBelowC: 12, optionalBelowC: 15 },
  gloves: { recommendedBelowC: 9, optionalBelowC: 12 },
  hood: { recommendedBelowC: 10, optionalBelowC: 13 },
};

export interface WetsuitInput {
  /** mean sea surface temperature of the month, deg C */
  waterC: number | null | undefined;
  /** mean daily max air temperature of the month, deg C (kiting is a daytime sport) */
  airMaxC: number | null | undefined;
  /** mean 10 m wind on kiteable days, knots; null = unknown (no wind step) */
  windKn?: number | null;
}

export interface WetsuitAdvice {
  level: WetsuitLevel;
  label: string;
  /** level from the water band alone */
  baseLevel: WetsuitLevel;
  airStep: 0 | 1;
  windStep: 0 | 1;
  /** whether a wind speed was available; 'no_data' = the wind step could not be applied */
  wind: 'used' | 'no_data';
  boots: AccessoryNeed;
  gloves: AccessoryNeed;
  hood: AccessoryNeed;
}

const fin = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

function baseIndex(waterC: number): number {
  const i = WETSUIT_LEVELS.findIndex(l => l.waterMinC === null || waterC >= l.waterMinC);
  return i === -1 ? WETSUIT_LEVELS.length - 1 : i;
}

function need(waterC: number, rule: { recommendedBelowC: number; optionalBelowC: number }): AccessoryNeed {
  return waterC < rule.recommendedBelowC ? 'recommended' : waterC < rule.optionalBelowC ? 'optional' : 'no';
}

/** recommendation for one spot-month; null without a water temperature (no sea cell) */
export function wetsuitFor({ waterC, airMaxC, windKn = null }: WetsuitInput): WetsuitAdvice | null {
  if (!fin(waterC)) return null;
  const base = baseIndex(waterC);
  const floor = WETSUIT_LEVELS[base].waterMinC;
  const airStep: 0 | 1 = fin(airMaxC) && floor !== null && airMaxC < floor + AIR_MARGIN_C ? 1 : 0;
  const windStep: 0 | 1 = fin(windKn) && windKn >= STRONG_WIND_KN ? 1 : 0;
  const { level, label } = WETSUIT_LEVELS[Math.min(base + airStep + windStep, WETSUIT_LEVELS.length - 1)];
  const coldAir = fin(airMaxC) && airMaxC < COLD_AIR_C;
  return {
    level, label, baseLevel: WETSUIT_LEVELS[base].level, airStep, windStep, wind: fin(windKn) ? 'used' : 'no_data',
    boots: need(waterC, ACCESSORY_RULES.boots),
    gloves: coldAir ? 'recommended' : need(waterC, ACCESSORY_RULES.gloves),
    hood: coldAir ? 'recommended' : need(waterC, ACCESSORY_RULES.hood),
  };
}
