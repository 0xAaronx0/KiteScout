// `pnpm cli season-extract region [--out <dir>] [--plan <season-plan.json>]`
//
// Kite season from the spot's climate for offers whose page states none (Aaron 2026-10-28, KCS #511: the map
// toggle "Hide out-of-season listings" is OFF by default, so "lieber eins zu viel als eins zu wenig"
// ausblenden: no German North/Baltic Sea listings in January, no South Africa in July/August).
//
// Thresholds set by Aaron 2026-10-28 ("lufttemp >= 14 grad, >=40% windige tage").
// Rule per month: in season when the spot's mean daily air maximum is at least AIR_MIN_C AND the share of windy
// days is at least WIND_MIN_PCT (a month without wind data does not veto). Air: offer_climate_stats (the offer's
// own climate point). Wind: country_climate_stats.wind_months (what the app shows). Where the country has Bstoked
// data, a month filled from ERA5 is a Bstoked placeholder month, i.e. Bstoked counts below 40 % windy days
// (memory bstoked-wind-data), so it is out of season; ERA5 values (other metric: share of kiteable days, weak fit
// to Bstoked) are used as they are only where the country has no Bstoked month at all. Region rows (ERA5 only)
// replace the country only then; elsewhere their differing result is reported for review (Sicily's ERA5 misses
// the summer thermals, 2026-10-28).
//
// The output is a season-extract plan (same PlanRow format), so `season-extract apply` writes it with the usual
// guards: unknown offers get the climate season (basis region_inferred) or the page's own wind window
// (page_wind, camps/stays whose page names one); stays and camps with an explicit page season that reaches into
// clearly bad months get page ∩ climate (page_region, via `apply --update`). Cruises and tours keep their own
// stated or dated seasons; snowkite offers are left alone (their snow season does not follow this rule).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contiguousRange, monthsLabel, type OfferType, type PlanRow } from './season-extract.js';

export const AIR_MIN_C = 14;
export const WIND_MIN_PCT = 40;
export const REGION_MAX_KM = 800;

/**
 * Fixed seasons Aaron set per region; they replace the climate rule (and a page's wind window) there.
 * 2026-10-28: "bitte April - Oktober für nord- und ostsee" (all our offers in these countries are on the coasts).
 */
export const REGION_OVERRIDES: Array<{ label: string; countries: string[]; months: number[] }> = [
  { label: 'Vorgabe Nord- und Ostsee', countries: ['germany', 'denmark', 'poland', 'netherlands', 'belgium', 'sweden'], months: [4, 5, 6, 7, 8, 9, 10] },
];

export function regionOverride(country: string | null): { label: string; months: number[] } | null {
  const c = (country ?? '').toLowerCase();
  return REGION_OVERRIDES.find(o => o.countries.includes(c)) ?? null;
}

/**
 * Months in season by the climate rule; null when the spot has no temperature or no wind data at all (Aaron
 * 2026-10-28: such spots are exempt from the rule and flagged for him). A single month without a wind value
 * (e.g. winter months where the wind is not recorded because the water is too cold) does not veto.
 */
export function climateSeason(air: (number | null)[] | null | undefined, wind: (number | null)[] | null | undefined): number[] | null {
  if (!air || air.length !== 12 || air.every(v => v == null)) return null;
  if (!wind || wind.length !== 12 || wind.every(v => v == null)) return null;
  const out: number[] = [];
  for (let m = 1; m <= 12; m += 1) {
    const a = air[m - 1], w = wind?.[m - 1];
    if (a == null || a < AIR_MIN_C) continue;
    if (w != null && w < WIND_MIN_PCT) continue;
    out.push(m);
  }
  return out;
}

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export type WindSource = { key: string; wind: (number | null)[] | null; alt?: { key: string; wind: (number | null)[] | null } };
type ClimateRow = { wind_months: (number | null)[] | null; wind_source_months?: (string | null)[] | null };
type Region = ClimateRow & { region_key: string; country: string; lat: number; lng: number };

