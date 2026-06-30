import { getSupabase } from './supabase';
import { COORDS } from './cruise-map-coords';

// Builds the Cruise World Map's GeoJSON from the live `cruise_offers` table.
// Two layers the map toggles between:
//   - the overview ("country" field, but really an AREA layer): one marker per
//     distinct cruising area within a country — see areaMarkersForCountry();
//   - "spot": one marker per named itinerary stop that has coordinates.
//
// The area layer groups a country's offers by a normalized region key, positions
// each group at its most-frequent known spot, and distance-merges nearby groups —
// so genuinely separate areas split (Italy → Sardinia + Sicily; Greece → Cyclades
// + Petali Islands) while messy region synonyms (North Sardinia, Emerald Coast,
// Sardinia & Corsica) collapse to one marker, and single-area countries stay one.
// No runtime geocoding.

type LatLng = [number, number];

interface ItineraryStop {
  name?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
}

interface OfferRow {
  id: string;
  title: string | null;
  country: string | null;
  region: string | null;
  itinerary_spots: ItineraryStop[] | null;
  vessel_name: string | null;
  vessel_type: string | null;
  price_from_eur: number | null;
  currency: string | null;
  cruise_provider:
    | { id: string; name: string | null; website_url: string | null }
    | Array<{ id: string; name: string | null; website_url: string | null }>
    | null;
}

export interface MapOffer {
  title: string;
  provider: string | null;
  url: string | null;
  price: number | null;
  currency: string | null;
  vessel: string | null;
}

interface MapFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] }; // [lng, lat]
  properties: { label: string; count: number; offers: MapOffer[] };
}

export interface FeatureCollection {
  type: 'FeatureCollection';
  features: MapFeature[];
}

export interface CruiseMapData {
  // `country` is the overview layer; it is now region-aware (one marker per
  // cruising AREA, not strictly per country). Kept this field name so the static
  // map page keeps working without a coordinated redeploy.
  country: FeatureCollection;
  spot: FeatureCollection;
  totalOffers: number;
  operators: number;
  generatedAt: string;
}

function providerOf(o: OfferRow) {
  const p = Array.isArray(o.cruise_provider) ? o.cruise_provider[0] ?? null : o.cruise_provider;
  return p ?? null;
}

function offerProp(o: OfferRow): MapOffer {
  const p = providerOf(o);
  return {
    title: o.title ?? p?.name ?? 'Kite cruise',
    provider: p?.name ?? null,
    url: p?.website_url ?? null,
    price: o.price_from_eur,
    currency: o.currency,
    vessel: o.vessel_name,
  };
}

function embeddedCoords(s: ItineraryStop): LatLng | null {
  return typeof s.lat === 'number' && typeof s.lng === 'number' ? [s.lat, s.lng] : null;
}

interface Marker {
  label: string;
  coords: LatLng;
  offers: Map<string, MapOffer>; // dedupe by offer id — an offer counts once per marker
}

function addOffer(markers: Map<string, Marker>, label: string, coords: LatLng, id: string, prop: MapOffer) {
  let g = markers.get(label);
  if (!g) { g = { label, coords, offers: new Map() }; markers.set(label, g); }
  if (!g.offers.has(id)) g.offers.set(id, prop);
}

function featureOf(m: Marker): MapFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [m.coords[1], m.coords[0]] },
    properties: { label: m.label, count: m.offers.size, offers: [...m.offers.values()] },
  };
}

function toFeatureCollection(markers: Iterable<Marker>): FeatureCollection {
  return { type: 'FeatureCollection', features: [...markers].map(featureOf) };
}

// --- Area layer: region-aware grouping --------------------------------------

