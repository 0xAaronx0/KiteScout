import { getSupabase } from './supabase';
import { COORDS } from './cruise-map-coords';

// Builds the Cruise World Map's GeoJSON from the live `cruise_offers` table.
// Two layers the map toggles between: by itinerary COUNTRY and by named STOP.
//
// No runtime geocoding: spot markers use each itinerary stop's own lat/lng (set
// by the offers extraction pipeline), falling back to the COORDS centroid table.
// Country markers use COORDS, falling back to the centroid of that country's
// resolved stops — so a country missing from COORDS still gets placed as long as
// at least one of its offers has a geocoded stop.

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

interface Group {
  label: string;
  coords: LatLng;
  offers: Map<string, MapOffer>; // dedupe by offer id — an offer counts once per marker
}

function addOffer(groups: Map<string, Group>, label: string, coords: LatLng, id: string, prop: MapOffer) {
  let g = groups.get(label);
  if (!g) { g = { label, coords, offers: new Map() }; groups.set(label, g); }
  if (!g.offers.has(id)) g.offers.set(id, prop);
}

function toFeatureCollection(groups: Map<string, Group>): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [...groups.values()].map(g => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [g.coords[1], g.coords[0]] as [number, number] },
      properties: { label: g.label, count: g.offers.size, offers: [...g.offers.values()] },
    })),
  };
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

  // Pass 1: spot layer from named itinerary stops; accumulate each country's
  // resolved stop coords so a country missing from COORDS can fall back to them.
  const spot = new Map<string, Group>();
  const countrySpotCoords = new Map<string, LatLng[]>();
  const placedInSpot = new Set<string>();

  for (const o of offers) {
    const prop = offerProp(o);
    const stops = (o.itinerary_spots ?? []).filter(s => s && s.name && s.name.trim());
    for (const s of stops) {
      const name = s.name!.trim();
      const c = embeddedCoords(s) ?? COORDS[name] ?? null;
      if (!c) continue;
      addOffer(spot, name, c, o.id, prop);
      placedInSpot.add(o.id);
      if (o.country) {
        if (!countrySpotCoords.has(o.country)) countrySpotCoords.set(o.country, []);
        countrySpotCoords.get(o.country)!.push(c);
      }
    }
  }

  function countryCoord(country: string): LatLng | null {
    if (COORDS[country]) return COORDS[country];
    const pts = countrySpotCoords.get(country);
    if (pts && pts.length) {
      const lat = pts.reduce((sum, p) => sum + p[0], 0) / pts.length;
      const lng = pts.reduce((sum, p) => sum + p[1], 0) / pts.length;
      return [lat, lng];
    }
    return null;
  }

  // Pass 2: country layer, and keep offers with no resolvable stop visible in
  // the spot view by placing them at their country's location.
  const country = new Map<string, Group>();
  for (const o of offers) {
    if (!o.country) continue;
    const c = countryCoord(o.country);
    if (!c) continue;
    const prop = offerProp(o);
    addOffer(country, o.country, c, o.id, prop);
    if (!placedInSpot.has(o.id)) addOffer(spot, o.country, c, o.id, prop);
  }

  const operators = new Set(offers.map(o => providerOf(o)?.id).filter(Boolean)).size;

  return {
    country: toFeatureCollection(country),
    spot: toFeatureCollection(spot),
    totalOffers: offers.length,
    operators,
    generatedAt: new Date().toISOString(),
  };
}