/**
 * Wind on the Bstoked scale: a row with Bstoked months keeps those and turns its ERA5-filled months into 0 (Bstoked
 * placeholder = below 40 %); a row without any Bstoked month (ERA5 only) is returned as it is.
 */
export function bstokedScale(row: ClimateRow | null | undefined): (number | null)[] | null {
  if (!row?.wind_months) return null;
  const src = row.wind_source_months ?? [];
  if (!src.includes('bstoked')) return row.wind_months;
  return row.wind_months.map((v, i) => (src[i] === 'era5' ? 0 : v));
}

/** Country wind when it has Bstoked data; otherwise the nearest region of the same country (<= REGION_MAX_KM). */
export function pickWind(country: string | null, lat: number, lng: number, regions: Region[], countries: Map<string, ClimateRow>): WindSource | null {
  const c = (country ?? '').toLowerCase();
  const near = regions
    .filter(r => r.country.toLowerCase() === c && r.wind_months)
    .map(r => ({ r, d: distanceKm(lat, lng, r.lat, r.lng) }))
    .filter(x => x.d <= REGION_MAX_KM)
    .sort((a, b) => a.d - b.d)[0];
  const row = countries.get(c);
  const regionSrc = near ? { key: `region ${near.r.region_key} (ERA5)`, wind: near.r.wind_months } : null;
  if (row?.wind_months && (row.wind_source_months ?? []).includes('bstoked')) {
    return { key: `country ${country}`, wind: bstokedScale(row), ...(regionSrc ? { alt: regionSrc } : {}) };
  }
  if (regionSrc) return regionSrc;
  return row?.wind_months ? { key: `country ${country} (ERA5)`, wind: row.wind_months } : null;
}

const sortNum = (m: number[]) => [...new Set(m)].sort((a, b) => a - b);

/**
 * Storm seasons (Aaron 2026-10-28: Caribbean kite cruises don't run in the hurricane season; "wo immer wir nicht
 * irgendwelche Angebote finden, die explizit dieser Regel widersprechen, bitte diese Regeln umsetzen"). Peak months
 * only. They cut climate-derived seasons (region_inferred, page_region), never a page season or dated trips; a
 * storm month that an explicit offer in the same zone and country runs in stays (see stormContradictions).
 */
export const STORM_ZONES: Array<{ label: string; months: number[]; inZone: (country: string, lat: number | null, lng: number | null) => boolean }> = [
  {
    label: 'Atlantik-Hurrikan', months: [8, 9, 10],
    inZone: (c, lat, lng) => ['antigua and barbuda', 'bahamas', 'british virgin islands', 'us virgin islands', 'grenada', 'saint vincent and the grenadines',
      'saint martin', 'sint maarten', 'turks and caicos islands', 'dominican republic', 'puerto rico', 'barbados', 'cuba', 'jamaica', 'martinique',
      'guadeloupe', 'saint lucia', 'dominica', 'cayman islands', 'belize', 'honduras', 'haiti', 'anguilla', 'saint kitts and nevis', 'bermuda'].includes(c)
      || (c === 'mexico' && lng != null && lng > -92)
      || (c === 'united states' && lat != null && lng != null && lng > -100 && lat < 37),
  },
  { label: 'Ostpazifik-Hurrikan', months: [8, 9, 10], inZone: (c, _lat, lng) => c === 'mexico' && lng != null && lng <= -100 },
  {
    label: 'Taifun', months: [8, 9, 10],
    inZone: (c, lat) => ['philippines', 'taiwan', 'hong kong', 'south korea'].includes(c) || (c === 'japan' && lat != null && lat < 36) || (c === 'china' && lat != null && lat < 30),
  },
  {
    label: 'Zyklon Süd', months: [1, 2, 3],
    inZone: (c, lat) => ['fiji', 'tonga', 'vanuatu', 'new caledonia', 'french polynesia', 'cook islands', 'samoa', 'madagascar', 'mauritius', 'reunion', 'mozambique'].includes(c)
      || (c === 'australia' && lat != null && lat > -26),
  },
];