// Region words that carry no sub-area signal and should be stripped from the key.
const NOISE = new Set([
  'islands', 'island', 'isles', 'the', 'north', 'south', 'east', 'west',
  'northern', 'southern', 'eastern', 'western', 'sea', 'gulf', 'peninsula',
  'region', 'archipelago', 'coast', 'cays', 'cay', 'group', 'atolls', 'of',
  'lagoon', 'area',
]);
// Basin-level words: an offer keyed only by these isn't distinctive, so it
// belongs to its country's main area rather than getting its own marker.
const GENERIC = new Set([
  'caribbean', 'mediterranean', 'leeward', 'windward', 'atlantic', 'ocean',
  'antilles', 'aegean',
]);
const MERGE_D = 1.3; // degrees — merge region-groups whose anchors are this close

// Normalize a free-text region to a grouping key, or null when not distinctive.
function regionKey(o: OfferRow): string | null {
  let tokens = (o.region ?? '').toLowerCase().split(/[\s/,&–-]+/).filter(Boolean);
  // Italy: "Emerald Coast / Costa Smeralda" is in Sardinia — fold it in so the
  // Sardinia variants don't fragment.
  if (o.country === 'Italy' && tokens.some(t => t === 'emerald' || t === 'smeralda' || t === 'costa')) {
    return 'sardinia';
  }
  tokens = tokens.filter(t => !NOISE.has(t));
  while (tokens.length && GENERIC.has(tokens[0])) tokens.shift();
  if (!tokens.length) return null;
  let t = tokens[0];
  if (t.endsWith('s') && t.length > 4) t = t.slice(0, -1); // crude singularize (exumas == exuma)
  return t;
}

function euclid(a: LatLng, b: LatLng): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// Position a group at its most-frequent COORDS-known spot NAME (resists poisoned
// departure-port coords), then the mean of its stops' own coords, then null.
function positionGroup(group: OfferRow[]): LatLng | null {
  const nameCount = new Map<string, number>();
  for (const o of group) {
    for (const s of o.itinerary_spots ?? []) {
      const n = s?.name?.trim();
      if (n && COORDS[n]) nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
    }
  }
  if (nameCount.size) {
    let best = ''; let bestCount = -1;
    for (const [n, c] of nameCount) if (c > bestCount) { bestCount = c; best = n; }
    return COORDS[best];
  }
  const means: LatLng[] = [];
  for (const o of group) {
    const pts = (o.itinerary_spots ?? []).map(embeddedCoords).filter((c): c is LatLng => c !== null);
    if (pts.length) {
      means.push([
        pts.reduce((s, p) => s + p[0], 0) / pts.length,
        pts.reduce((s, p) => s + p[1], 0) / pts.length,
      ]);
    }
  }
  if (means.length) {
    return [
      means.reduce((s, p) => s + p[0], 0) / means.length,
      means.reduce((s, p) => s + p[1], 0) / means.length,
    ];
  }
  // Last resort: a COORDS entry for the group's dominant region name. Keeps
  // coastal cruises whose stops aren't geocoded (e.g. Kenya, Venezuela) off the
  // inland country centroid.
  const regionCount = new Map<string, number>();
  for (const o of group) {
    const r = o.region?.trim();
    if (r && COORDS[r]) regionCount.set(r, (regionCount.get(r) ?? 0) + 1);
  }
  const region = mostFrequent(regionCount);
  return region ? COORDS[region] : null;
}

function cleanLabel(region: string): string {
  return region.split(/[/–\-&]/)[0].trim();
}

function mostFrequent(counts: Map<string, number>): string | null {
  let best: string | null = null; let bestCount = -1;
  for (const [k, c] of counts) if (c > bestCount) { bestCount = c; best = k; }
  return best;
}

