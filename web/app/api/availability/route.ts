import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import type { AvailabilityResult } from '../../../lib/types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// In-memory cache keyed by "domain|location"
const CACHE = new Map<string, AvailabilityResult>();

const NOT_FOUND: AvailabilityResult = { found: false };

// Find the most relevant pages on the provider's own domain for booking info.
async function tavilySearchUrls(query: string, domain: string, n: number): Promise<string[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        include_domains: [domain],
        search_depth: 'advanced',
        max_results: n,
      }),
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { results?: Array<{ url: string }> };
    return (data?.results ?? []).map(r => r.url).filter(Boolean);
  } catch { return []; }
}

// Pull readable content from up to a few URLs in one Tavily extract call.
async function tavilyExtract(urls: string[]): Promise<{ url: string; content: string }[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key || !urls.length) return [];
  try {
    const res = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, urls }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { results?: Array<{ url: string; raw_content: string }> };
    return (data?.results ?? [])
      .filter(r => r.raw_content)
      .map(r => ({ url: r.url, content: r.raw_content }));
  } catch { return []; }
}

// Last resort: fetch + strip a single page directly.
async function fetchDirect(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'facebookexternalhit/1.1' },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get('domain');
  const location = req.nextUrl.searchParams.get('location') ?? '';

  if (!domain) return NextResponse.json(NOT_FOUND);

  const cacheKey = `${domain}|${location}`;
  if (CACHE.has(cacheKey)) return NextResponse.json(CACHE.get(cacheKey));

  // 1) Find booking/schedule/price pages on the provider's site.
  const query = `${location} kite cruise liveaboard dates schedule prices booking cabin availability`.trim();
  const urls = await tavilySearchUrls(query, domain, 4);

  // 2) Extract content from the top pages (plus the homepage as a backstop).
  const targets = Array.from(new Set([...urls.slice(0, 3), `https://${domain}`]));
  let pages = await tavilyExtract(targets);
  if (!pages.length) {
    const direct = await fetchDirect(`https://${domain}`);
    if (direct) pages = [{ url: `https://${domain}`, content: direct }];
  }
  if (!pages.length) {
    CACHE.set(cacheKey, NOT_FOUND);
    return NextResponse.json(NOT_FOUND);
  }

  // Combine page text (label each so Claude can cite the source URL).
  const combined = pages
    .map(p => `=== PAGE: ${p.url} ===\n${p.content.slice(0, 8000)}`)
    .join('\n\n')
    .slice(0, 20000);

  // 3) Extract structured availability with Claude.
  const prompt = `You are extracting LIVE booking availability for a kite cruise / liveaboard${location ? ` in "${location}"` : ''} from the provider's own website content below.

Only report facts that are actually stated in the content. Do NOT invent dates, prices, or capacity. Leave a field null/empty if it is not stated.

Return strict JSON only — no markdown, no prose:
{
  "found": true or false,
  "places": total number of guest places/berths on the boat (integer) or null,
  "cabins": number of cabins (integer) or null,
  "departures": [
    { "dates": "human-readable date or range exactly as shown, e.g. '12 – 19 Jul 2026' or 'April – October'", "price": "price with currency if shown for this departure, else null", "spotsLeft": integer remaining places if shown else null }
  ],
  "pricePerPerson": "price per person with currency, e.g. '€1,290', or null",
  "pricePerCabin": "price per cabin with currency, or null",
  "priceWholeBoat": "price to charter the whole boat with currency, or null",
  "bookingOptions": ["which booking units are offered, any of: 'per person', 'cabin', 'whole boat'"],
  "sourceUrl": "the PAGE url (from the '=== PAGE: ... ===' markers) where most of this info was found, or null"
}

Set "found" to true if you found ANY concrete availability, price, or capacity. Set it to false only if the content has none of these. Keep "departures" to the most relevant 4 at most.

Website content:
${combined}`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const result = JSON.parse(json) as AvailabilityResult;
    CACHE.set(cacheKey, result);
    // Cache for 10 days (availability/pricing changes slowly).
    return NextResponse.json(result, { headers: { 'Cache-Control': 'public, max-age=864000' } });
  } catch {
    CACHE.set(cacheKey, NOT_FOUND);
    return NextResponse.json(NOT_FOUND);
  }
}
