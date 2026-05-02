import { supabase } from './supabase';
import type { ProviderResult } from './types';

interface MatchParams {
  countries?: string[];
  regions?: string[];
  tripTypes?: string[];
  limit?: number;
}

// Score providers by how "bookable" they appear — more contact info = higher score
function completenessScore(p: {
  website_url: unknown; description: unknown; contact_email: unknown;
  contact_form_url: unknown; whatsapp: unknown; phone: unknown; trip_types: unknown;
}): number {
  let s = 0;
  if (p.website_url) s += 2;
  if (p.description) s += 3;
  if (p.contact_email) s += 4;
  if (p.contact_form_url) s += 2;
  if (p.whatsapp) s += 3;
  if (p.phone) s += 1;
  if (Array.isArray(p.trip_types) && p.trip_types.length > 0) s += 1;
  return s;
}

export async function matchProviders({ countries, regions, tripTypes, limit = 12 }: MatchParams): Promise<ProviderResult[]> {
  const idSet = new Set<string>();
  const hasGeoFilter = (countries?.length ?? 0) > 0 || (regions?.length ?? 0) > 0;

  if (hasGeoFilter) {
    if (countries?.length) {
      const { data } = await supabase
        .from('provider_locations').select('provider_id').in('country', countries);
      (data ?? []).forEach(r => idSet.add(r.provider_id as string));

      const { data: byPrimary } = await supabase
        .from('providers').select('id').in('primary_country', countries)
        .not('status', 'in', '("dead","duplicate")');
      (byPrimary ?? []).forEach(p => idSet.add(p.id as string));
    }

    if (regions?.length) {
      const { data: byRegion } = await supabase
        .from('provider_locations').select('provider_id').in('region', regions);
      (byRegion ?? []).forEach(r => idSet.add(r.provider_id as string));

      const { data: bySpot } = await supabase
        .from('provider_locations').select('provider_id').in('spot_name', regions);
      (bySpot ?? []).forEach(r => idSet.add(r.provider_id as string));
    }

    if (idSet.size === 0) return [];
  }

  // Fetch slightly more than limit so sorting by completeness is meaningful
  const fetchLimit = Math.min(limit * 3, 60);
  let query = supabase
    .from('providers')
    .select('id, name, website_url, description, trip_types, primary_country, primary_region, contact_email, contact_form_url, whatsapp, phone')
    .not('status', 'in', '("dead","duplicate")')
    .limit(fetchLimit);

  if (hasGeoFilter) query = query.in('id', [...idSet].slice(0, 150));
  if (tripTypes?.length) query = query.overlaps('trip_types', tripTypes);

  const { data: providers, error } = await query;
  if (error || !providers?.length) return [];

  // Sort by completeness, slice to requested limit
  const sorted = [...providers].sort((a, b) => completenessScore(b) - completenessScore(a)).slice(0, limit);

  const pids = sorted.map(p => p.id as string);
  const { data: locs } = await supabase
    .from('provider_locations').select('provider_id, country, region, spot_name')
    .in('provider_id', pids);

  const locMap = new Map<string, string[]>();
  for (const loc of (locs ?? [])) {
    const label = [loc.spot_name || loc.region, loc.country].filter(Boolean).join(', ');
    const pid = loc.provider_id as string;
    if (!locMap.has(pid)) locMap.set(pid, []);
    const arr = locMap.get(pid)!;
    if (!arr.includes(label)) arr.push(label);
  }

  return sorted.map((p, i) => ({
    id: p.id as string,
    name: p.name as string | null,
    website_url: p.website_url as string | null,
    description: p.description as string | null,
    trip_types: (p.trip_types ?? []) as string[],
    primary_country: p.primary_country as string | null,
    primary_region: p.primary_region as string | null,
    contact_email: p.contact_email as string | null,
    contact_form_url: p.contact_form_url as string | null,
    whatsapp: p.whatsapp as string | null,
    phone: p.phone as string | null,
    locations: locMap.get(p.id as string) ?? [],
    isHighlight: i < 3,
  }));
}