export function stormZone(country: string | null, lat: number | null, lng: number | null) {
  const c = (country ?? '').toLowerCase();
  return STORM_ZONES.find(z => z.inZone(c, lat, lng)) ?? null;
}

/** Remove the zone's storm months unless an explicit offer contradicts them; never cut a season to nothing. */
export function stormCut(months: number[], storm: number[], contradicted: Set<number>): number[] {
  const cut = months.filter(m => !(storm.includes(m) && !contradicted.has(m)));
  return cut.length ? cut : months;
}

export const CONTRA_MAX_KM = 300;
export const TRIP_MAX_DAYS = 45;

/**
 * Months touched by trip-like dated slots (at most TRIP_MAX_DAYS long, past or future, not unavailable). A long
 * availability window ("May 2027 - Dec 2028") says nothing about the storm months (Aaron 2026-10-28).
 */
export function tripMonths(dates: unknown): number[] {
  if (!Array.isArray(dates)) return [];
  const out = new Set<number>();
  for (const slot of dates) {
    const { start_date: a, end_date: b, status } = (slot ?? {}) as Record<string, unknown>;
    if (typeof status === 'string' && /cancel|closed|unavailable/i.test(status)) continue;
    const start = typeof a === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a) ? new Date(`${a}T00:00:00Z`) : null;
    if (!start) continue;
    const end = typeof b === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b) ? new Date(`${b}T00:00:00Z`) : start;
    if (end < start || (end.getTime() - start.getTime()) / 86400000 > TRIP_MAX_DAYS) continue;
    for (const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); d <= end; d.setUTCMonth(d.getUTCMonth() + 1)) out.add(d.getUTCMonth() + 1);
  }
  return [...out].sort((x, y) => x - y);
}

/** An older cruise season counts only with a season text that is not just a booking period over several years. */
export function explicitCruiseSeason(seasonText: string | null, start: number | null, end: number | null): number[] {
  if (!seasonText?.trim() || !start || !end) return [];
  const years = new Set(seasonText.match(/\b20\d\d\b/g) ?? []);
  if (years.size > 1) return [];
  const out: number[] = [];
  for (let m = start, guard = 0; guard < 12; guard += 1) { out.push(m); if (m === end) break; m = m === 12 ? 1 : m + 1; }
  return out.sort((x, y) => x - y);
}

/** Bases whose months are an explicit offer statement (page season, page wind window, dated trips approved by Aaron). */
export const EXPLICIT_BASES = new Set(['range', 'year_round', 'closed_months', 'wind_season', 'split_season', 'page_wind', 'approved:dates_only']);

/**
 * What to propose for one offer. Unknown: the page's wind window for a stay/camp/course when the page names one,
 * else the climate season. Known through a page season written by season-extract: a stay or camp keeps only the
 * months that are also in the climate season (never empty: then it stays as it is).
 */
export function proposeRegionSeason(input: {
  type: OfferType; snow: boolean; known: boolean; current: number[]; evidenceBasis: string | null;
  climate: number[] | null; pageWind: number[] | null; pageMonths?: number[] | null;
}): { months: number[]; basis: 'region_inferred' | 'page_wind' | 'page_region' } | null {
  const { type, snow, known, current, evidenceBasis, climate, pageWind, pageMonths } = input;
  if (snow) return null;
  if (!known) {
    if (pageWind?.length && type !== 'cruise') return { months: sortNum(pageWind), basis: 'page_wind' };
    return climate?.length ? { months: sortNum(climate), basis: 'region_inferred' } : null;
  }
  const same = (a: number[], b: number[]) => JSON.stringify(sortNum(a)) === JSON.stringify(sortNum(b));
  // Re-runs: a season this command wrote is recomputed (climate data, overrides or storm rules may have changed).
  if (evidenceBasis === 'region_inferred') return climate?.length && !same(climate, current) ? { months: sortNum(climate), basis: 'region_inferred' } : null;
  if (evidenceBasis === 'page_region') {
    const cut = (pageMonths?.length ? pageMonths : current).filter(m => climate?.includes(m));
    return cut.length && !same(cut, current) ? { months: sortNum(cut), basis: 'page_region' } : null;
  }
  // Only seasons season-extract wrote from a page, and only for places that stay open while the wind is gone.
  // A page wind window and rows Aaron approved one by one stay as they are.
  if (!evidenceBasis || evidenceBasis.startsWith('region') || evidenceBasis === 'page_wind' || evidenceBasis.startsWith('approved:')
    || !['accommodation', 'camp'].includes(type) || !climate?.length) return null;
  const cut = current.filter(m => climate.includes(m));
  if (!cut.length || cut.length === current.length) return null;
  return { months: sortNum(cut), basis: 'page_region' };
}

