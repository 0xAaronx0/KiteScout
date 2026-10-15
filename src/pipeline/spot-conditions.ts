import pLimit from 'p-limit';
import { writeFileSync, readFileSync } from 'node:fs';
import { supabase } from '../lib/supabase.js';
import { anthropic, ANALYSIS_MODEL } from '../lib/anthropic.js';
import { withRetry } from '../lib/retry.js';

// ---------------------------------------------------------------------------
// Per-spot kite conditions for stays / camps / tours (Aaron 2026-10-15).
//
// region_conditions is one row per country (fine for cruises). Packages sit at individual
// spots, so we cluster the offers' primary locations (itinerary_spots[0] with coordinates)
// into spots (same country, within CLUSTER_KM) and write one spot_conditions row per spot.
// The product app matches an offer to the nearest spot whose radius contains it.
//
//   pnpm cli spot-conditions --dry-run --out spots.json   # cluster + model, review the JSON
//   pnpm cli spot-conditions --from spots.json            # write exactly the reviewed rows
//   pnpm cli spot-conditions                              # cluster + model + write
//
// Rows written here start `source = llm_knowledge, reviewed = false` and are never
// overwritten once `reviewed = true` (a human checked them).
// ---------------------------------------------------------------------------

const CLUSTER_KM = 15;
const CONCURRENCY = 3;
const WATER = ['flat', 'choppy', 'waves'];
const WIND = ['light', 'medium', 'strong'];
const SKILL = ['beginner', 'intermediate', 'advanced'];

interface OfferRow {
  id: string;
  title: string | null;
  country: string | null;
  region: string | null;
  package_type: string | null;
  summary: string | null;
  source_text: string | null;
  itinerary_spots: Array<{ name?: string; lat?: number | null; lng?: number | null }> | null;
}

interface Point { offerId: string; title: string; country: string; region: string | null; spot: string; lat: number; lng: number; text: string }
export interface Cluster { country: string; lat: number; lng: number; radiusKm: number; points: Point[] }

export interface SpotRow {
  spot_key: string;
  country: string;
  name: string;
  region: string | null;
  lat: number;
  lng: number;
  radius_km: number;
  water_conditions: string[];
  wind_strength: string[];
  best_months: number[];
  skill_levels: string[];
  note: string | null;
  confidence: 'high' | 'medium' | 'low';
  source: 'llm_knowledge';
  offer_count: number;
}

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Leader clustering per country: a point joins the nearest cluster within `km` of its centroid, else starts one. */
export function clusterPoints(points: Point[], km = CLUSTER_KM): Cluster[] {
  const clusters: Cluster[] = [];
  const sorted = [...points].sort((a, b) => a.country.localeCompare(b.country) || a.lat - b.lat || a.lng - b.lng);
  for (const p of sorted) {
    let best: Cluster | null = null;
    let bestD = Infinity;
    for (const c of clusters) {
      if (c.country !== p.country) continue;
      const d = haversineKm(c.lat, c.lng, p.lat, p.lng);
      if (d <= km && d < bestD) { best = c; bestD = d; }
    }
    if (best) {
      best.points.push(p);
      best.lat = best.points.reduce((s, x) => s + x.lat, 0) / best.points.length;
      best.lng = best.points.reduce((s, x) => s + x.lng, 0) / best.points.length;
    } else {
      clusters.push({ country: p.country, lat: p.lat, lng: p.lng, radiusKm: km, points: [p] });
    }
  }
  for (const c of clusters) {
    const far = Math.max(...c.points.map(p => haversineKm(c.lat, c.lng, p.lat, p.lng)));
    c.radiusKm = Math.max(10, Math.ceil(far + 3));
  }
  return clusters;
}

const slug = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const CONDITION_WORDS = /\b(wind|windy|gust|thermal|trade|levante|poniente|meltemi|mistral|flat|lagoon|shallow|wave|waves|swell|choppy|chop|beginner|advanced|intermediate|season|knots|reef|tide)\b/i;

function conditionSnippets(text: string, max = 700): string {
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter(s => CONDITION_WORDS.test(s));
  return sentences.join(' ').slice(0, max);
}

async function loadPoints(): Promise<Point[]> {
  const { data, error } = await supabase
    .from('package_offers')
    .select('id,title,country,region,package_type,summary,source_text,itinerary_spots')
    .eq('is_active', true)
    .limit(5000);
  if (error) throw error;
  const out: Point[] = [];
  for (const o of (data ?? []) as OfferRow[]) {
    const s = (o.itinerary_spots ?? []).find(x => typeof x.lat === 'number' && typeof x.lng === 'number');
    if (!s || !o.country) continue;
    out.push({
      offerId: o.id, title: o.title ?? '', country: o.country, region: o.region,
      spot: s.name ?? '', lat: s.lat as number, lng: s.lng as number,
      text: conditionSnippets(`${o.summary ?? ''} ${o.source_text ?? ''}`),
    });
  }
  return out;
}

