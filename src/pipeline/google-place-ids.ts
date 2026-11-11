// Google place IDs for operators (Aaron 2026-10-31, KCS#607 option 1). KCS shows Google reviews live through the
// Places UI Kit on the listing detail page; this job only finds and stores the place ID, which Google allows to keep
// indefinitely. Rating and review count are never requested here and never stored.
//
// Input: active operators whose stored google_url names a Maps place ("/maps/place/<name>/@lat,lng,zoom"). One Places
// Text Search per operator, biased to that position. Field mask: id, displayName, location, formattedAddress. That is
// the Text Search Pro SKU (5,000 free requests a month, checked on Google's pricing page 2026-11-11); places.id alone
// would be the free IDs-only SKU but gives nothing to check a match against.
//
// Every result gets a verdict; only "match" is written by default:
//   match           one candidate shares a non-generic name token with the operator, lies near the stored Maps
//                   position, and lies within OWN_REACH_KM of one of our own positions for that operator
//   check-location  the same, but the place is far from every position we hold (often a head office elsewhere,
//                   e.g. a home kite school running cruises abroad) or we hold none: listed, written only on --accept
//   ambiguous       several different places pass and none carries exactly the stored name: left empty, listed
//   none / error    no passing candidate, no usable link, or a request error: left empty, listed
//
//   pnpm cli google-place-ids [n] [--out f.json] [--max-calls 400]   dry run (default): search, write only the file
//   pnpm cli google-place-ids --apply f.json [--skip d1,d2] [--accept d3]   write that reviewed file, backup first
//   pnpm cli google-place-ids --revert backup.json                 put back what an apply backup recorded
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { supabase } from '../lib/supabase.js';

export type MapsPlace = { name: string; lat: number; lng: number; zoom: number };
export type PlaceCandidate = { id: string; displayName: string; lat: number; lng: number; address?: string | null };
export type Verdict = 'match' | 'check-location' | 'ambiguous' | 'none' | 'error';
export type PlaceTable = 'cruise_providers' | 'providers';
export type PlaceIdResult = { table: PlaceTable; id: string; name: string; domain: string; googleUrl: string;
  placeId: string | null; displayName: string | null; address: string | null; distanceM: number | null;
  ownDistanceKm: number | null; verdict: Verdict; note: string };
type Pos = { lat: number; lng: number };

const PLACE_ID = /^[A-Za-z0-9_-]{16,255}$/;
export const FIELD_MASK = 'places.id,places.displayName,places.location,places.formattedAddress';
/** A matched place must lie this close to one of our own positions for the operator (offer spots, cruise areas). */
export const OWN_REACH_KM = 30;
export const DEFAULT_MAX_CALLS = 400;
const BACKUP_DIR = join(homedir(), 'kitescout-backups');

/** Place name and camera position of a stored Maps place URL; null for anything else. */
export function mapsPlace(url: string | null | undefined): MapsPlace | null {
  const m = url?.match(/^https:\/\/www\.google\.[a-z.]+\/maps\/place\/([^/@?]+)\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/);
  if (!m) return null;
  let name: string;
  try { name = decodeURIComponent(m[1].replace(/\+/g, ' ')).trim(); } catch { return null; }
  return name ? { name, lat: Number(m[2]), lng: Number(m[3]), zoom: Number(m[4]) } : null;
}

