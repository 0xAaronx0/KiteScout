import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';

// Typical 10 m wind of one calendar month (ERA5 2016-2025 monthly means, leaflet-velocity
// JSON) for the month animation on the KCS world map (MartinMarzi/KiteCruiseScout#445).
// URL: /data/wind/climate/01.json ... /12.json. The wind-climate GitHub Action publishes one
// bundle with all 12 months as a release asset; this route mirrors it from memory, one
// precompressed month per URL, with CORS and 1-day caching (the data change once a year).
// If GitHub is unreachable the last good copy keeps being served.
export const dynamic = 'force-dynamic';

const SRC = process.env.WIND_CLIMATE_URL
  ?? 'https://github.com/0xAaronx0/KiteScout/releases/download/wind-data/wind-climate.json.gz';
const RECHECK_MS = 6 * 3_600_000;
const RETRY_MS = 5 * 60_000;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
};

interface Month { gz: Buffer; json: Buffer; etag: string }
interface Cached { months: Month[]; generatedAt: string; nextCheck: number }
let cache: Cached | null = null;
let inflight: Promise<void> | null = null;

async function load(): Promise<void> {
  const gz = SRC.startsWith('file:')
    ? await readFile(new URL(SRC))
    : await fetch(SRC, { cache: 'no-store', signal: AbortSignal.timeout(30_000) }).then(async r => {
      if (!r.ok) throw new Error(`wind climate source HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    });
  const bundle = JSON.parse(gunzipSync(gz).toString('utf8'));
  if (bundle?.kind !== 'monthly-climatology' || !Array.isArray(bundle.months) || bundle.months.length !== 12
    || bundle.months.some((m: any, i: number) => !Array.isArray(m) || m.length !== 2 || m[0]?.header?.month !== i + 1 || !Array.isArray(m[0]?.data))) {
    throw new Error('wind climate source is not a 12-month leaflet-velocity bundle');
  }
  if (cache && Date.parse(bundle.generatedAt) <= Date.parse(cache.generatedAt)) {
    cache.nextCheck = Date.now() + RECHECK_MS;
    return;
  }
  const months = bundle.months.map((m: unknown) => {
    const json = Buffer.from(JSON.stringify(m));
    return { json, gz: gzipSync(json, { level: 9 }), etag: `"${createHash('sha1').update(json).digest('hex').slice(0, 20)}"` };
  });
  cache = { months, generatedAt: bundle.generatedAt, nextCheck: Date.now() + RECHECK_MS };
}

async function current(): Promise<Cached | null> {
  if (!cache || Date.now() >= cache.nextCheck) {
    inflight ??= load()
      .catch(err => {
        console.error('[wind-climate] refresh failed, serving last good copy', err);
        if (cache) cache.nextCheck = Date.now() + RETRY_MS;
      })
      .finally(() => { inflight = null; });
    if (!cache) await inflight;
  }
  return cache;
}

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const match = /^(0[1-9]|1[0-2])\.json$/.exec((await params).file);
  if (!match) return Response.json({ error: 'use /data/wind/climate/01.json ... 12.json' }, { status: 404, headers: { ...CORS, 'Cache-Control': 'no-store' } });
  const c = await current();
  if (!c) {
    return Response.json({ error: 'wind climate data not available yet' }, { status: 503, headers: { ...CORS, 'Cache-Control': 'no-store' } });
  }
  const month = c.months[Number(match[1]) - 1];
  const headers: Record<string, string> = {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=86400',
    'Vary': 'Accept-Encoding',
    'ETag': month.etag,
    'Last-Modified': new Date(c.generatedAt).toUTCString(),
  };
  if (req.headers.get('if-none-match') === month.etag) return new Response(null, { status: 304, headers });
  if (/\bgzip\b/.test(req.headers.get('accept-encoding') ?? '')) {
    return new Response(new Uint8Array(month.gz), { headers: { ...headers, 'Content-Encoding': 'gzip' } });
  }
  return new Response(new Uint8Array(month.json), { headers });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
