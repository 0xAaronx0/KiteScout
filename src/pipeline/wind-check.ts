// `pnpm cli climate-wind-check` - READ-ONLY. ERA5 share of kiteable days per month for every
// country point (non-alias), every region point and a few candidate points, printed as one
// `WIND {json}` line per point for the calibration against Bstoked wind_stats.windProbability.
// Base rule (Aaron 2026-10-21): >= 12 kn for >= 2 consecutive daylight hours. The variants
// (thresholds x run lengths) are only there to calibrate. Writes nothing.
import { supabase } from '../lib/supabase.js';
import { ERA5_DATASET, ERA5_LAND_DATASET, era5WindSeries, kiteableShare, normalizeToken } from './copernicus.js';

const VARIANTS: [number, number][] = [10, 11, 12, 13, 14, 15, 16].flatMap(kn => [1, 2, 3].map(run => [kn, run] as [number, number]));
/** candidate points not in the DB yet (proposals) */
const CANDIDATES = [
  { key: 'cand:IT-SICILY', country: 'Italy', region: 'Sicily', name: 'Lo Stagnone, Marsala', lat: 37.87, lng: 12.47 },
  // 2026-10-24 ERA5 vs ERA5-Land at Nitinat Lake (ERA5 0-3 % in summer) + thermal controls
  // where ERA5 failed against Bstoked (La Ventana, Mancora, Tarifa)
  { key: 'cand:CA-BC-nitinat-launch', country: 'Canada', region: 'British Columbia', name: 'Nitinat Lake (offers point)', lat: 48.75, lng: -124.74 },
  { key: 'cand:CA-BC-nitinat-mid', country: 'Canada', region: 'British Columbia', name: 'Nitinat Lake (mid lake)', lat: 48.70, lng: -124.80 },
  { key: 'cand:CA-BC-nitinat-valley', country: 'Canada', region: 'British Columbia', name: 'Nitinat valley (inland)', lat: 48.80, lng: -124.65 },
  { key: 'ctrl:MX-la-ventana', country: 'Mexico', region: null, name: 'La Ventana', lat: 24.05, lng: -109.99 },
  { key: 'ctrl:PE-mancora', country: 'Peru', region: null, name: 'Mancora', lat: -4.1, lng: -81.05 },
  { key: 'ctrl:ES-tarifa', country: 'Spain', region: null, name: 'Tarifa', lat: 36.01, lng: -5.6 },
];

export async function runWindCheck(opts: { candidatesOnly?: boolean } = {}): Promise<void> {
  const raw = process.env.CDSAPI_KEY || process.env.CDS_API_KEY;
  if (!raw) throw new Error('climate-wind-check needs CDSAPI_KEY / CDS_API_KEY');
  const { token } = normalizeToken(raw);
  const c = await supabase.from('climate_country_points').select('country,is_alias,spot_name,lat,lng');
  if (c.error) throw new Error(`climate_country_points: ${c.error.message}`);
  const r = await supabase.from('climate_region_points').select('region_key,country,region_name,spot_name,lat,lng');
  if (r.error) throw new Error(`climate_region_points: ${r.error.message}`);
  const points = opts.candidatesOnly ? CANDIDATES : [
    ...c.data.filter(x => !x.is_alias).map(x => ({ key: `country:${x.country}`, country: x.country, region: null as string | null, name: x.spot_name, lat: x.lat, lng: x.lng })),
    ...r.data.map(x => ({ key: `region:${x.region_key}`, country: x.country, region: x.region_name, name: x.spot_name, lat: x.lat, lng: x.lng })),
    ...CANDIDATES,
  ];
  console.log(`wind check: ${points.length} points, ${VARIANTS.length} rule variants`);
  const { default: pLimit } = await import('p-limit');
  const limit = pLimit(6);
  let done = 0;
  await Promise.all(points.map(p => limit(async () => {
    try {
      // candidates are compared on both grids; the full sweep stays ERA5-only
      for (const dataset of opts.candidatesOnly ? [ERA5_DATASET, ERA5_LAND_DATASET] : [ERA5_DATASET]) {
        const s = await era5WindSeries(p.lat, p.lng, token, undefined, dataset);
        const shares = Object.fromEntries(VARIANTS.map(([kn, run]) => [`${kn}/${run}`, kiteableShare(s, p.lng, kn, run)]));
        console.log(`WIND ${JSON.stringify({ ...p, dataset, shares })}`);
      }
    } catch (e) {
      console.log(`WIND-FAIL ${p.key}: ${(e as Error).message}`);
    }
    if (++done % 20 === 0) console.log(`  ${done}/${points.length}`);
  })));
}