function distanceM(a: Pos, b: Pos) {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
// Words every kite business shares prove nothing about identity ("Kite Beach Cafe" next to "Kite Charters").
const GENERIC = new Set(['kite', 'kites', 'kitesurf', 'kitesurfing', 'kiteboarding', 'kiteboard', 'wing', 'foil', 'surf', 'surfing', 'windsurf',
  'camp', 'camps', 'school', 'beach', 'hotel', 'resort', 'lodge', 'house', 'center', 'centre', 'club', 'tours', 'tour', 'trip', 'trips',
  'cruise', 'cruises', 'charter', 'safari', 'village', 'villa', 'villas', 'apartments', 'hostel', 'guesthouse', 'sports', 'watersports']);
const fold = (text: string) => text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
const tokens = (text: string) => fold(text).split(/[^a-z0-9]+/).filter(t => t.length >= 4 && !GENERIC.has(t));
const sameName = (a: string, b: string) => fold(a).replace(/[^a-z0-9]+/g, ' ').trim() === fold(b).replace(/[^a-z0-9]+/g, ' ').trim();

/** Candidates that share a name token with the operator and lie within reach of the stored Maps position, nearest
 *  first. A place URL at zoom >= 15 marks the place itself (1 km); a zoomed-out one only the area (25 km). */
export function passingPlaces(provider: { name: string | null; root_domain: string }, at: MapsPlace, candidates: PlaceCandidate[]) {
  const own = new Set(tokens(`${provider.name ?? ''} ${provider.root_domain.replace(/\.[a-z.]+$/, '')}`));
  const reach = at.zoom >= 15 ? 1_000 : 25_000;
  return candidates
    .filter(c => PLACE_ID.test(c.id) && tokens(c.displayName).some(t => own.has(t) || [...own].some(o => o.includes(t) || t.includes(o))))
    .map(c => ({ ...c, distanceM: Math.round(distanceM(at, c)) }))
    .filter(c => c.distanceM <= reach)
    .sort((x, y) => x.distanceM - y.distanceM);
}

export type Choice = { kind: 'one'; place: PlaceCandidate & { distanceM: number } }
  | { kind: 'ambiguous'; places: Array<PlaceCandidate & { distanceM: number }> } | { kind: 'none' };

/** One place, or ambiguous when several different places pass and not exactly one carries the stored name. */
export function choosePlace(provider: { name: string | null; root_domain: string }, at: MapsPlace, candidates: PlaceCandidate[]): Choice {
  const passing = passingPlaces(provider, at, candidates);
  if (!passing.length) return { kind: 'none' };
  if (new Set(passing.map(p => p.id)).size === 1) return { kind: 'one', place: passing[0] };
  const exact = passing.filter(p => sameName(p.displayName, at.name));
  if (new Set(exact.map(p => p.id)).size === 1) return { kind: 'one', place: exact[0] };
  return { kind: 'ambiguous', places: passing };
}

/** Kilometres from a place to the nearest of our own positions for the operator; null when we hold none. */
export function ownDistanceKm(place: Pos, own: Pos[]): number | null {
  if (!own.length) return null;
  return Math.round(Math.min(...own.map(p => distanceM(place, p))) / 100) / 10;
}

export function verdictFor(choice: Choice, ownKm: number | null): { verdict: Verdict; note: string } {
  if (choice.kind === 'none') return { verdict: 'none', note: 'no candidate with a shared name near the stored Maps position' };
  if (choice.kind === 'ambiguous') return { verdict: 'ambiguous', note: `several places pass: ${choice.places.map(p => `${p.displayName} (${p.distanceM} m)`).join('; ')}` };
  if (ownKm === null) return { verdict: 'check-location', note: 'name and Maps position fit, but we hold no own position for this operator' };
  if (ownKm > OWN_REACH_KM) return { verdict: 'check-location', note: `name and Maps position fit, but ${ownKm} km from our nearest offer position (head office elsewhere?)` };
  return { verdict: 'match', note: `name fits, ${choice.place.distanceM} m from the stored Maps position, ${ownKm} km from our offer position` };
}

export function placeIdPatch(placeId: string, matchedAt: string) {
  if (!PLACE_ID.test(placeId)) throw new Error(`not a place ID: ${placeId}`);
  return { google_place_id: placeId, google_place_matched_at: matchedAt };
}

async function searchPlaces(query: string, at: MapsPlace, key: string): Promise<PlaceCandidate[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
    body: JSON.stringify({ textQuery: query, maxResultCount: 5,
      locationBias: { circle: { center: { latitude: at.lat, longitude: at.lng }, radius: at.zoom >= 15 ? 1_000 : 25_000 } } }),
    signal: AbortSignal.timeout(15_000),
  });
  // The error body can echo request details; keep only the status and Google's short status word.
  if (!res.ok) throw new Error(`Places Text Search ${res.status} ${((await res.json().catch(() => ({}))) as { error?: { status?: string } }).error?.status ?? ''}`.trim());
  const body = await res.json() as { places?: Array<{ id?: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number } }> };
  return (body.places ?? []).flatMap(p => p.id && p.displayName?.text && typeof p.location?.latitude === 'number' && typeof p.location.longitude === 'number'
    ? [{ id: p.id, displayName: p.displayName.text, lat: p.location.latitude, lng: p.location.longitude, address: p.formattedAddress ?? null }] : []);
}

