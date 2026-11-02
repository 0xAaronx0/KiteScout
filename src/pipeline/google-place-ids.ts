// Google place IDs for operators (Aaron 2026-10-31, KCS#607 option 1). KCS fetches a Google rating live through
// the Places API on the listing detail page; this job only finds and stores the place ID, which Google allows to
// keep indefinitely. Rating and review count are never requested here and never stored.
//
// Input: operators whose stored google_url names a Maps place ("/maps/place/<name>/@lat,lng,zoom"). One Places
// Text Search per operator (field mask: id, displayName, location = Text Search Pro, within Google's monthly free
// usage at our size), biased to that location. A candidate is accepted only when its name shares a token with the
// operator's name/domain and it lies near the known location; otherwise the operator stays unmatched.
//   pnpm cli google-place-ids --dry-run --out f.json   search, write only the file (for review)
//   pnpm cli google-place-ids --apply f.json           write exactly that reviewed file (google_place_id + matched_at)
import { supabase } from '../lib/supabase.js';

export type MapsPlace = { name: string; lat: number; lng: number; zoom: number };
export type PlaceCandidate = { id: string; displayName: string; lat: number; lng: number };
export type PlaceIdResult = { table: 'cruise_providers' | 'providers'; id: string; name: string; domain: string;
  googleUrl: string; placeId: string | null; displayName: string | null; distanceM: number | null; note: string };

const PLACE_ID = /^[A-Za-z0-9_-]{16,255}$/;

/** Place name and camera position of a stored Maps place URL; null for anything else. */
export function mapsPlace(url: string | null | undefined): MapsPlace | null {
  const m = url?.match(/^https:\/\/www\.google\.[a-z.]+\/maps\/place\/([^/@?]+)\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/);
  if (!m) return null;
  let name: string;
  try { name = decodeURIComponent(m[1].replace(/\+/g, ' ')).trim(); } catch { return null; }
  return name ? { name, lat: Number(m[2]), lng: Number(m[3]), zoom: Number(m[4]) } : null;
}

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
// Words every kite business shares prove nothing about identity ("Kite Beach Cafe" next to "Kite Charters").
const GENERIC = new Set(['kite', 'kites', 'kitesurf', 'kitesurfing', 'kiteboarding', 'kiteboard', 'wing', 'foil', 'surf', 'surfing', 'windsurf',
  'camp', 'camps', 'school', 'beach', 'hotel', 'resort', 'lodge', 'house', 'center', 'centre', 'club', 'tours', 'tour', 'trip', 'trips',
  'cruise', 'cruises', 'charter', 'safari', 'village', 'villa', 'villas', 'apartments', 'hostel', 'guesthouse', 'sports', 'watersports']);
const tokens = (text: string) => text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').split(/[^a-z0-9]+/)
  .filter(t => t.length >= 4 && !GENERIC.has(t));

/** The nearest candidate that shares a name token with the operator and lies within reach of the known location.
 *  A place URL at zoom >= 15 marks the place itself (1 km); a zoomed-out one only the area (25 km). */
export function pickPlace(provider: { name: string | null; root_domain: string }, at: MapsPlace, candidates: PlaceCandidate[]): (PlaceCandidate & { distanceM: number }) | null {
  const own = new Set(tokens(`${provider.name ?? ''} ${provider.root_domain.replace(/\.[a-z.]+$/, '')}`));
  const reach = at.zoom >= 15 ? 1_000 : 25_000;
  return candidates
    .filter(c => PLACE_ID.test(c.id) && tokens(c.displayName).some(t => own.has(t) || [...own].some(o => o.includes(t) || t.includes(o))))
    .map(c => ({ ...c, distanceM: Math.round(distanceM(at, c)) }))
    .filter(c => c.distanceM <= reach)
    .sort((x, y) => x.distanceM - y.distanceM)[0] ?? null;
}

export function placeIdPatch(placeId: string, matchedAt: string) {
  if (!PLACE_ID.test(placeId)) throw new Error(`not a place ID: ${placeId}`);
  return { google_place_id: placeId, google_place_matched_at: matchedAt };
}

async function searchPlaces(query: string, at: MapsPlace, key: string): Promise<PlaceCandidate[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.displayName,places.location' },
    body: JSON.stringify({ textQuery: query, maxResultCount: 5,
      locationBias: { circle: { center: { latitude: at.lat, longitude: at.lng }, radius: at.zoom >= 15 ? 1_000 : 25_000 } } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Places Text Search ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json() as { places?: Array<{ id?: string; displayName?: { text?: string }; location?: { latitude?: number; longitude?: number } }> };
  return (body.places ?? []).flatMap(p => p.id && p.displayName?.text && typeof p.location?.latitude === 'number' && typeof p.location.longitude === 'number'
    ? [{ id: p.id, displayName: p.displayName.text, lat: p.location.latitude, lng: p.location.longitude }] : []);
}

/** Search only; nothing is written. Operators that already have a place ID are skipped. */
export async function runGooglePlaceIdsDryRun(opts: { limit?: number } = {}): Promise<PlaceIdResult[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY is not set; the place ID search needs a Places API (New) key.');
  const targets: Array<{ table: PlaceIdResult['table']; id: string; name: string | null; root_domain: string; google_url: string }> = [];
  for (const table of ['cruise_providers', 'providers'] as const) {
    const { data, error } = await supabase.from(table).select('id, name, root_domain, google_url, status')
      .not('google_url', 'is', null).is('google_place_id', null).not('status', 'in', '(dead,duplicate)');
    if (error) throw new Error(`${table}: ${error.message}`);
    targets.push(...(data ?? []).map(row => ({ table, id: row.id as string, name: row.name as string | null, root_domain: row.root_domain as string, google_url: row.google_url as string })));
  }
  const picked = opts.limit ? targets.slice(0, opts.limit) : targets;
  const results: PlaceIdResult[] = [];
  for (const t of picked) {
    const base = { table: t.table, id: t.id, name: t.name ?? t.root_domain, domain: t.root_domain, googleUrl: t.google_url };
    const at = mapsPlace(t.google_url);
    if (!at) { results.push({ ...base, placeId: null, displayName: null, distanceM: null, note: 'no place name/position in google_url' }); continue; }
    try {
      const hit = pickPlace(t, at, await searchPlaces(at.name, at, key));
      results.push({ ...base, placeId: hit?.id ?? null, displayName: hit?.displayName ?? null, distanceM: hit?.distanceM ?? null,
        note: hit ? `name + ${hit.distanceM} m from the stored Maps position (zoom ${at.zoom})` : 'no candidate with a shared name nearby' });
    } catch (error) {
      results.push({ ...base, placeId: null, displayName: null, distanceM: null, note: `error: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return results;
}

/** Writes a reviewed dry-run file: only rows with a place ID, only while the row has none yet. */
export async function applyGooglePlaceIds(results: PlaceIdResult[]): Promise<{ written: number; skipped: number }> {
  const matchedAt = new Date().toISOString();
  let written = 0, skipped = 0;
  for (const r of results.filter(x => x.placeId)) {
    const { data, error } = await supabase.from(r.table).update(placeIdPatch(r.placeId!, matchedAt)).eq('id', r.id).is('google_place_id', null).select('id');
    if (error) throw new Error(`${r.table} ${r.domain}: ${error.message}`);
    if ((data ?? []).length === 1) written++; else skipped++;
  }
  return { written, skipped };
}
