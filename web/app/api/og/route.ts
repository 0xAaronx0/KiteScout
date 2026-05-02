import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ imageUrl: null });

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
      // Social crawler UA — many sites only serve og:image to crawlers
      headers: { 'User-Agent': 'facebookexternalhit/1.1' },
    });
    if (!res.ok) return NextResponse.json({ imageUrl: null });

    const html = await res.text();

    const match =
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html) ??
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html);

    let imageUrl = match?.[1] ?? null;

    // Resolve protocol-relative and root-relative URLs
    if (imageUrl) {
      if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
      else if (imageUrl.startsWith('/')) imageUrl = new URL(url).origin + imageUrl;
    }

    return NextResponse.json(
      { imageUrl },
      { headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' } },
    );
  } catch {
    return NextResponse.json({ imageUrl: null });
  }
}
