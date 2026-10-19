// `pnpm cli climate-stats [--dry-run] [--max-fetch N] [--budget-min N]`
// Weekly refresh of offer_climate_stats (UV, air temp, water temp per offer spot):
//   1. read every offer the apps show (app_cruise_offer_cards + app_package_cards)
//   2. resolve its point (cruise: departure port, tour: start point, else location)
//   3. reuse a cached climate_points cell within 0.075°, or fetch a new one
//   4. upsert offer_climate_stats, delete rows of offers that are gone
//   5. same for every country in climate_country_points -> country_climate_stats
//      (one kite spot per wind_stats country; map layers next to wind_stats)
// Fetcher: Copernicus (ERA5 + CAMS, CC-BY 4.0) when CDSAPI_KEY / CDS_API_KEY is set,
// else Open-Meteo (free API = non-commercial only; OPEN_METEO_API_KEY = commercial hosts).
// Countries only use Copernicus cells while a Copernicus token is set (Aaron, 2026-10-19).
// New cells are written as soon as they are fetched, so a run cut short by the quota,
// --max-fetch, --budget-min or the workflow timeout resumes where it stopped.
// Moved pins (e.g. corrected accommodation locations) simply resolve to another cell.
import pLimit from 'p-limit';
import { supabase } from '../lib/supabase.js';
import {
  type ClimateCell, type OfferRef, type PortPoint, RateLimitError,
  fetchCellClimate, findCell, portKey, resolvePoint, round10,
} from './climate.js';
import { COPERNICUS_SOURCES, fetchCellCopernicus } from './copernicus.js';

const SOURCES = 'UV: CAMS global via Open-Meteo Air Quality API 2023-2025; air temp: ERA5 via Open-Meteo Historical API 2016-2025; water temp: Open-Meteo Marine API SST 2023-2025';

type Cell = ClimateCell & { sources: string };
const isCopernicus = (c: Cell) => c.sources.startsWith('Copernicus');

async function selectAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as T[]));
    if (!data || data.length < 1000) return out;
  }
}

export interface ClimateRunReport {
  fetcher: 'copernicus' | 'open-meteo';
  offers: number;
  rowsWritten: number;
  rowsDeleted: number;
  cellsFetched: number;
  noPoint: string[];
  unknownPorts: string[];
  deferred: string[];
  countries: number;
  countryRowsWritten: number;
  countriesDeferred: string[];
  /** first computed country rows, for dry runs */
  countrySample: { country: string; point_name: string; air_temp_min_months: number[]; air_temp_max_months: number[]; water_temp_months: number[] | null; uv_months: number[] }[];
  failed: string[];
  stoppedBy?: string;
}

interface CountryPoint { country: string; is_alias: boolean; spot_name: string; lat: number; lng: number; elevation_m: number | null }

