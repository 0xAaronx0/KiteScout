import { NextRequest, NextResponse } from 'next/server';

const CACHE = new Map<string, { lat: number; lon: number } | null>();

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q');
  if (!q) return NextResponse.json({ lat: null, lon: null });

  if (CACHE.has(q)) {
    const cached = CACHE.get(q);
    return NextResponse.json(cached ?? { lat: null, lon: null },
      { headers: { 'Cache-Control': 'public, max-age=86400' } });
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'KiteScout/1.0 (kite travel finder)' },
      signal: AbortSignal.timeout(4000),
    });
    const data = await res.json() as Array<{ lat: string; lon: string }>;

    if (data?.[0]) {
      const result = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      CACHE.set(q, result);
      return NextResponse.json(result, { headers: { 'Cache-Control': 'public, max-age=86400' } });
    }

    CACHE.set(q, null);
    return NextResponse.json({ lat: null, lon: null });
  } catch {
    return NextResponse.json({ lat: null, lon: null });
  }
}
