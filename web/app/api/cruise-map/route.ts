import { buildCruiseMapData } from '@/lib/cruise-map';

// GeoJSON feed for the standalone Cruise World Map (map.kitescout.tech), which
// fetches this on load. Served cross-origin (the map is a different subdomain),
// so it carries permissive CORS headers. Runs per request so newly extracted
// offers appear without regenerating or redeploying the map.
export const dynamic = 'force-dynamic';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export async function GET() {
  try {
    const data = await buildCruiseMapData();
    return Response.json(data, {
      headers: {
        ...CORS,
        // Light caching so rapid reloads don't re-query; still effectively live.
        'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (err) {
    console.error('[cruise-map] failed to build map data', err);
    return Response.json({ error: 'failed to build cruise map' }, { status: 500, headers: CORS });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
