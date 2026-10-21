// `pnpm cli climate-uv-cloudy [--budget-min N]` - one-off fill of climate_points.uv_cloudy_months
// (CAMS all-sky UV) for the cells of every country and region point that lack it. Resumable:
// each box is stored when complete; a rerun fetches only what is still missing. The country/
// region rows pick the values up on the next `pnpm cli climate-stats`.
import { supabase } from '../lib/supabase.js';
import { findCell } from './climate.js';
import { UV_CLOUDY_SOURCE, fetchUvCloudy } from './cams-uv.js';
import { normalizeToken } from './copernicus.js';

type Cell = { lat10: number; lng10: number; sample_lat: number; sample_lng: number; sources: string; uv_cloudy_months: number[] | null };

export async function runUvCloudy(opts: { budgetMin?: number } = {}) {
  const raw = process.env.CDSAPI_KEY || process.env.CDS_API_KEY;
  if (!raw) throw new Error('climate-uv-cloudy needs CDSAPI_KEY / CDS_API_KEY');
  const token = normalizeToken(process.env.ADSAPI_KEY || raw).token;
  const deadline = opts.budgetMin != null ? Date.now() + opts.budgetMin * 60_000 : Infinity;
  const get = async <T>(table: string, cols: string) => {
    const { data, error } = await supabase.from(table).select(cols).range(0, 9999);
    if (error) throw new Error(`${table}: ${error.message}`);
    return data as T[];
  };
  const cells = (await get<Cell>('climate_points', 'lat10,lng10,sample_lat,sample_lng,sources,uv_cloudy_months'))
    .filter(c => c.sources.startsWith('Copernicus'));
  const pts = [
    ...await get<{ lat: number; lng: number }>('climate_country_points', 'lat,lng'),
    ...await get<{ lat: number; lng: number }>('climate_region_points', 'lat,lng'),
  ];
  const todo = [...new Set(pts.map(p => findCell(cells, p.lat, p.lng)).filter((c): c is Cell => !!c && !c.uv_cloudy_months))];
  console.log(`${todo.length} cells need UV with clouds (of ${new Set(pts.map(p => findCell(cells, p.lat, p.lng))).size} point cells)`);
  let stored = 0;
  const failed: string[] = [];
  await fetchUvCloudy(todo.map(c => ({ key: `${c.lat10}:${c.lng10}`, lat: c.sample_lat, lng: c.sample_lng, cell: c })), {
    token, log: console.log, shouldStart: () => Date.now() <= deadline,
    onPoint: async (p, uv) => {
      const { error } = await supabase.from('climate_points').update({ uv_cloudy_months: uv, uv_cloudy_source: UV_CLOUDY_SOURCE })
        .eq('lat10', p.cell.lat10).eq('lng10', p.cell.lng10);
      if (error) throw new Error(`climate_points uv update: ${error.message}`);
      stored++;
    },
    onFail: (p, e) => failed.push(`${p.key}: ${e.message}`),
  });
  console.log(`${stored}/${todo.length} cells stored${Date.now() > deadline ? ' (time budget used up; rerun continues)' : ''}`);
  if (failed.length) console.log(`Failed (${failed.length}):\n  ${[...new Set(failed)].slice(0, 30).join('\n  ')}`);
}