// ---------------------------------------------------------------------------------------------------------
// Runner: reads live data, writes a plan + a German review table. Nothing is written live.
// ---------------------------------------------------------------------------------------------------------

const db = async () => (await import('../lib/supabase.js')).supabase;
async function selectAll<T>(table: string, columns: string): Promise<T[]> {
  const supabase = await db();
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as T[]));
    if (!data || data.length < 1000) return out;
  }
}

type ProposalRow = PlanRow & { storm?: { zone: string; removed: number[]; kept: number[] }; region_basis: string; country: string | null; region: string | null; wind_source: string | null; climate: number[] | null; current: number[]; region_alt?: { key: string; months: number[] | null } };

export async function runRegionSeasons(opts: { outDir: string; pagePlan?: string }) {
  type View = { offer_id: string; title: string; provider_name: string | null; provider_root_domain: string | null; source_url: string | null; country: string | null; region: string | null; disciplines: string[] | null; provider_trip_types?: string[] | null };
  const known = new Map((await selectAll<{ catalog_source: string; offer_id: string; months: number[] }>('offer_bookable_months', 'catalog_source,offer_id,months')).map(r => [r.offer_id, r.months]));
  const cruiseView = await selectAll<View>('app_cruise_offer_cards', 'offer_id,title,provider_name,provider_root_domain,source_url,country,region,disciplines');
  const packageView = await selectAll<View>('app_package_cards', 'offer_id,title,provider_name,provider_root_domain,source_url,country,region,disciplines,provider_trip_types');
  type Season = { id: string; season_start_month: number | null; season_end_month: number | null; season_months: number[] | null; season_evidence: { basis?: string; months?: number[] } | null };
  const seasons = new Map<string, Season>();
  for (const r of await selectAll<Season>('cruise_offers', 'id,season_start_month,season_end_month,season_months,season_evidence')) seasons.set(r.id, r);
  for (const r of await selectAll<Omit<Season, 'season_start_month' | 'season_end_month'>>('package_offers', 'id,season_months,season_evidence')) seasons.set(r.id, { ...r, season_start_month: null, season_end_month: null });
  const climate = new Map((await selectAll<{ offer_id: string; lat: number; lng: number; air_temp_max_months: (number | null)[] | null }>('offer_climate_stats', 'offer_id,lat,lng,air_temp_max_months')).map(r => [r.offer_id, r]));
  const regions = await selectAll<Region>('region_climate_stats', 'region_key,country,lat,lng,wind_months,wind_source_months');
  const countries = new Map((await selectAll<ClimateRow & { country: string }>('country_climate_stats', 'country,wind_months,wind_source_months')).map(r => [r.country.toLowerCase(), r]));
  const pageRows = opts.pagePlan ? (JSON.parse(readFileSync(opts.pagePlan, 'utf8')).rows as PlanRow[]) : [];
  const pageWind = new Map(pageRows.filter(r => !r.decision.write && r.decision.reason === 'wind_only' && r.decision.months.length).map(r => [r.offer_id, r]));

  const all0 = [
    ...cruiseView.map(r => ({ r, type: 'cruise' as OfferType })),
    ...packageView.map(r => ({ r, type: (r.provider_trip_types?.[0] ?? 'accommodation') as OfferType })),
  ];
  // Storm months an explicit offer near by (same zone, <= CONTRA_MAX_KM) runs in: trip-like dated slots, an older
  // cruise season with a real season text, a page season of a cruise/tour/camp/course, a page wind window. An
  // accommodation's opening statement and long availability windows are not one.
  const datesById = new Map([...await selectAll<{ offer_id: string; dates: unknown }>('app_cruise_offer_cards', 'offer_id,dates'),
    ...await selectAll<{ offer_id: string; dates: unknown }>('app_package_cards', 'offer_id,dates')].map(r => [r.offer_id, r.dates]));
  const cruiseText = new Map((await selectAll<{ id: string; season_text: string | null }>('cruise_offers', 'id,season_text')).map(r => [r.id, r.season_text]));
  const evidenceOffers: Array<{ zone: string; lat: number; lng: number; months: number[]; title: string }> = [];
  for (const { r, type } of all0) {
    const cs = climate.get(r.offer_id);
    const zone = cs ? stormZone(r.country, cs.lat, cs.lng) : null;
    if (!zone || !cs) continue;
    const se = seasons.get(r.offer_id);
    const ev = se?.season_evidence?.basis ?? null;
    const months = new Set<number>(tripMonths(datesById.get(r.offer_id)));
    if (!ev && type === 'cruise') explicitCruiseSeason(cruiseText.get(r.offer_id) ?? null, se?.season_start_month ?? null, se?.season_end_month ?? null).forEach(m => months.add(m));
    if (ev && EXPLICIT_BASES.has(ev) && (type !== 'accommodation' || ev === 'page_wind')) (se?.season_evidence?.months ?? []).forEach(m => months.add(m));
    const hit = [...months].filter(m => zone.months.includes(m)).sort((a, b) => a - b);
    if (hit.length) evidenceOffers.push({ zone: zone.label, lat: cs.lat, lng: cs.lng, months: hit, title: r.title });
  }
  const contradictionsNear = (zone: string, lat: number, lng: number) => {
    const near = evidenceOffers.filter(e => e.zone === zone && distanceKm(lat, lng, e.lat, e.lng) <= CONTRA_MAX_KM);
    return { months: new Set(near.flatMap(e => e.months)), offers: near.map(e => `${e.title.slice(0, 50)} (${e.months.join(',')})`) };
  };
  const contradictions = new Map<string, { months: Set<number>; offers: string[] }>();
  for (const e of evidenceOffers) {
    const c = contradictions.get(e.zone + '|' + e.title) ?? { months: new Set<number>(e.months), offers: [`${e.title.slice(0, 50)} (${e.months.join(',')})`] };
    contradictions.set(e.zone + '|' + e.title, c);
  }

  const rows: ProposalRow[] = [];
  const skipped: Array<{ offer_id: string; title: string; type: string; reason: string }> = [];
  const all = [
    ...cruiseView.map(r => ({ r, source: 'cruise_offers' as const, type: 'cruise' as OfferType })),
    ...packageView.map(r => ({ r, source: 'package_offers' as const, type: (r.provider_trip_types?.[0] ?? 'accommodation') as OfferType })),
  ];
  for (const { r, source, type } of all) {
    const snow = (r.disciplines ?? []).includes('snowkite');
    const cs = climate.get(r.offer_id);
    const fixed = regionOverride(r.country);
    const wind = fixed ? { key: fixed.label, wind: null } as WindSource : cs ? pickWind(r.country, cs.lat, cs.lng, regions, countries) : null;
    const clim0 = fixed ? fixed.months : cs ? climateSeason(cs.air_temp_max_months, wind?.wind) : null;
    const zone = fixed ? null : stormZone(r.country, cs?.lat ?? null, cs?.lng ?? null);
    const contra = zone && cs ? contradictionsNear(zone.label, cs.lat, cs.lng).months : new Set<number>();
    const clim = clim0 && zone ? stormCut(clim0, zone.months, contra) : clim0;
    const s = seasons.get(r.offer_id);
    const ev = s?.season_evidence ?? null;
    // For seasons season-extract wrote, compare against the stored season, not the bookable months (dates add to those).
    const stored = ev?.months ?? null;
    const current = stored ?? known.get(r.offer_id) ?? [];
    const pw = pageWind.get(r.offer_id);
    const prop = proposeRegionSeason({ type, snow, known: known.has(r.offer_id) || !!stored, current, evidenceBasis: ev?.basis ?? null, climate: clim, pageWind: fixed ? null : pw?.decision.months ?? null, pageMonths: (ev as { page_months?: number[] } | null)?.page_months ?? null });
    if (!prop) {
      const noAir = !cs?.air_temp_max_months || cs.air_temp_max_months.every(v => v == null);
      const noWind = !wind?.wind || wind.wind.every(v => v == null);
      if (!known.has(r.offer_id)) skipped.push({ offer_id: r.offer_id, title: r.title, type, reason: snow ? 'Snowkite (von der Regel ausgenommen)'
        : !cs ? 'kein Klimapunkt'
        : noAir && noWind ? 'keine Temperatur- und keine Winddaten' : noAir ? 'keine Temperaturdaten' : noWind ? `keine Winddaten (${r.country ?? 'Land unbekannt'})`
        : clim && !clim.length ? 'kein Monat erfüllt die Regel' : 'unklar' });
      continue;
    }
    rows.push({
      catalog_source: source, offer_id: r.offer_id, type, title: r.title, provider: r.provider_name ?? r.provider_root_domain ?? '?', source_url: r.source_url,
      text_source: 'stored', extraction: fixed ? null : pw?.extraction ?? null,
      decision: { write: true, months: prop.months, kind: prop.basis },
      ...(stored ? { previous: stored } : {}),
      ...(prop.basis === 'page_region' && (ev as { page_months?: number[] } | null)?.page_months ? { page_months: (ev as { page_months?: number[] }).page_months } : {}),
      region_basis: prop.basis, country: r.country, region: r.region, wind_source: wind?.key ?? null, climate: clim, current,
      ...(zone ? { storm: { zone: zone.label, removed: (clim0 ?? []).filter(m => !(clim ?? []).includes(m)), kept: [...contra].sort((a, b) => a - b) } } : {}),
      ...(!fixed && wind?.alt && cs ? { region_alt: { key: wind.alt.key, months: climateSeason(cs.air_temp_max_months, wind.alt.wind) } } : {}),
    });
  }
  rows.sort((a, b) => (a.country ?? '').localeCompare(b.country ?? '') || (a.region ?? '').localeCompare(b.region ?? '') || a.title.localeCompare(b.title));
  mkdirSync(opts.outDir, { recursive: true });
  const planPath = join(opts.outDir, 'season-region-plan.json');
  writeFileSync(planPath, JSON.stringify({ created_at: new Date().toISOString(), rule: { AIR_MIN_C, WIND_MIN_PCT, REGION_MAX_KM }, rows, skipped }, null, 1));
  const reviewPath = join(opts.outDir, 'season-region-review.md');
  writeFileSync(reviewPath, regionReview(rows, skipped, contradictions));
  const count = (b: string) => rows.filter(r => r.region_basis === b).length;
  return { planPath, reviewPath, region_inferred: count('region_inferred'), page_wind: count('page_wind'), page_region: count('page_region'), skipped: skipped.length };
}

