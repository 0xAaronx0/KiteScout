import pLimit from 'p-limit';
import { supabase } from '../lib/supabase.js';
import { anthropic, ANALYSIS_MODEL } from '../lib/anthropic.js';
import { withRetry } from '../lib/retry.js';

// ---------------------------------------------------------------------------
// Region-level conditions consensus.
//
// Water/wind are properties of the REGION, not the individual cruise. We gather
// the raw per-offer signal (cruise_offers.water_conditions / wind_strength) per
// (country, region), then an LLM produces a consensus — union of water types,
// range of wind — preferring provider data and falling back to its own
// knowledge of the region (with a lower confidence) when providers are silent.
// ---------------------------------------------------------------------------

const CONCURRENCY = 3;
const WATER = ['flat', 'choppy', 'waves'];
const WIND = ['light', 'medium', 'strong'];

interface OfferRow {
  country: string | null;
  region: string | null;
  water_conditions: string[] | null;
  wind_strength: string[] | null;
}

function regionKey(country: string, region: string | null): string {
  return `${country.toLowerCase().trim()}|${(region ?? '').toLowerCase().trim()}`;
}

interface Consensus {
  water: string[];
  wind: string[];
  note: string | null;
  confidence: 'high' | 'medium' | 'low';
}

async function consensus(
  country: string,
  region: string | null,
  reportedWater: string[],
  reportedWind: string[],
  sourceCount: number,
): Promise<Consensus> {
  const fallbackConf: 'medium' | 'low' = sourceCount > 1 ? 'medium' : 'low';
  const where = region ? `${country} / ${region}` : country;
  const prompt = `You determine the typical kiteboarding CONDITIONS for a region, for a kite-cruise finder.

Region: ${where}

What the cruise providers operating here actually state (may be empty):
- water mentioned: [${reportedWater.join(', ')}]
- wind mentioned: [${reportedWind.join(', ')}]
- providers that reported any conditions: ${sourceCount}

Produce a consensus. Water can be MULTIPLE values (a region has varied spots); wind is usually a RANGE. Prefer the providers' stated conditions; if they are sparse or empty, use your own knowledge of this region's typical kite conditions and LOWER the confidence accordingly.

Respond with ONLY this JSON:
{ "water_conditions": subset of ["flat","choppy","waves"],
  "wind_strength": subset of ["light","medium","strong"],
  "note": "one short traveler-facing sentence, e.g. 'Flat lagoons plus some wave spots; reliable medium-to-strong thermals.'",
  "confidence": "high" | "medium" | "low" }

Confidence: high = several providers agree or a famous, well-characterised region; medium = some signal; low = single/no provider data (your knowledge only) or providers conflict.`;

  let text: string;
  try {
    const msg = await withRetry(
      () => anthropic.messages.create({ model: ANALYSIS_MODEL, max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
      5,
      3000,
    );
    text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  } catch {
    return { water: reportedWater, wind: reportedWind, note: null, confidence: fallbackConf };
  }

  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const p = JSON.parse(json);
    const water: string[] = Array.isArray(p.water_conditions)
      ? [...new Set((p.water_conditions as unknown[]).filter((x): x is string => typeof x === 'string' && WATER.includes(x)))]
      : reportedWater;
    const wind: string[] = Array.isArray(p.wind_strength)
      ? [...new Set((p.wind_strength as unknown[]).filter((x): x is string => typeof x === 'string' && WIND.includes(x)))]
      : reportedWind;
    const confidence = ['high', 'medium', 'low'].includes(p.confidence) ? p.confidence : fallbackConf;
    return { water, wind, note: typeof p.note === 'string' ? p.note : null, confidence };
  } catch {
    return { water: reportedWater, wind: reportedWind, note: null, confidence: fallbackConf };
  }
}

export async function runRegionConditions(): Promise<{ regions: number }> {
  const { data: offers, error } = await supabase
    .from('cruise_offers')
    .select('country, region, water_conditions, wind_strength');
  if (error) throw error;
  if (!offers || offers.length === 0) {
    console.log('No cruise offers yet — run cruise-offers first.');
    return { regions: 0 };
  }

  // Group offers by (country, region); collect the union of reported conditions.
  const groups = new Map<string, { country: string; region: string | null; water: Set<string>; wind: Set<string>; sources: number }>();
  for (const o of offers as OfferRow[]) {
    if (!o.country) continue;
    const key = regionKey(o.country, o.region);
    let g = groups.get(key);
    if (!g) { g = { country: o.country, region: o.region ?? null, water: new Set(), wind: new Set(), sources: 0 }; groups.set(key, g); }
    const w = Array.isArray(o.water_conditions) ? o.water_conditions : [];
    const wi = Array.isArray(o.wind_strength) ? o.wind_strength : [];
    if (w.length > 0 || wi.length > 0) g.sources++;
    for (const x of w) g.water.add(x);
    for (const x of wi) g.wind.add(x);
  }

  console.log(`Building conditions for ${groups.size} regions…`);
  const limit = pLimit(CONCURRENCY);
  let done = 0;
  await Promise.all(
    [...groups.entries()].map(([key, g]) =>
      limit(async () => {
        const c = await consensus(g.country, g.region, [...g.water], [...g.wind], g.sources);
        const { error: upErr } = await supabase.from('region_conditions').upsert(
          {
            region_key: key,
            country: g.country,
            region: g.region,
            water_conditions: c.water,
            wind_strength: c.wind,
            note: c.note,
            confidence: c.confidence,
            source_count: g.sources,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'region_key' },
        );
        if (upErr) console.error(`\n  DB error for ${key}:`, upErr.message);
        done++;
        process.stdout.write(`\r  ${done}/${groups.size} regions`);
      }),
    ),
  );

  console.log();
  return { regions: groups.size };
}