// Group one country's offers into area markers.
function areaMarkersForCountry(country: string, offers: OfferRow[]): Marker[] {
  // 1. Group by normalized region key; non-distinctive offers go to `leftover`.
  const distinct = new Map<string, OfferRow[]>();
  const leftover: OfferRow[] = [];
  for (const o of offers) {
    const k = regionKey(o);
    if (k === null) { leftover.push(o); continue; }
    if (!distinct.has(k)) distinct.set(k, []);
    distinct.get(k)!.push(o);
  }

  // 2. Position each distinct group; un-positionable groups fall to `leftover`.
  const positioned: { offers: OfferRow[]; pos: LatLng }[] = [];
  for (const grp of distinct.values()) {
    const pos = positionGroup(grp);
    if (!pos) { leftover.push(...grp); continue; }
    positioned.push({ offers: grp, pos });
  }

  // 3. Greedy distance-merge, largest first (collapses near-identical areas).
  positioned.sort((a, b) => b.offers.length - a.offers.length);
  const merged: { pos: LatLng; offers: OfferRow[] }[] = [];
  for (const g of positioned) {
    const m = merged.find(mm => euclid(g.pos, mm.pos) <= MERGE_D);
    if (m) m.offers.push(...g.offers);
    else merged.push({ pos: g.pos, offers: [...g.offers] });
  }

  // 4. Absorb leftover into the country's largest area (no over-fragmentation);
  //    if nothing was positioned, place everything at the country centroid.
  if (leftover.length) {
    if (merged.length) {
      let largest = merged[0];
      for (const m of merged) if (m.offers.length > largest.offers.length) largest = m;
      largest.offers.push(...leftover);
    } else if (COORDS[country]) {
      merged.push({ pos: COORDS[country], offers: [...leftover] });
    }
  }

  // 5. Label each marker by its dominant (distinctive) region, + country context.
  return merged.map(m => {
    const distinctRegions = new Map<string, number>();
    const anyRegions = new Map<string, number>();
    for (const o of m.offers) {
      const r = o.region?.trim();
      if (!r) continue;
      anyRegions.set(r, (anyRegions.get(r) ?? 0) + 1);
      if (regionKey(o) !== null) distinctRegions.set(r, (distinctRegions.get(r) ?? 0) + 1);
    }
    const raw = mostFrequent(distinctRegions) ?? mostFrequent(anyRegions) ?? country;
    const cl = cleanLabel(raw) || country;
    const label = cl.toLowerCase() === country.toLowerCase() ? country : `${cl}, ${country}`;
    const offers = new Map<string, MapOffer>();
    for (const o of m.offers) if (!offers.has(o.id)) offers.set(o.id, offerProp(o));
    return { label, coords: m.pos, offers };
  });
}

export async function buildCruiseMapData(): Promise<CruiseMapData> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('cruise_offers')
    .select(`
      id, title, country, region, itinerary_spots,
      vessel_name, vessel_type, price_from_eur, currency,
      cruise_provider:cruise_providers!inner ( id, name, website_url )
    `)
    .eq('is_reseller', false)
    .returns<OfferRow[]>();

  if (error) throw error;
  const offers = data ?? [];

  // Spot layer: one marker per named itinerary stop that has coordinates.
  const spot = new Map<string, Marker>();
  for (const o of offers) {
    const prop = offerProp(o);
    for (const s of o.itinerary_spots ?? []) {
      const name = s?.name?.trim();
      if (!name) continue;
      const c = embeddedCoords(s) ?? COORDS[name] ?? null;
      if (!c) continue;
      addOffer(spot, name, c, o.id, prop);
    }
  }

  // Area (overview) layer: region-aware, per country.
  const byCountry = new Map<string, OfferRow[]>();
  for (const o of offers) {
    const c = o.country ?? '?';
    if (!byCountry.has(c)) byCountry.set(c, []);
    byCountry.get(c)!.push(o);
  }
  const areaMarkers: Marker[] = [];
  for (const [country, countryOffers] of byCountry) {
    areaMarkers.push(...areaMarkersForCountry(country, countryOffers));
  }

  const operators = new Set(offers.map(o => providerOf(o)?.id).filter(Boolean)).size;

  return {
    country: toFeatureCollection(areaMarkers),
    spot: toFeatureCollection(spot.values()),
    totalOffers: offers.length,
    operators,
    generatedAt: new Date().toISOString(),
  };
}
