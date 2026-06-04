import { getSupabase } from './supabase';

export interface CruiseDestination {
  destination: string; // country name, used directly as the search query
  count: number;       // distinct cruise providers operating there
}

/**
 * Top cruise destinations by number of distinct cruise providers, derived from
 * the cruise_locations table. Used to populate the quick-option chips.
 */
export async function topCruiseDestinations(limit = 8): Promise<CruiseDestination[]> {
  const supabase = getSupabase();

  // Valid (non-dead/duplicate) cruise providers.
  const { data: validRows } = await supabase
    .from('cruise_providers')
    .select('id')
    .not('status', 'in', '("dead","duplicate")')
    .returns<{ id: string }[]>();
  const valid = new Set((validRows ?? []).map(r => r.id));
  if (valid.size === 0) return [];

  const { data: locs } = await supabase
    .from('cruise_locations')
    .select('cruise_provider_id, country')
    .returns<{ cruise_provider_id: string; country: string }[]>();

  // Count distinct providers per country.
  const byCountry = new Map<string, Set<string>>();
  for (const loc of locs ?? []) {
    if (!valid.has(loc.cruise_provider_id)) continue;
    const c = loc.country?.trim();
    if (!c) continue;
    if (!byCountry.has(c)) byCountry.set(c, new Set());
    byCountry.get(c)!.add(loc.cruise_provider_id);
  }

  return [...byCountry.entries()]
    .map(([destination, set]) => ({ destination, count: set.size }))
    .sort((a, b) => b.count - a.count || a.destination.localeCompare(b.destination))
    .slice(0, limit);
}
