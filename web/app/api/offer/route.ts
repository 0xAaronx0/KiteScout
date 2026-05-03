import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import type { OfferResult } from '../../../lib/types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// In-memory cache keyed by "domain|location|tripType"
const CACHE = new Map<string, OfferResult>();

const TRIP_TYPE_LABELS: Record<string, string> = {
  camp: 'kite camp', safari: 'kite safari', cruise: 'kite cruise',
  tour: 'kite tour', school: 'kite school', lessons: 'kite lessons',
  rental: 'kite rental', equipment_rental: 'kite equipment rental', snowkite: 'snowkite',
};

async function tavilySearch(query: string, domain: string): Promise<string | null> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        include_domains: [domain],
        search_depth: 'basic',
        max_results: 3,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { results?: Array<{ url: string }> };
    return data?.results?.[0]?.url ?? null;
  } catch { return null; }
}

async function tavilyExtract(url: string): Promise<string | null> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, urls: [url] }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { results?: Array<{ raw_content: string }> };
    return data?.results?.[0]?.raw_content ?? null;
  } catch { return null; }
}

async function fetchDirect(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'facebookexternalhit/1.1' },
      signal: AbortSignal.timeout(6000),
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
  const location = req.nextUrl.searchParams.get('location');
  const tripType = req.nextUrl.searchParams.get('tripType') ?? '';

  if (!domain || !location) return NextResponse.json({ found: false });

  const cacheKey = `${domain}|${location}|${tripType}`;
  if (CACHE.has(cacheKey)) return NextResponse.json(CACHE.get(cacheKey));

  const tripLabel = TRIP_TYPE_LABELS[tripType] ?? tripType;

  // Step 1: find the most relevant page on this domain for the search
  const searchQuery = `${location} ${tripLabel}`;
  let pageUrl = await tavilySearch(searchQuery, domain);

  // Step 2: extract content from that page (fall back to homepage)
  const targetUrl = pageUrl ?? `https://${domain}`;
  let content = await tavilyExtract(targetUrl);
  if (!content) content = await fetchDirect(targetUrl);
  if (!content) {
    CACHE.set(cacheKey, { found: false });
    return NextResponse.json({ found: false });
  }

  // Step 3: extract the specific offer with Claude Haiku
  const prompt = `The user is looking for: "${tripLabel}" in "${location}".

From the page content below, find the MOST RELEVANT matching offer.

Return strict JSON only — no markdown, no prose:
{
  "found": true or false,
  "offerName": "specific package or camp name, or null",
  "price": "price with currency and unit e.g. '€1,290 / week' or 'from $800', or null",
  "dates": "availability e.g. 'April – October' or 'year-round', or null",
  "highlights": ["up to 3 short bullet points about this specific offer"],
  "directUrl": "full URL of the specific offer page if visible in the content, or null"
}

Set found=false if no offer matching "${location}" and "${tripLabel}" is found.

Page URL: ${targetUrl}
Page content (truncated):
${content.slice(0, 12000)}`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const result = JSON.parse(json) as OfferResult;
    CACHE.set(cacheKey, result);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'public, max-age=3600' } });
  } catch {
    CACHE.set(cacheKey, { found: false });
    return NextResponse.json({ found: false });
  }
}
