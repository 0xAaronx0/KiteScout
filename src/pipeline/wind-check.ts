// `pnpm cli climate-wind-check` - READ-ONLY. ERA5 share of kiteable days per month for every
// country point (non-alias), every region point and a few candidate points, printed as one
// `WIND {json}` line per point for the calibration against Bstoked wind_stats.windProbability.
// Base rule (Aaron 2026-10-21): >= 12 kn for >= 2 consecutive daylight hours. The variants
// (thresholds x run lengths) are only there to calibrate. Writes nothing.
import { supabase } from '../lib/supabase.js';
import { era5WindSeries, kiteableShare, normalizeToken } from './copernicus.js';

const VARIANTS: [number, number][] = [10, 11, 12, 13, 14, 15, 16].flatMap(kn => [1, 2, 3].map(run => [kn, run] as [number, number]));
/** candidate points not in the DB yet (proposals) */
const CANDIDATES = [
  { key: 'cand:IT-SICILY', country: 'Italy', region: 'Sicily', name: 'Lo Stagnone, Marsala', lat: 37.87, lng: 12.47 },
  // 2026-10-30 (Aaron): UAE and Qatar listings need wind_stats rows (no bstoked data)
  { key: 'cand:AE-UAQ', country: 'United Arab Emirates', region: null, name: 'Khor Al Yeefrah, Umm Al Quwain', lat: 25.54, lng: 55.63 },
  { key: 'cand:AE-DXB', country: 'United Arab Emirates', region: null, name: 'Kite Beach, Dubai', lat: 25.16, lng: 55.20 },
  { key: 'cand:AE-AUH', country: 'United Arab Emirates', region: null, name: 'Yas Island north, Abu Dhabi', lat: 24.52, lng: 54.60 },
  { key: 'cand:QA-FKB', country: 'Qatar', region: null, name: 'Fuwairit Kite Beach', lat: 26.02, lng: 51.38 },
];

export async function runWindCheck(): Promise<void> {
  const raw = process.env.CDSAPI_KEY || process.env.CDS_API_KEY;
  if (!raw) throw new Error('climate-wind-check needs CDSAPI_KEY / CDS_API_KEY');
  const { token } = normalizeToken(raw);
  const c = await supabase.from('climate_country_points').select('country,is_alias,spot_name,lat,lng');
  if (c.error) throw new Error(`climate_country_points: ${c.error.message}`);
  const r = await supabase.from('climate_region_points').select('region_key,country,region_name,spot_name,lat,lng');
  if (r.error) throw new Error(`climate_region_points: ${r.error.message}`);
  const points = [
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
      const s = await era5WindSeries(p.lat, p.lng, token);
      const shares = Object.fromEntries(VARIANTS.map(([kn, run]) => [`${kn}/${run}`, kiteableShare(s, p.lng, kn, run)]));
      console.log(`WIND ${JSON.stringify({ ...p, shares })}`);
    } catch (e) {
      console.log(`WIND-FAIL ${p.key}: ${(e as Error).message}`);
    }
    if (++done % 20 === 0) console.log(`  ${done}/${points.length}`);
  })));
}
