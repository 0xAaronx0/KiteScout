import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

// GFS 10 m wind (leaflet-velocity JSON) for the animated wind layer on the KCS world map
// (MartinMarzi/KiteCruiseScout#238). The gfs-wind GitHub Action publishes the file every
// 6 h as the release asset below; this route mirrors it from memory, precompressed, with
// CORS and 1 h caching. Deliberately not Supabase Storage (egress quota, July 2026).
// If GitHub is unreachable the last good copy keeps being served; consumers judge
// freshness by header.staleAfter inside the file.
export const dynamic = 'force-dynamic';

const SRC = process.env.WIND_DATA_URL
  ?? 'https://github.com/0xAaronx0/KiteScout/releases/download/wind-data/gfs-10m-latest.json.gz';
const RECHECK_MS = 10 * 60_000;
const RETRY_MS = 60_000;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
};

interface Cached { gz: Buffer; json: Buffer | null; etag: string; generatedAt: string; nextCheck: number }
let cache: Cached | null = null;
let inflight: Promise<void> | null = null;

async function load(): Promise<void> {
  const gz = SRC.startsWith('file:')
    ? await readFile(new URL(SRC))
    : await fetch(SRC, { cache: 'no-store', signal: AbortSignal.timeout(20_000) }).then(async r => {
      if (!r.ok) throw new Error(`wind source HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    });
  const data = JSON.parse(gunzipSync(gz).toString('utf8'));
  const h = Array.isArray(data) && data.length === 2 ? data[0]?.header : null;
  if (!h?.refTime || !h?.generatedAt || !Array.isArray(data[0].data)) throw new Error('wind source is not a leaflet-velocity file');
  // never go backwards (e.g. a CDN edge still holding the previous asset)
  if (cache && Date.parse(h.generatedAt) <= Date.parse(cache.generatedAt)) {
    cache.nextCheck = Date.now() + RECHECK_MS;
    return;
  }
  cache = {
    gz, json: null, generatedAt: h.generatedAt, nextCheck: Date.now() + RECHECK_MS,
    etag: `"${createHash('sha1').update(gz).digest('hex').slice(0, 20)}"`,
  };
}

async function current(): Promise<Cached | null> {
  if (!cache || Date.now() >= cache.nextCheck) {
    inflight ??= load()
      .catch(err => {
        console.error('[wind] refresh failed, serving last good copy', err);
        if (cache) cache.nextCheck = Date.now() + RETRY_MS;
      })
      .finally(() => { inflight = null; });
    // first request ever waits; later ones are served from cache while it refreshes
    if (!cache) await inflight;
  }
  return cache;
}

export async function GET(req: Request) {
  const c = await current();
  if (!c) {
    return Response.json({ error: 'wind data not available yet' }, { status: 503, headers: { ...CORS, 'Cache-Control': 'no-store' } });
  }
  const headers: Record<string, string> = {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
    'Vary': 'Accept-Encoding',
    'ETag': c.etag,
    'Last-Modified': new Date(c.generatedAt).toUTCString(),
  };
  if (req.headers.get('if-none-match') === c.etag) return new Response(null, { status: 304, headers });
  if (/\bgzip\b/.test(req.headers.get('accept-encoding') ?? '')) {
    return new Response(new Uint8Array(c.gz), { headers: { ...headers, 'Content-Encoding': 'gzip' } });
  }
  c.json ??= gunzipSync(c.gz);
  return new Response(new Uint8Array(c.json), { headers });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