const located = (s: unknown): Pos[] => Array.isArray(s)
  ? s.flatMap(x => typeof x?.lat === 'number' && typeof x?.lng === 'number' ? [{ lat: x.lat, lng: x.lng }] : []) : [];

async function readAll<T>(table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as T[]));
    if (!data || data.length < 1000) return out;
  }
}

/** Our own positions per operator: cruise areas and itinerary spots for cruise providers, active package spots for
 *  package operators. Read only. */
async function ownPositions(): Promise<Map<string, Pos[]>> {
  const own = new Map<string, Pos[]>();
  const add = (id: string | null, ps: Pos[]) => { if (id && ps.length) own.set(id, [...(own.get(id) ?? []), ...ps]); };
  for (const l of await readAll<{ cruise_provider_id: string; lat: number | null; lng: number | null }>('cruise_locations', 'cruise_provider_id,lat,lng'))
    if (l.lat != null && l.lng != null) add(l.cruise_provider_id, [{ lat: Number(l.lat), lng: Number(l.lng) }]);
  for (const o of await readAll<{ cruise_provider_id: string; itinerary_spots: unknown }>('cruise_offers', 'cruise_provider_id,itinerary_spots'))
    add(o.cruise_provider_id, located(o.itinerary_spots));
  for (const o of await readAll<{ operator_id: string | null; is_active: boolean; itinerary_spots: unknown }>('package_offers', 'operator_id,is_active,itinerary_spots'))
    if (o.is_active) add(o.operator_id, located(o.itinerary_spots));
  return own;
}

/** Search only; nothing is written. Operators that already have a place ID are skipped. Refuses to start when more
 *  than maxCalls requests would be needed. */
