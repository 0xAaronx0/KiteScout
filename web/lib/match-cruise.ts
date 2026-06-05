import { getSupabase } from './supabase';
import type { ProviderResult } from './types';

interface MatchParams {
  countries?: string[];
  regions?: string[];
  limit?: number;
}

interface CruiseLocationRow {
  cruise_provider_id: string;
  country: string;
  region: string | null;
  spot_name: string | null;
  lat: number | string | null;
  lng: number | string | null;
  confidence: 'high' | 'medium' | 'low';
}

interface CruiseProviderRow {
  id: string;
  name: string | null;
  website_url: string | null;
  description: string | null;
  trip_types: string[] | null;
  primary_country: string | null;
  primary_region: string | null;
  contact_email: string | null;
  contact_form_url: string | null;
  whatsapp: string | null;
  phone: string | null;
  vessel_name: string | null;
  vessel_type: string | null;
  typical_duration_days: number | null;
  price_per_person_eur: number | null;
}

function label(loc: { spot_name: string | null; region: string | null; country: string }): string {
  return [loc.spot_name || loc.region, loc.country].filter(Boolean).join(', ');
}

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

// More contact info + cruise enrichment => higher rank
function completenessScore(p: CruiseProviderRow): number {
  let s = 0;
  if (p.website_url) s += 2;
  if (p.description) s += 3;
  if (p.contact_email) s += 4;
  if (p.contact_form_url) s += 2;
  if (p.whatsapp) s += 3;
  if (p.phone) s += 1;
  if (p.vessel_name || p.vessel_type) s += 2;
  if (p.price_per_person_eur) s += 1;
  return s;
}

// Sanitize a free-text term for use inside a PostgREST ilike pattern.
// Drops the characters that have special meaning in .or() filter strings.
function clean(term: string): string {
  return term.replace(/[,()%*]/g, ' ').trim();
}

/**
 * Match cruise providers using the cruise_locations table as the source.
 * Locations are matched case-insensitively across country / region / spot_name
 * (so "Grenadines" matches "Saint Vincent and the Grenadines", etc.).
 */
export async function matchCruiseLocations(
  { countries, regions, limit = 15 }: MatchParams,
): Promise<ProviderResult[]> {
  const supabase = getSupabase();
  const terms = [...(countries ?? []), ...(regions ?? [])]
    .map(clean)
    .filter(t => t.length >= 2);
  const hasFilter = terms.length > 0;

  // ---- 1. Find matching cruise_locations (which providers + which spots matched) ----
  let locQuery = supabase
    .from('cruise_locations')
    .select('cruise_provider_id, country, region, spot_name, lat, lng, confidence');

  if (hasFilter) {
    const ors = terms.flatMap(t => [
      `country.ilike.%${t}%`,
      `region.ilike.%${t}%`,
      `spot_name.ilike.%${t}%`,
    ]);
    locQuery = locQuery.or(ors.join(','));
  }

  const { data: matchedLocs, error: locErr } = await locQuery.returns<CruiseLocationRow[]>();
  if (locErr || !matchedLocs?.length) return [];

  // Track, per provider: matched cruise-spot labels, best spot's coords, and the
  // best matched spot itself (for the card's headline location).
  const matchedLabels = new Map<string, string[]>();
  const bestCoords = new Map<string, { lat: number; lng: number }>();
  const bestSpot = new Map<string, { country: string; region: string | null; spot_name: string | null }>();
  const confRank = { high: 3, medium: 2, low: 1 } as const;
  const bestConf = new Map<string, number>();
  const bestSpotConf = new Map<string, number>();

  for (const loc of matchedLocs) {
    const pid = loc.cruise_provider_id;
    const lbl = label(loc);
    if (!matchedLabels.has(pid)) matchedLabels.set(pid, []);
    const arr = matchedLabels.get(pid)!;
    if (!arr.includes(lbl)) arr.push(lbl);

    const rank = confRank[loc.confidence] ?? 0;

    // Best matched spot (by confidence) → drives the card's headline location.
    if (rank >= (bestSpotConf.get(pid) ?? -1)) {
      bestSpotConf.set(pid, rank);
      bestSpot.set(pid, { country: loc.country, region: loc.region, spot_name: loc.spot_name });
    }

    // Best matched spot that also has coords → drives the map pin.
    const lat = num(loc.lat);
    const lng = num(loc.lng);
    if (lat !== null && lng !== null && rank >= (bestConf.get(pid) ?? -1)) {
      bestConf.set(pid, rank);
      bestCoords.set(pid, { lat, lng });
    }
  }

  const providerIds = [...matchedLabels.keys()];

  // ---- 2. Fetch the matching cruise providers (skip dead/duplicate) ----
  const { data: providers, error: provErr } = await supabase
    .from('cruise_providers')
    .select(
      'id, name, website_url, description, trip_types, primary_country, primary_region, ' +
      'contact_email, contact_form_url, whatsapp, phone, vessel_name, vessel_type, ' +
      'typical_duration_days, price_per_person_eur',
    )
    .in('id', providerIds.slice(0, 200))
    .not('status', 'in', '("dead","duplicate")')
    .returns<CruiseProviderRow[]>();

  if (provErr || !providers?.length) return [];

  // ---- 3. Rank: high-confidence match > more matched spots > completeness ----
  const sorted = [...providers].sort((a, b) => {
    const ca = bestConf.get(a.id) ?? 0;
    const cb = bestConf.get(b.id) ?? 0;
    if (cb !== ca) return cb - ca;
    const ma = matchedLabels.get(a.id)?.length ?? 0;
    const mb = matchedLabels.get(b.id)?.length ?? 0;
    if (mb !== ma) return mb - ma;
    return completenessScore(b) - completenessScore(a);
  }).slice(0, limit);

  // ---- 4. Shape into ProviderResult — CRUISE ONLY ----
  // Cards must show only the kite-cruise offer: the matched cruise spot(s) and
  // the 'cruise' service — never the provider's other services or other
  // (non-matching) locations.
  return sorted.map((p, i) => {
    const coords = bestCoords.get(p.id);
    const matched = matchedLabels.get(p.id) ?? [];
    const spot = bestSpot.get(p.id);
    return {
      id: p.id,
      name: p.name,
      website_url: p.website_url,
      description: p.description,
      trip_types: ['cruise'],                               // drop other services
      primary_country: spot?.country ?? p.primary_country,  // headline = matched cruise spot
      primary_region: spot ? (spot.spot_name ?? spot.region) : p.primary_region,
      contact_email: p.contact_email,
      contact_form_url: p.contact_form_url,
      whatsapp: p.whatsapp,
      phone: p.phone,
      locations: matched,                                   // only matched cruise spots
      matchedLocations: matched,
      isHighlight: i < 3,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      vesselName: p.vessel_name,
      vesselType: p.vessel_type,
      durationDays: p.typical_duration_days,
      pricePerPersonEur: p.price_per_person_eur,
    };
  });
}
