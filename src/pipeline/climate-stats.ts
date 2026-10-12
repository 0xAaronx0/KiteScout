// `pnpm cli climate-stats [--dry-run] [--max-fetch N]`
// Weekly refresh of offer_climate_stats (UV, air temp, water temp per offer spot):
//   1. read every offer the apps show (app_cruise_offer_cards + app_package_cards)
//   2. resolve its point (cruise: departure port, tour: start point, else location)
//   3. reuse a cached climate_points cell within 0.075°, or fetch a new one from Open-Meteo
//   4. upsert offer_climate_stats, delete rows of offers that are gone
// Moved pins (e.g. corrected accommodation locations) simply resolve to another cell.
// Open-Meteo's hourly/daily quota stops new fetches; the rest is picked up next run.
import { supabase } from '../lib/supabase.js';
import {
  type ClimateCell, type OfferRef, type PortPoint, RateLimitError,
  fetchCellClimate, findCell, portKey, resolvePoint, round10,
} from './climate.js';

const SOURCES = 'UV: CAMS global via Open-Meteo Air Quality API 2023-2025; air temp: ERA5 via Open-Meteo Historical API 2016-2025; water temp: Open-Meteo Marine API SST 2023-2025';

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
  offers: number;
  rowsWritten: number;
  rowsDeleted: number;
  cellsFetched: number;
  noPoint: string[];
  unknownPorts: string[];
  deferred: string[];
  stoppedBy?: string;
}

export async function runClimateStats(opts: { dryRun?: boolean; maxFetch?: number } = {}): Promise<ClimateRunReport> {
  const apiKey = process.env.OPEN_METEO_API_KEY || undefined;

  const cruises = await selectAll<any>('app_cruise_offer_cards', 'offer_id,title,country,departure_port,itinerary_spots');
  const packages = await selectAll<any>('app_package_cards', 'offer_id,title,country,departure_port,itinerary_spots,package_type');
  const offers: OfferRef[] = [
    ...cruises.map(o => ({ ...o, offer_table: 'cruise_offers' as const, offer_type: 'cruise' })),
    ...packages.map(o => ({ ...o, offer_table: 'package_offers' as const, offer_type: o.package_type })),
  ];

  const portRows = await selectAll<PortPoint>('climate_port_points', 'departure_port,country,lat,lng,name');
  const ports = new Map(portRows.map(p => [portKey(p.departure_port, p.country || null), p]));
  const cells = await selectAll<ClimateCell & { sources: string }>('climate_points', '*');

  const report: ClimateRunReport = {
    offers: offers.length, rowsWritten: 0, rowsDeleted: 0, cellsFetched: 0,
    noPoint: [], unknownPorts: [], deferred: [],
  };
  const rows: any[] = [];
  const newCells: (ClimateCell & { sources: string })[] = [];

  for (const o of offers) {
    const p = resolvePoint(o, ports);
    if (!p) { report.noPoint.push(`${o.offer_type}: ${o.title ?? o.offer_id}`); continue; }
    if (p.unknownPort) report.unknownPorts.push(`${p.unknownPort} (${o.country ?? '?'})`);

    let cell = findCell(cells, p.lat, p.lng);
    if (!cell && !report.stoppedBy && (opts.maxFetch == null || report.cellsFetched < opts.maxFetch)) {
      try {
        const c = await fetchCellClimate(p.lat, p.lng, { fetchJson: url => fetch(url).then(r => r.json()), apiKey });
        cell = { ...c, lat10: round10(p.lat), lng10: round10(p.lng), sources: SOURCES };
        cells.push(cell); newCells.push(cell); report.cellsFetched++;
        await new Promise(r => setTimeout(r, 1500));
      } catch (e) {
        if (e instanceof RateLimitError) report.stoppedBy = e.message;
        else console.warn(`  climate fetch failed for ${o.title ?? o.offer_id} @ ${p.lat},${p.lng}: ${(e as Error).message}`);
      }
    }
    if (!cell) { report.deferred.push(`${o.offer_type}: ${o.title ?? o.offer_id}`); continue; }

    rows.push({
      offer_id: o.offer_id, offer_table: o.offer_table, offer_type: o.offer_type,
      point_basis: p.basis, point_name: p.name, lat: p.lat, lng: p.lng,
      lat10: cell.lat10, lng10: cell.lng10,
      uv_months: cell.uv_months, uv_clear_sky_months: cell.uv_clear_sky_months,
      air_temp_max_months: cell.air_temp_max_months, air_temp_min_months: cell.air_temp_min_months,
      water_temp_months: cell.water_temp_months, sources: cell.sources,
      computed_at: new Date().toISOString(),
    });
  }
  report.unknownPorts = [...new Set(report.unknownPorts)];

  if (!opts.dryRun) {
    if (newCells.length) {
      const { error } = await supabase.from('climate_points').upsert(newCells, { onConflict: 'lat10,lng10' });
      if (error) throw new Error(`climate_points upsert: ${error.message}`);
    }
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
  }
  return report;
}