export async function runClimateStats(opts: { dryRun?: boolean; maxFetch?: number; budgetMin?: number } = {}): Promise<ClimateRunReport> {
  const apiKey = process.env.OPEN_METEO_API_KEY || undefined;
  const cdsToken = process.env.CDSAPI_KEY || process.env.CDS_API_KEY || undefined;
  const adsToken = process.env.ADSAPI_KEY || process.env.ADS_API_KEY || undefined;
  const deadline = opts.budgetMin != null ? Date.now() + opts.budgetMin * 60_000 : Infinity;

  const cruises = await selectAll<any>('app_cruise_offer_cards', 'offer_id,title,country,departure_port,itinerary_spots');
  const packages = await selectAll<any>('app_package_cards', 'offer_id,title,country,departure_port,itinerary_spots,package_type');
  const offers: OfferRef[] = [
    ...cruises.map(o => ({ ...o, offer_table: 'cruise_offers' as const, offer_type: 'cruise' })),
    ...packages.map(o => ({ ...o, offer_table: 'package_offers' as const, offer_type: o.package_type })),
  ];

  const portRows = await selectAll<PortPoint>('climate_port_points', 'departure_port,country,lat,lng,name');
  const ports = new Map(portRows.map(p => [portKey(p.departure_port, p.country || null), p]));
  const cells = await selectAll<Cell>('climate_points', '*');
  const countryPoints = await selectAll<CountryPoint>('climate_country_points', 'country,is_alias,spot_name,lat,lng,elevation_m');

  const report: ClimateRunReport = {
    fetcher: cdsToken ? 'copernicus' : 'open-meteo',
    offers: offers.length, rowsWritten: 0, rowsDeleted: 0, cellsFetched: 0,
    noPoint: [], unknownPorts: [], deferred: [],
    countries: countryPoints.length, countryRowsWritten: 0, countriesDeferred: [], countrySample: [], failed: [],
  };

  // ---- 1. points and the cells they still miss
  type Need = { lat: number; lng: number; label: string; elevation?: number | null; copernicusOnly: boolean };
  const offerPoints = offers.map(o => {
    const p = resolvePoint(o, ports);
    if (!p) report.noPoint.push(`${o.offer_type}: ${o.title ?? o.offer_id}`);
    else if (p.unknownPort) report.unknownPorts.push(`${p.unknownPort} (${o.country ?? '?'})`);
    return p;
  });
  report.unknownPorts = [...new Set(report.unknownPorts)];

  const usable = (lat: number, lng: number, copernicusOnly: boolean) =>
    findCell(copernicusOnly ? cells.filter(isCopernicus) : cells, lat, lng);
  const needs: Need[] = [];
  const add = (n: Need) => {
    if (usable(n.lat, n.lng, n.copernicusOnly)) return;
    if (needs.some(m => findCell([{ lat10: round10(m.lat), lng10: round10(m.lng) }], n.lat, n.lng))) return;
    needs.push(n);
  };
  offers.forEach((o, i) => { const p = offerPoints[i]; if (p) add({ lat: p.lat, lng: p.lng, label: o.title ?? o.offer_id, copernicusOnly: false }); });
  for (const cp of countryPoints) add({ lat: cp.lat, lng: cp.lng, label: cp.country, elevation: cp.elevation_m, copernicusOnly: !!cdsToken });
  if (needs.length) console.log(`${needs.length} climate cells to fetch via ${report.fetcher}`);

  // ---- 2. fetch them (Copernicus jobs run a few in parallel; Open-Meteo one by one)
  const limit = pLimit(cdsToken ? 4 : 1);
  let attempts = 0;
  await Promise.all(needs.map(n => limit(async () => {
    if (report.stoppedBy || Date.now() > deadline || (opts.maxFetch != null && attempts >= opts.maxFetch)) return;
    attempts++;
    const started = Date.now();
    try {
      const c = cdsToken
        ? await fetchCellCopernicus(n.lat, n.lng, { token: cdsToken, adsToken, log: console.log })
        : await fetchCellClimate(n.lat, n.lng, { fetchJson: url => fetch(url).then(r => r.json()), apiKey, elevation: n.elevation });
      const cell: Cell = { ...c, lat10: round10(n.lat), lng10: round10(n.lng), sources: cdsToken ? COPERNICUS_SOURCES : SOURCES };
      if (!opts.dryRun) {
        const { error } = await supabase.from('climate_points').upsert({ ...cell, fetched_at: new Date().toISOString() }, { onConflict: 'lat10,lng10' });
        if (error) throw new Error(`climate_points upsert: ${error.message}`);
      }
      const same = cells.findIndex(x => x.lat10 === cell.lat10 && x.lng10 === cell.lng10);
      if (same >= 0) cells[same] = cell; else cells.push(cell);
      report.cellsFetched++;
      console.log(`  + cell ${cell.lat10 / 10},${cell.lng10 / 10} for ${n.label} (${Math.round((Date.now() - started) / 1000)} s)`);
      if (!cdsToken) await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      if (e instanceof RateLimitError) report.stoppedBy = e.message;
      else {
        report.failed.push(`${n.label} @ ${n.lat},${n.lng}: ${(e as Error).message}`);
        console.warn(`  climate fetch failed for ${n.label} @ ${n.lat},${n.lng}: ${(e as Error).message}`);
      }
    }
  })));
  if (!report.stoppedBy && Date.now() > deadline) report.stoppedBy = `time budget of ${opts.budgetMin} min used up`;

  // ---- 3. rows
  const rows: any[] = [];
  offers.forEach((o, i) => {
    const p = offerPoints[i];
    if (!p) return;
    const cell = usable(p.lat, p.lng, false);
    if (!cell) { report.deferred.push(`${o.offer_type}: ${o.title ?? o.offer_id}`); return; }
    rows.push({
      offer_id: o.offer_id, offer_table: o.offer_table, offer_type: o.offer_type,
      point_basis: p.basis, point_name: p.name, lat: p.lat, lng: p.lng,
      lat10: cell.lat10, lng10: cell.lng10,
      uv_months: cell.uv_months, uv_clear_sky_months: cell.uv_clear_sky_months,
      air_temp_max_months: cell.air_temp_max_months, air_temp_min_months: cell.air_temp_min_months,
      water_temp_months: cell.water_temp_months, sources: cell.sources,
      computed_at: new Date().toISOString(),
    });
  });

  const countryRows: any[] = [];
  for (const cp of countryPoints) {
    const cell = usable(cp.lat, cp.lng, !!cdsToken);
    if (!cell) { report.countriesDeferred.push(cp.country); continue; }
    countryRows.push({
      country: cp.country, is_alias: cp.is_alias, point_basis: 'kite_spot', point_name: cp.spot_name,
      lat: cp.lat, lng: cp.lng, lat10: cell.lat10, lng10: cell.lng10,
      air_temp_min_months: cell.air_temp_min_months, air_temp_max_months: cell.air_temp_max_months,
      water_temp_months: cell.water_temp_months,
      uv_months: cell.uv_months, uv_clear_sky_months: cell.uv_clear_sky_months,
      sources: cell.sources, updated_at: new Date().toISOString(),
    });
  }
  report.countrySample = countryRows.filter(r => !r.is_alias).slice(0, 5).map(r => ({
    country: r.country, point_name: r.point_name, air_temp_min_months: r.air_temp_min_months,
    air_temp_max_months: r.air_temp_max_months, water_temp_months: r.water_temp_months, uv_months: r.uv_months,
  }));

  if (!opts.dryRun) {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from('offer_climate_stats').upsert(rows.slice(i, i + 200), { onConflict: 'offer_id' });
      if (error) throw new Error(`offer_climate_stats upsert: ${error.message}`);
    }
    report.rowsWritten = rows.length;
    // offers that are gone from both views lose their row; a deferred offer keeps its old row
    const keep = new Set(offers.map(o => o.offer_id));
    const existing = await selectAll<{ offer_id: string }>('offer_climate_stats', 'offer_id');
    const gone = existing.map(r => r.offer_id).filter(id => !keep.has(id));
    for (let i = 0; i < gone.length; i += 200) {
      const { error } = await supabase.from('offer_climate_stats').delete().in('offer_id', gone.slice(i, i + 200));
      if (error) throw new Error(`offer_climate_stats delete: ${error.message}`);
    }
    report.rowsDeleted = gone.length;
    // countries: upsert only; a country removed from climate_country_points keeps its last row
    if (countryRows.length) {
      const { error } = await supabase.from('country_climate_stats').upsert(countryRows, { onConflict: 'country' });
      if (error) throw new Error(`country_climate_stats upsert: ${error.message}`);
    }
    report.countryRowsWritten = countryRows.length;
  }
  return report;
}
