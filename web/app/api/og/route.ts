import { NextRequest, NextResponse } from 'next/server';

const CACHE: Record<string, string> = {};

export async function GET(req: NextRequest) {
  const location = req.nextUrl.searchParams.get('location'); // e.g. "Dakhla, Morocco"

  if (!location) return NextResponse.json({ spotImageUrl: null });

  if (CACHE[location]) {
    return NextResponse.json(
      { spotImageUrl: CACHE[location] },
      { headers: { 'Cache-Control': 'public, max-age=86400' } },
    );
  }

  // Use Unsplash source to get a real photo URL for the kite spot.
  // Following the redirect gives a stable images.unsplash.com CDN URL.
  const keywords = encodeURIComponent(`kitesurfing kite ${location}`);
  const sourceUrl = `https://source.unsplash.com/featured/800x500/?${keywords}`;

  try {
    const res = await fetch(sourceUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    });

    const spotImageUrl = res.ok && res.url !== sourceUrl ? res.url : null;
    if (spotImageUrl) CACHE[location] = spotImageUrl;

    return NextResponse.json(
      { spotImageUrl },
      { headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' } },
    );
  } catch {
    return NextResponse.json({ spotImageUrl: null });
  }
}
