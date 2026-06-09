import pLimit from 'p-limit';
import { supabase } from '../lib/supabase.js';
import { anthropic, ANALYSIS_MODEL } from '../lib/anthropic.js';
import { extract as tavilyExtract, search as tavilySearch } from '../lib/tavily.js';
import { withRetry } from '../lib/retry.js';

const CONCURRENCY = 3;
const MAX_CONTENT_CHARS = 16000;
const NOMINATIM_DELAY_MS = 1200;

interface CruiseLocation {
  country: string;
  region: string | null;
  spot_name: string | null;
  confidence: 'high' | 'medium' | 'low';
  notes: string | null;
}

const EXTRACTION_PROMPT = `You are analyzing website content for a kite cruise operator.

Your ONLY task is to extract locations where this provider offers KITE CRUISES or kite liveaboards.

A kite cruise = participants travel by boat (catamaran, gulet, sailing yacht, dhow, etc.) between kiteboarding spots, typically sleeping on board, over multiple days.

INCLUDE locations that are explicitly part of a cruise/liveaboard itinerary.

DO NOT include:
- Land-based kite camps, kite schools, or kite lessons at a fixed base
- Day trips that return to the same harbour each night
- Locations mentioned only as "we've kited all over the world" with no specific cruise offering
- Locations for non-cruise trip types the provider also happens to offer

For each cruise location found, extract:
{
  "country": "Country name",
  "region": "Region or island group, or null",
  "spot_name": "Named kite spot or anchorage, or null",
  "confidence": "high" | "medium" | "low",
  "notes": "Brief supporting evidence from the text, e.g. 'Grenadines circuit Nov-Apr' — or null"
}

Confidence guide:
- high: site explicitly names this as a cruise / liveaboard route or destination
- medium: context strongly implies a multi-day boat trip visiting this spot
- low: inferred from partial information

Respond with ONLY a JSON array. If no cruise locations are found, respond with [].`;

// ---------------------------------------------------------------------------
// Geocode a single location via Nominatim (respects 1 req/s rate limit)
// ---------------------------------------------------------------------------
const geocodeCache = new Map<string, { lat: number; lng: number } | null>();

async function geocode(
  spot_name: string | null,
  region: string | null,
  country: string,
): Promise<{ lat: number; lng: number } | null> {
  const query = [spot_name, region, country].filter(Boolean).join(', ');
  if (geocodeCache.has(query)) return geocodeCache.get(query)!;

  await new Promise(r => setTimeout(r, NOMINATIM_DELAY_MS));

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'KiteScout/1.0 kite-cruise-map' } });
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (data[0]) {
      const coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      geocodeCache.set(query, coords);
      return coords;
    }
    // Fallback to country only
    if (spot_name || region) {
      const url2 = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(country)}&format=json&limit=1`;
      await new Promise(r => setTimeout(r, NOMINATIM_DELAY_MS));
      const res2 = await fetch(url2, { headers: { 'User-Agent': 'KiteScout/1.0 kite-cruise-map' } });
      const data2 = (await res2.json()) as Array<{ lat: string; lon: string }>;
      if (data2[0]) {
        const coords = { lat: parseFloat(data2[0].lat), lng: parseFloat(data2[0].lon) };
        geocodeCache.set(query, coords);
        return coords;
      }
    }
  } catch {
    // geocode failure is non-fatal
  }

  geocodeCache.set(query, null);
  return null;
}

// ---------------------------------------------------------------------------
// Fetch and combine content for a single cruise provider
// ---------------------------------------------------------------------------
async function fetchProviderContent(
  websiteUrl: string,
  name: string,
  rootDomain: string,
): Promise<string> {
  const parts: string[] = [];

  // 1. Extract homepage
  const homepage = await tavilyExtract(websiteUrl);
  if (homepage) parts.push(`=== Homepage (${websiteUrl}) ===\n${homepage}`);

  // 2. Search for cruise/trip-specific pages
  const searchQuery = `"${name}" kite cruise sailing itinerary destinations route`;
  const searchResults = await tavilySearch(searchQuery, 5, []);
  const cruisePageUrls = searchResults
    .filter(r => {
      try { return new URL(r.url).hostname.replace(/^www\./, '') === rootDomain; }
      catch { return false; }
    })
    .slice(0, 2)
    .map(r => r.url);

  if (cruisePageUrls.length > 0) {
    const cruiseContent = await tavilyExtract(cruisePageUrls);
    if (cruiseContent) parts.push(`=== Cruise pages ===\n${cruiseContent}`);
  }

  // 3. If homepage was thin, also try /cruises and /trips
  if ((homepage?.length ?? 0) < 2000) {
    const fallbackPages = [`https://${rootDomain}/cruises`, `https://${rootDomain}/trips`];
    const fallback = await tavilyExtract(fallbackPages);
    if (fallback) parts.push(`=== /cruises or /trips page ===\n${fallback}`);
  }

  return parts.join('\n\n').slice(0, MAX_CONTENT_CHARS);
}