export async function runGooglePlaceIdsDryRun(opts: { limit?: number; maxCalls?: number } = {}): Promise<{ results: PlaceIdResult[]; calls: number }> {
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY is not set; the place ID search needs a Places API (New) server key.');
  const targets: Array<{ table: PlaceTable; id: string; name: string | null; root_domain: string; google_url: string }> = [];
  for (const table of ['cruise_providers', 'providers'] as const) {
    const { data, error } = await supabase.from(table).select('id, name, root_domain, google_url, status')
      .not('google_url', 'is', null).is('google_place_id', null).not('status', 'in', '(dead,duplicate)').range(0, 4999);
    if (error) throw new Error(`${table}: ${error.message}`);
    targets.push(...(data ?? []).map(row => ({ table, id: row.id as string, name: row.name as string | null, root_domain: row.root_domain as string, google_url: row.google_url as string })));
  }
  const picked = opts.limit ? targets.slice(0, opts.limit) : targets;
  const searchable = picked.filter(t => mapsPlace(t.google_url)).length;
  const maxCalls = opts.maxCalls ?? DEFAULT_MAX_CALLS;
  if (searchable > maxCalls) throw new Error(`${searchable} searches needed, more than --max-calls ${maxCalls}; nothing sent.`);
  const own = await ownPositions();
  const results: PlaceIdResult[] = [];
  let calls = 0;
  for (const t of picked) {
    const base = { table: t.table, id: t.id, name: t.name ?? t.root_domain, domain: t.root_domain, googleUrl: t.google_url };
    const empty = { placeId: null, displayName: null, address: null, distanceM: null, ownDistanceKm: null };
    const at = mapsPlace(t.google_url);
    if (!at) { results.push({ ...base, ...empty, verdict: 'none', note: 'no place name/position in google_url' }); continue; }
    try {
      calls++;
      const choice = choosePlace(t, at, await searchPlaces(at.name, at, key));
      const place = choice.kind === 'one' ? choice.place : null;
      const ownKm = place ? ownDistanceKm(place, own.get(t.id) ?? []) : null;
      const v = verdictFor(choice, ownKm);
      results.push({ ...base, placeId: place?.id ?? null, displayName: place?.displayName ?? null, address: place?.address ?? null,
        distanceM: place?.distanceM ?? null, ownDistanceKm: ownKm, ...v });
    } catch (error) {
      results.push({ ...base, ...empty, verdict: 'error', note: `error: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return { results, calls };
}

/** Rows an apply writes: verdict "match", plus "check-location" rows named in accept, minus rows named in skip. */
export function planApply(results: PlaceIdResult[], opts: { skip?: string[]; accept?: string[] } = {}): PlaceIdResult[] {
  const skip = new Set(opts.skip ?? []), accept = new Set(opts.accept ?? []);
  for (const d of accept) {
    const r = results.find(x => x.domain === d);
    if (!r) throw new Error(`--accept ${d}: not in the file`);
    if (r.verdict !== 'check-location' && r.verdict !== 'match') throw new Error(`--accept ${d}: verdict ${r.verdict} has no single place to accept`);
  }
  return results.filter(r => r.placeId && !skip.has(r.domain) && (r.verdict === 'match' || (r.verdict === 'check-location' && accept.has(r.domain))))
    .map(r => { placeIdPatch(r.placeId!, 'check'); return r; });
}

type BackupRow = { table: PlaceTable; id: string; domain: string; before: { google_place_id: string | null; google_place_matched_at: string | null }; placeId: string };

/** Writes a reviewed dry-run file. Backs up the current values of every row it will touch first, then writes only
 *  while a row still has no place ID. */
export async function applyGooglePlaceIds(file: string, opts: { skip?: string[]; accept?: string[] } = {}): Promise<{ written: number; skipped: number; backup: string }> {
  const raw = readFileSync(file, 'utf8');
  const rows = planApply(JSON.parse(raw) as PlaceIdResult[], opts);
  const backupRows: BackupRow[] = [];
  for (const table of ['cruise_providers', 'providers'] as const) {
    const ids = rows.filter(r => r.table === table).map(r => r.id);
    if (!ids.length) continue;
    const { data, error } = await supabase.from(table).select('id, google_place_id, google_place_matched_at').in('id', ids);
    if (error) throw new Error(`${table} backup read: ${error.message}`);
    if ((data ?? []).length !== ids.length) throw new Error(`${table} backup read: ${data?.length ?? 0} of ${ids.length} rows found; nothing written.`);
    for (const r of rows.filter(x => x.table === table)) {
      const now = data!.find(d => d.id === r.id)!;
      backupRows.push({ table, id: r.id, domain: r.domain, before: { google_place_id: now.google_place_id, google_place_matched_at: now.google_place_matched_at }, placeId: r.placeId! });
    }
  }
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = join(BACKUP_DIR, `google-place-ids-apply-${stamp}.json`);
  writeFileSync(backup, JSON.stringify({ createdAt: new Date().toISOString(), reviewedFile: file,
    reviewedSha256: createHash('sha256').update(raw).digest('hex'), skip: opts.skip ?? [], accept: opts.accept ?? [],
    revert: 'pnpm cli google-place-ids --revert <this file>', rows: backupRows }, null, 2));
  const matchedAt = new Date().toISOString();
  let written = 0, skipped = 0;
  for (const r of rows) {
    const { data, error } = await supabase.from(r.table).update(placeIdPatch(r.placeId!, matchedAt)).eq('id', r.id).is('google_place_id', null).select('id');
    if (error) throw new Error(`${r.table} ${r.domain}: ${error.message}`);
    if ((data ?? []).length === 1) written++; else skipped++;
  }
  return { written, skipped, backup };
}

/** Puts back the recorded values, only where the row still holds the place ID that apply wrote. */
export async function revertGooglePlaceIds(backupFile: string): Promise<{ reverted: number; skipped: number }> {
  const { rows } = JSON.parse(readFileSync(backupFile, 'utf8')) as { rows: BackupRow[] };
  let reverted = 0, skipped = 0;
  for (const r of rows) {
    const { data, error } = await supabase.from(r.table).update(r.before).eq('id', r.id).eq('google_place_id', r.placeId).select('id');
    if (error) throw new Error(`${r.table} ${r.domain}: ${error.message}`);
    if ((data ?? []).length === 1) reverted++; else skipped++;
  }
  return { reverted, skipped };
}

export const defaultDryRunFile = () => join(BACKUP_DIR, `google-place-ids-dry-run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