function regionReview(rows: ProposalRow[], skipped: Array<{ offer_id: string; title: string; type: string; reason: string }>, contradictions = new Map<string, { months: Set<number>; offers: string[] }>()): string {
  const cell = (s: string | null | undefined) => (s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
  const de = (l: string) => l.replace('all year', 'ganzjährig').replace(/Mar/g, 'Mär').replace(/May/g, 'Mai').replace(/Oct/g, 'Okt').replace(/Dec/g, 'Dez');
  const lab = (m: number[]) => (m.length ? de(contiguousRange(m) || m.length === 12 ? monthsLabel(m) : splitLabel(m)) : '-');
  const BASIS: Record<string, string> = { region_inferred: 'aus der Region erschlossen', page_wind: 'Seite (Windsaison)', page_region: 'Seite ∩ Region' };
  // Per-region summary: the distinct climate seasons per country/wind source.
  const groups = new Map<string, { months: string; n: number; types: Set<string> }>();
  for (const r of rows.filter(r => r.region_basis === 'region_inferred')) {
    const k = `${r.country ?? '?'} | ${r.wind_source ?? '-'} | ${lab(r.decision.months)}`;
    const g = groups.get(k) ?? { months: lab(r.decision.months), n: 0, types: new Set<string>() };
    g.n += 1; g.types.add(r.type); groups.set(k, g);
  }
  const section = (title: string, list: ProposalRow[], extra: (r: ProposalRow) => string) => [
    `## ${title} (${list.length})`, '',
    '| # | Typ | Land / Region | Anbieter | Angebot | Vorschlag | Basis | Bisher | Windquelle | id |', '|---|---|---|---|---|---|---|---|---|---|',
    ...list.map((r, i) => `| ${i + 1} | ${r.type} | ${cell(r.country)} / ${cell(r.region).slice(0, 30)} | ${cell(r.provider).slice(0, 30)} | ${cell(r.title).slice(0, 50)} | **${lab(r.decision.months)}** | ${BASIS[r.region_basis]}${extra(r)} | ${r.current.length ? lab(r.current) : 'unbekannt'} | ${cell(r.wind_source)} | \`${r.offer_id.slice(0, 8)}\` |`), ''];
  return [
    `# Saisons aus Region und Klima - Vorschlag ${new Date().toISOString().slice(0, 10)}`, '',
    'Auftrag Aaron (2026-10-28, über den Deployer): Der Karten-Schalter "Hide out-of-season listings" ist per Default aus, deshalb auch für Camps und Unterkünfte konsequent Saisons setzen; lieber ein Angebot zu viel ausblenden als eins zu wenig (z. B. im Januar keine Nord-/Ostseeküste, im Juli/August kein Südafrika). **Nichts ist live geschrieben.**', '',
    `**Regel pro Monat:** Saison, wenn die mittlere Tageshöchsttemperatur am Angebotspunkt mindestens ${AIR_MIN_C} °C ist **und** der Anteil windiger Tage mindestens ${WIND_MIN_PCT} % (ein einzelner Monat ohne Windwert blockiert nicht; Spots ganz ohne Wind- oder Temperaturdaten und Snowkite sind ausgenommen und unten markiert). Wind = Landeswert, den die App zeigt (Bstoked windProbability). Monate, die dort nur mit ERA5 gefüllt sind, sind Bstoked-Platzhalter (unter 40 % windige Tage) und zählen nicht. Die reinen ERA5-Werte einer nahen Klimaregion (bis ${REGION_MAX_KM} km) nutze ich nur, wo das Land keine Bstoked-Daten hat; wo sie anders entscheiden würden, steht es unten zum Prüfen. Temperatur = Klimapunkt des Angebots.`, '',
    `**Feste Vorgabe:** ${REGION_OVERRIDES.map(o => `${o.label} (${o.countries.join(', ')}): Apr-Okt`).join('; ')} - ersetzt dort die Klimaregel und eine Windsaison der Seite (Aaron 2026-10-28).`, '',
    '**Wer was bekommt:** Unbekannte Angebote bekommen die Klimasaison ("aus der Region erschlossen"), Camps/Unterkünfte/Kurse mit einer Windsaison auf der eigenen Seite stattdessen diese ("Seite (Windsaison)"). Unterkünfte und Camps mit einer schon geschriebenen Seiten-Saison (z. B. "ganzjährig geöffnet") behalten nur die Monate, die auch in der Klimasaison liegen ("Seite ∩ Region"). Kreuzfahrten und Touren mit eigener Saison oder Terminen und Snowkite bleiben unverändert.', '',
    `**Sturmregel:** ${STORM_ZONES.map(z => `${z.label} ohne ${z.months.map(m => ['', 'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'][m]).join('/')}`).join('; ')}. Gilt nur für erschlossene Saisons; ein Sturmmonat, in dem ein ausdrücklich belegtes Angebot derselben Zone im Umkreis von ${CONTRA_MAX_KM} km läuft, bleibt dort erlaubt. Gegenbelege (Zone | Angebot):`, '',
    ...(contradictions.size ? [...contradictions.entries()].map(([k, c]) => `- ${k.replace('|', ', ')}: erlaubt bleiben ${[...c.months].sort((a, b) => a - b).join(',')} wegen ${c.offers.slice(0, 4).join('; ')}${c.offers.length > 4 ? ` (+${c.offers.length - 4})` : ''}`) : ['- keine Gegenbelege']), '',
    '## Saisons pro Region (aus der Region erschlossen)', '',
    '| Land | Windquelle | Saison | Angebote | Typen |', '|---|---|---|---|---|',
    ...[...groups.entries()].sort().map(([k, g]) => { const [c, w] = k.split(' | '); return `| ${c} | ${w} | ${g.months} | ${g.n} | ${[...g.types].join(', ')} |`; }), '',
    section('Neu: aus der Region erschlossen', rows.filter(r => r.region_basis === 'region_inferred'), () => ''),
    section('Neu: Windsaison von der eigenen Seite', rows.filter(r => r.region_basis === 'page_wind'), r => ` - "${cell(r.extraction?.evidence_quote).slice(0, 90)}"`),
    section('Eingeschränkt: Seiten-Saison geschnitten mit der Klimasaison', rows.filter(r => r.region_basis === 'page_region'), r => ` (Klima: ${r.climate ? lab(r.climate) : '-'})`),
    ...(() => {
      const diff = rows.filter(r => r.region_basis === 'region_inferred' && r.region_alt && JSON.stringify(r.region_alt.months ?? []) !== JSON.stringify(r.decision.months));
      return [`## Zum Prüfen: die nahe Klimaregion (nur ERA5) käme auf andere Monate (${diff.length}) - Vorschlag nutzt den Landeswert (Bstoked)`, '',
        '| Angebot | Land | Vorschlag (Land) | Region | Region käme auf | id |', '|---|---|---|---|---|---|',
        ...diff.map(r => `| ${cell(r.title).slice(0, 50)} | ${cell(r.country)} | ${lab(r.decision.months)} | ${cell(r.region_alt!.key)} | ${r.region_alt!.months ? lab(r.region_alt!.months) : '-'} | \`${r.offer_id.slice(0, 8)}\` |`), ''];
    })(),
    `## Bitte prüfen: Spots ohne Wind- oder Temperaturdaten (${skipped.filter(s => /^kein/.test(s.reason) && s.reason !== 'kein Monat erfüllt die Regel').length}) - von der Regel ausgenommen, bleiben unbekannt`, '',
    ...skipped.filter(s => /^kein/.test(s.reason) && s.reason !== 'kein Monat erfüllt die Regel').map(s => `- ${s.type} ${cell(s.title).slice(0, 60)} \`${s.offer_id.slice(0, 8)}\`: **${s.reason}**`), '',
    `## Sonst unbekannt (${skipped.filter(s => !/^kein/.test(s.reason) || s.reason === 'kein Monat erfüllt die Regel').length})`, '',
    ...skipped.filter(s => !/^kein/.test(s.reason) || s.reason === 'kein Monat erfüllt die Regel').map(s => `- ${s.type} ${cell(s.title).slice(0, 60)} \`${s.offer_id.slice(0, 8)}\`: ${s.reason}`), '',
  ].join('\n');
}

function splitLabel(months: number[]): string {
  const set = new Set(months);
  const starts = months.filter(m => !set.has(m === 1 ? 12 : m - 1));
  const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return starts.map(s => { let e = s; while (set.has(e === 12 ? 1 : e + 1)) e = e === 12 ? 1 : e + 1; return s === e ? MON[s] : `${MON[s]}-${MON[e]}`; }).join(' + ');
}