// ---------------------------------------------------------------------------
// Extract cruise locations from combined content via Claude
// ---------------------------------------------------------------------------
async function extractLocations(
  content: string,
  providerName: string,
  websiteUrl: string,
): Promise<CruiseLocation[]> {
  if (!content.trim()) return [];

  let text: string;
  try {
    const msg = await withRetry(() =>
      anthropic.messages.create({
        model: ANALYSIS_MODEL,
        max_tokens: 1024,
        system: [{ type: 'text', text: EXTRACTION_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{
          role: 'user',
          content: `Provider: ${providerName}\nWebsite: ${websiteUrl}\n\nContent:\n${content}`,
        }],
      }),
    );
    text = msg.content[0].type === 'text' ? msg.content[0].text : '';
  } catch (err) {
    console.error(`  Claude error for ${websiteUrl}:`, err);
    return [];
  }

  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (l): l is CruiseLocation =>
        typeof l.country === 'string' &&
        ['high', 'medium', 'low'].includes(l.confidence),
    );
  } catch {
    console.error(`  JSON parse failed for ${websiteUrl}:`, json.slice(0, 200));
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export async function runExtractCruiseLocations(): Promise<{
  providers: number;
  locations: number;
}> {
  const { data: cruiseProviders, error } = await supabase
    .from('cruise_providers')
    .select('id, provider_id, name, root_domain, website_url')
    .in('status', ['new', 'verified']);

  if (error) throw error;
  if (!cruiseProviders || cruiseProviders.length === 0) {
    console.log('No cruise providers found.');
    return { providers: 0, locations: 0 };
  }

  console.log(`Processing ${cruiseProviders.length} cruise providers…`);

  const limit = pLimit(CONCURRENCY);
  let done = 0;
  let totalLocations = 0;

  await Promise.all(
    cruiseProviders.map(cp =>
      limit(async () => {
        const url = cp.website_url ?? `https://${cp.root_domain}`;
        const name = cp.name ?? cp.root_domain;

        // Fetch and combine page content
        const content = await fetchProviderContent(url, name, cp.root_domain);

        // Extract cruise-only locations via Claude
        const locations = await extractLocations(content, name, url);

        if (locations.length === 0) {
          done++;
          process.stdout.write(`\r  ${done}/${cruiseProviders.length} done  (${totalLocations} locations found)`);
          return;
        }

        // Geocode each location
        const withCoords = await Promise.all(
          locations.map(async loc => {
            const coords = await geocode(loc.spot_name ?? null, loc.region ?? null, loc.country);
            return { ...loc, lat: coords?.lat ?? null, lng: coords?.lng ?? null };
          }),
        );

        // Upsert into cruise_locations (skip duplicates)
        const rows = withCoords.map(loc => ({
          cruise_provider_id: cp.id,
          country: loc.country,
          region: loc.region ?? null,
          spot_name: loc.spot_name ?? null,
          lat: loc.lat,
          lng: loc.lng,
          confidence: loc.confidence,
          notes: loc.notes ?? null,
        }));

        const { error: insertErr } = await supabase
          .from('cruise_locations')
          .upsert(rows, { onConflict: 'cruise_provider_id,country,region,spot_name', ignoreDuplicates: true });

        if (insertErr) {
          console.error(`\n  DB error for ${cp.root_domain}:`, insertErr.message);
        } else {
          totalLocations += rows.length;
        }

        done++;
        process.stdout.write(`\r  ${done}/${cruiseProviders.length} done  (${totalLocations} locations found)`);
      }),
    ),
  );

  console.log();
  return { providers: cruiseProviders.length, locations: totalLocations };
}
