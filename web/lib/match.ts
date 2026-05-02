import { supabase } from './supabase';
import type { ProviderResult } from './types';

interface MatchParams {
  countries?: string[];
  regions?: string[];
  tripTypes?: string[];
  limit?: number;
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

  let query = supabase
    .from('providers')
    .select('id, name, website_url, description, trip_types, primary_country, primary_region, contact_email, contact_form_url, whatsapp, phone')
    .not('status', 'in', '("dead","duplicate")')
    .limit(limit);

  if (hasGeoFilter) query = query.in('id', [...idSet].slice(0, 150));
  if (tripTypes?.length) query = query.overlaps('trip_types', tripTypes);

  const { data: providers, error } = await query;
  if (error || !providers?.length) return [];

  const pids = providers.map(p => p.id as string);
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

  return providers.map(p => ({
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
  }));
}
