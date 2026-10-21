// ---------------------------------------------------------------------------
// Shared Nominatim geocoding for the cruise pipelines (extract-cruise-offers,
// extract-cruise-locations). One throttle, one cache, one circuit breaker —
// the hardened design that replaced the silent-catch geocode() after runs
// geocoded 0/n spots: warn-logged failures, retry with backoff on 429/5xx,
// and "no result" is only cached for genuine empty responses, never for
// failed requests.
// ---------------------------------------------------------------------------

const NOMINATIM_DELAY_MS = 1200;

const geocodeCache = new Map<string, { lat: number; lng: number } | null>();

// When Nominatim itself is unreachable or blocking (as opposed to returning
// "no result"), stop calling it after a few consecutive request failures so a
// long run doesn't burn minutes on doomed lookups.
const GEOCODE_MAX_FAIL_STREAK = 5;
let geocodeFailStreak = 0;

// Callers geocode concurrently (Promise.all over a provider's locations,
// pLimit'd providers) — serialize the actual requests so bursts can't exceed
// Nominatim's 1 req/s policy or blow through the fail streak in one blip.
let nominatimQueue: Promise<void> = Promise.resolve();

type NominatimHit = { lat: string; lon: string; class?: string; type?: string; addresstype?: string; display_name?: string };

/**
 * One throttled Nominatim request.
 * Returns hits, [] for a genuine "no result", or null when the REQUEST failed
 * (network error / non-2xx) — callers must not cache null as "no result".
 */