async function describe(c: Cluster): Promise<SpotRow | null> {
  const spots = [...new Set(c.points.map(p => p.spot).filter(Boolean))];
  const regions = [...new Set(c.points.map(p => p.region).filter(Boolean))] as string[];
  const evidence = c.points.map(p => p.text).filter(Boolean).slice(0, 4).join('\n- ');
  const prompt = `You describe ONE specific kitesurfing spot for a kite-travel finder (stays, camps, tours sit at this spot).

Country: ${c.country}
Spot centre: ${c.lat.toFixed(3)}, ${c.lng.toFixed(3)} (offers within ~${c.radiusKm} km)
Place names used by the offers here: ${spots.join('; ') || '(none)'}
Regions used by the offers: ${regions.join('; ') || '(none)'}
Offer titles: ${c.points.map(p => p.title).slice(0, 6).join('; ')}

Statements from the providers' own pages about wind, water and level (may be empty):
- ${evidence || '(none)'}

Describe the conditions of THIS spot only, not the country. Prefer the providers' statements; otherwise use your knowledge of the spot and set confidence low or medium. If you do not know the spot, say so with confidence "low" and keep the note generic to the coast it is on. Never mention other regions of the country.

Respond with ONLY this JSON:
{ "name": "the well-known kite spot or area name, e.g. Tarifa",
  "water_conditions": subset of ["flat","choppy","waves"],
  "wind_strength": subset of ["light","medium","strong"],
  "best_months": array of month numbers 1-12 with the most reliable wind,
  "skill_levels": subset of ["beginner","intermediate","advanced"] the spot suits,
  "note": "ONE traveler-facing sentence of at most 28 words: the typical wind (e.g. Levante/Poniente, thermals, trade winds), the water type and what it suits. No superlatives, no 'ideal', plain English",
  "confidence": "high" | "medium" | "low" }

Confidence: high = provider statements agree and it is a well-known spot; medium = some signal or well-known spot; low = no signal and not well known.`;
  let text = '';
  try {
    const msg = await withRetry(
      () => anthropic.messages.create({ model: ANALYSIS_MODEL, max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
      5,
      3000,
    );
    text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  } catch (e) {
    console.error(`  model call failed for ${c.country} ${c.lat.toFixed(2)},${c.lng.toFixed(2)}: ${(e as Error).message}`);
    return null;
  }
  try {
    const p = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
    const pick = (v: unknown, allowed: string[]) => Array.isArray(v) ? [...new Set((v as unknown[]).filter((x): x is string => typeof x === 'string' && allowed.includes(x)))] : [];
    const months = Array.isArray(p.best_months)
      ? [...new Set((p.best_months as unknown[]).filter((m): m is number => Number.isInteger(m) && (m as number) >= 1 && (m as number) <= 12))].sort((a, b) => a - b)
      : [];
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : spots[0] ?? c.country;
    return {
      spot_key: `${slug(c.country)}/${slug(name)}`,
      country: c.country,
      name,
      region: regions[0] ?? null,
      lat: Math.round(c.lat * 10000) / 10000,
      lng: Math.round(c.lng * 10000) / 10000,
      radius_km: c.radiusKm,
      water_conditions: pick(p.water_conditions, WATER),
      wind_strength: pick(p.wind_strength, WIND),
      best_months: months,
      skill_levels: pick(p.skill_levels, SKILL),
      note: typeof p.note === 'string' ? p.note.trim() : null,
      // Model-written rows are never "high": that is reserved for a human-reviewed row (set by hand in the table).
      confidence: p.confidence === 'low' ? 'low' : p.confidence === 'medium' || p.confidence === 'high' ? 'medium' : 'low',
      source: 'llm_knowledge',
      offer_count: c.points.length,
    };
  } catch {
    console.error(`  unparseable model output for ${c.country} ${c.lat.toFixed(2)},${c.lng.toFixed(2)}`);
    return null;
  }
}

/** Two clusters can resolve to the same name; keep the keys unique (merge is a human call). */
export function uniqueKeys(rows: SpotRow[]): SpotRow[] {
  const seen = new Map<string, number>();
  return rows.map(r => {
    const n = (seen.get(r.spot_key) ?? 0) + 1;
    seen.set(r.spot_key, n);
    return n === 1 ? r : { ...r, spot_key: `${r.spot_key}-${n}` };
  });
}

async function writeRows(rows: SpotRow[]): Promise<{ written: number; keptReviewed: number }> {
  const { data: existing, error } = await supabase.from('spot_conditions').select('spot_key,reviewed');
  if (error) throw error;
  const reviewed = new Set((existing ?? []).filter(r => r.reviewed).map(r => r.spot_key as string));
  const todo = rows.filter(r => !reviewed.has(r.spot_key));
  for (let i = 0; i < todo.length; i += 50) {
    const { error: upErr } = await supabase
      .from('spot_conditions')
      .upsert(todo.slice(i, i + 50).map(r => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: 'spot_key' });
    if (upErr) throw new Error(`spot_conditions upsert failed: ${upErr.message}`);
  }
  return { written: todo.length, keptReviewed: rows.length - todo.length };
}

export async function runSpotConditions(opts: { dryRun?: boolean; out?: string; from?: string }): Promise<void> {
  if (opts.from) {
    const rows = JSON.parse(readFileSync(opts.from, 'utf8')) as SpotRow[];
    const r = await writeRows(rows);
    console.log(`Wrote ${r.written} spot rows (${r.keptReviewed} kept: already reviewed).`);
    return;
  }
  const points = await loadPoints();
  const clusters = clusterPoints(points);
  console.log(`${points.length} offers with a located spot -> ${clusters.length} spot clusters (${CLUSTER_KM} km) in ${new Set(clusters.map(c => c.country)).size} countries`);
  const limit = pLimit(CONCURRENCY);
  const rows = (await Promise.all(clusters.map(c => limit(() => describe(c))))).filter((r): r is SpotRow => r !== null);
  const unique = uniqueKeys(rows);
  if (opts.out) { writeFileSync(opts.out, JSON.stringify(unique, null, 1)); console.log(`Wrote ${unique.length} rows for review to ${opts.out}`); }
  if (opts.dryRun) return;
  const r = await writeRows(unique);
  console.log(`Wrote ${r.written} spot rows (${r.keptReviewed} kept: already reviewed).`);
}
