// Itinerary spots on a re-extraction: the stored row often carries coordinates a fresh run
// cannot reproduce (manual backfills, OSM gaps, transient geocoder failures). The KCS map
// pins an offer only from spots with lat/lng (no region/country fallback since KCS a7a80ce,
// 2026-10-07), so a re-run that drops them takes the offer off the map.
// A spot stored with `pinned: true` was placed by hand (e.g. an island-name stop moved from the
// island centroid to its harbour, Aaron 2026-10-29); a re-run keeps its coordinates even when
// the geocoder returns a point again.
// A spot with `precise: true` sits on the property's exact address (KCS shows a map pin at street
// zoom); a hand pin replaces the coordinates, so it drops the flag.

export interface StoredSpot {
  name: string;
  country: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  order: number;
  pinned?: true;
  precise?: true;
}

const located = (s: { lat?: unknown; lng?: unknown }) => typeof s.lat === 'number' && typeof s.lng === 'number';
const pinned = (s: StoredSpot) => s.pinned === true && located(s);
const key = (name: string) => name.trim().toLowerCase();

/**
 * A pinned stored spot always keeps its coordinates for a same-named fresh spot. Otherwise
 * fresh spots win when at least one of them is located; a fresh spot without coordinates
 * takes the stored coordinates of a same-named spot. Without any located fresh spot the
 * stored list is kept as long as it has a located spot.
 */
export function mergeItinerarySpots(
  fresh: StoredSpot[],
  stored: unknown,
): { spots: StoredSpot[]; note: string | null } {
  const old = (Array.isArray(stored) ? stored : []).filter(
    (s): s is StoredSpot => !!s && typeof (s as StoredSpot).name === 'string',
  );
  const oldCoords = new Map(old.filter(located).map(s => [key(s.name), s] as const));
  const oldPins = new Map(old.filter(pinned).map(s => [key(s.name), s] as const));
  let carried = 0;
  const merged = fresh.map(s => {
    const pin = oldPins.get(key(s.name));
    if (pin) {
      carried++;
      const { precise: _, ...rest } = s;
      return { ...rest, lat: pin.lat, lng: pin.lng, pinned: true as const };
    }
    if (located(s)) return s;
    const prev = oldCoords.get(key(s.name));
    if (!prev) return s;
    carried++;
    return { ...s, lat: prev.lat, lng: prev.lng, ...(prev.precise === true ? { precise: true as const } : {}) };
  });
  if (merged.some(located)) {
    return { spots: merged, note: carried ? `kept stored coords for ${carried} spot(s)` : null };
  }
  if (oldCoords.size > 0) {
    return { spots: old, note: `kept ${old.length} stored spot(s): fresh extraction had no located spot` };
  }
  return { spots: merged, note: null };
}