function nominatimSearch(query: string): Promise<NominatimHit[] | null> {
  const run = nominatimQueue.then(async (): Promise<NominatimHit[] | null> => {
    if (geocodeFailStreak >= GEOCODE_MAX_FAIL_STREAK) return null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      await new Promise(r => setTimeout(r, NOMINATIM_DELAY_MS));
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=3&accept-language=en`;
        const res = await fetch(url, { headers: { 'User-Agent': 'KiteScout/1.0 kite-cruise-map' } });
        if (res.ok) {
          const hits = (await res.json()) as NominatimHit[];
          geocodeFailStreak = 0;
          return hits;
        }
        const retryable = res.status === 429 || res.status >= 500;
        console.warn(`  ! geocode HTTP ${res.status} for "${query}"${attempt === 1 && retryable ? ' — backing off 10s, retrying' : ''}`);
        if (attempt === 1 && retryable) {
          await new Promise(r => setTimeout(r, 10_000));
          continue;
        }
      } catch (err) {
        const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : '';
        console.warn(`  ! geocode request failed for "${query}": ${err instanceof Error ? err.message : err}${cause}${attempt === 1 ? ' — retrying' : ''}`);
        if (attempt === 1) continue;
      }
      break;
    }
    geocodeFailStreak++;
    if (geocodeFailStreak === GEOCODE_MAX_FAIL_STREAK) {
      console.warn(`  ! geocode: ${GEOCODE_MAX_FAIL_STREAK} consecutive request failures — Nominatim unreachable or blocking; skipping geocoding for the rest of this run`);
    }
    return null;
  });
  nominatimQueue = run.then(() => undefined, () => undefined);
  return run;
}

// Recurring transliteration variants OSM doesn't know under the spelling the
// provider sites use (Red Sea kite-safari anchorages appear on several sites).
// Values are the OSM-known spelling — Nominatim stays the coordinate source.
const SPOT_NAME_ALIASES: Record<string, string> = {
  'geysum': 'Geisum',
  'geysum süd': 'South Geisum',
  'geysum sued': 'South Geisum',
  'geysum south': 'South Geisum',
  'geysum nord': 'North Geisum',
  'geysum north': 'North Geisum',
  'abu mungar': 'Abu Minqar Island',
  'abu mongar': 'Abu Minqar Island',
  // OSM names the Dakhla lagoon "Golfe du Dakhla" (natural=bay), findable as
  // "Dakhla Bay" — "Dakhla Lagoon" matches nothing.
  'dakhla lagoon': 'Dakhla Bay',
  'dakhla lagune': 'Dakhla Bay',
  'lagune de dakhla': 'Dakhla Bay',
};

/**
 * Spot names as extracted often carry decorations OSM doesn't know:
 * "Ngezi / Kigomasha (Wild North)" or "Geysum Süd". Strip parentheticals,
 * keep the first slash-alternative, drop directional/marina suffix words.
 */
function simplifySpotName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s*[/|]\s*|\s+&\s+/)[0]!
    .replace(/\b(Süd|Sued|Nord|Ost|West|South|North|East|Marina)\b\.?/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();
}

// The region-less fallback query invites homonyms elsewhere in the country
// ("Ashrafi, Egypt" → a Cairo mosque; "Ngezi, Tanzania" → an inland village
// near Arusha). Only trust such a hit when it looks coastal/maritime by OSM
// type, or when its display_name still mentions the region we dropped from
// the query — a wrong inland pin is worse than no pin (map landlocks).
const COASTAL_TYPES = new Set([
  'island', 'islet', 'archipelago', 'atoll', 'reef', 'bay', 'beach', 'cape',
  'peninsula', 'strait', 'lagoon', 'shoal', 'coastline', 'harbour', 'marina',
  'anchorage', 'quay',
]);

// Generic geography words that would make region-token matching meaningless.
const REGION_TOKEN_STOPWORDS = new Set([
  'island', 'islands', 'islas', 'isla', 'archipelago', 'atoll', 'coast',
  'gulf', 'north', 'south', 'east', 'west', 'northern', 'southern', 'eastern',
  'western', 'upper', 'lower', 'grand', 'great',
]);

function regionTokens(region: string | null): string[] {
  if (!region) return [];
  return region
    .split(/[^\p{L}]+/u)
    .filter(t => t.length >= 4 && !REGION_TOKEN_STOPWORDS.has(t.toLowerCase()));
}

function pickHit(hits: NominatimHit[], strictOpts: { region: string | null } | null): { lat: number; lng: number } | null {
  let usable = hits;
  if (strictOpts) {
    const tokens = regionTokens(strictOpts.region).map(t => t.toLowerCase());
    usable = hits.filter(h =>
      (h.type && COASTAL_TYPES.has(h.type)) ||
      h.class === 'water' || h.class === 'waterway' ||
      (h.display_name && tokens.some(t => h.display_name!.toLowerCase().includes(t)))
    );
  }
  const hit = preferPopulatedPlace(usable);
  return hit ? { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) } : null;
}

// Nominatim often ranks a municipality boundary first, and its centroid sits
// far inland of the town it is named after ("Riohacha, La Guajira" 34 km,
// "Máncora, Piura" 7 km, "Sidi Kaouki" 7 km; inland-pin audit 2026-10-19).
// When the top hit is an administrative boundary, prefer from the same answer:
// a place node for the town, else the top boundary if it is the settlement
// itself (addresstype suburb/village, e.g. Cumbuco), else a beach, else a
// boundary that is the town (city/town/village) over a county one. A
// city_district is no substitute: in Rio Grande do Norte the municipality hit
// sits on the town and the district centroid 12-23 km inland. Alternatives
// must lie 5-50 km from the top hit: nearer, the boundary centroid is as good
// as the village node (Taíba, Gülbahçe, Sabaki: 2-3 km, coast distance mixed);
// farther, it is a namesake elsewhere.
const POPULATED_TYPES = new Set([
  'city', 'town', 'village', 'hamlet', 'suburb', 'city_district', 'borough',
  'neighbourhood', 'quarter', 'locality', 'isolated_dwelling',
]);
const TOWN_TYPES = new Set(['city', 'town', 'village', 'hamlet']);
const PREFER_MIN_KM = 5;
const PREFER_MAX_KM = 50;

function kmBetween(a: NominatimHit, b: NominatimHit): number {
  const rad = Math.PI / 180;
  const dLat = (parseFloat(b.lat) - parseFloat(a.lat)) * rad;
  const dLng = (parseFloat(b.lon) - parseFloat(a.lon)) * rad;
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(parseFloat(a.lat) * rad) * Math.cos(parseFloat(b.lat) * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}

function preferPopulatedPlace(hits: NominatimHit[]): NominatimHit | undefined {
  const top = hits[0];
  if (!top || top.class !== 'boundary') return top;
  const near = hits.slice(1).filter(h => { const km = kmBetween(top, h); return km >= PREFER_MIN_KM && km <= PREFER_MAX_KM; });
  const settlement = (t?: string) => !!t && POPULATED_TYPES.has(t);
  // Máncora / Sidi Kaouki: the municipality says addresstype "city" too, so a
  // place node beats any boundary.
  return near.find(h => h.class === 'place' && settlement(h.type))
    ?? (settlement(top.addresstype) ? top : undefined)
    ?? near.find(h => h.type === 'beach')
    ?? near.find(h => h.class === 'boundary' && !!h.addresstype && TOWN_TYPES.has(h.addresstype))
    ?? top;
}

/**
 * Geocode a named spot, falling back to progressively simpler queries.
 */
export async function geocodeSpot(
  name: string,
  region: string | null,
  country: string | null,
): Promise<{ lat: number; lng: number } | null> {
  if (!name.trim()) return null;
  const cacheKey = [name, region, country].join('|');
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey)!;

  const simplified = simplifySpotName(name);
  // With region+country in the query, homonyms are unlikely — accept any hit
  // (the right feature is often mapped as a school/neighbourhood/building).
  // The region-less fallback only trusts coastal or region-confirmed hits.
  const ladder: Array<{ q: string; strict: boolean }> = [
    { q: [name, region, country].filter(Boolean).join(', '), strict: false },
  ];
  if (simplified && simplified !== name) {
    ladder.push({ q: [simplified, region, country].filter(Boolean).join(', '), strict: false });
  }
  if (region) {
    ladder.push({ q: [simplified || name, country].filter(Boolean).join(', '), strict: true });
  }
  // Raw name first — a directional alias ("geysum süd") must win over the
  // simplified one ("geysum"), whose direction was already stripped.
  const alias = SPOT_NAME_ALIASES[name.trim().toLowerCase()] ?? SPOT_NAME_ALIASES[simplified.toLowerCase()];
  if (alias) {
    ladder.push({ q: [alias, region, country].filter(Boolean).join(', '), strict: false });
    ladder.push({ q: [alias, country].filter(Boolean).join(', '), strict: true });
  }

  const seen = new Set<string>();
  let requestFailed = false;
  for (const { q, strict } of ladder) {
    if (seen.has(q)) continue;
    seen.add(q);
    const hits = await nominatimSearch(q);
    if (hits === null) { requestFailed = true; break; }
    const coords = pickHit(hits, strict ? { region } : null);
    if (coords) {
      geocodeCache.set(cacheKey, coords);
      return coords;
    }
  }
  // Only cache a genuine "no result" — a failed request must stay retryable.
  if (!requestFailed) geocodeCache.set(cacheKey, null);
  return null;
}

/**
 * Geocode a cruise_locations row at whatever granularity it has:
 * named spot → region → country. A country-only row resolves to the country's
 * representative point; a named spot or region that cannot be geocoded stays
 * null rather than falling back to the (often inland) country centroid — a
 * wrong pin landlocks the map.
 */
export async function geocodeLocation(
  spot_name: string | null,
  region: string | null,
  country: string,
): Promise<{ lat: number; lng: number } | null> {
  if (spot_name?.trim()) return geocodeSpot(spot_name, region, country);
  if (region?.trim()) return geocodeSpot(region, null, country);

  const query = country.trim();
  if (!query) return null;
  const cacheKey = `country:${query}`;
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey)!;
  const hits = await nominatimSearch(query);
  if (hits === null) return null; // request failed — stay retryable
  const coords = pickHit(hits, null);
  geocodeCache.set(cacheKey, coords);
  return coords;
}
