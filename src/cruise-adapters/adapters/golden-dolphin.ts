// ---------------------------------------------------------------------------
// Golden Dolphin Safari World (golden-dolphin.net) - mixed dive/kite liveaboard fleet, Hurghada.
// Handed over 2026-10-12: the old LLM path wrote the DIVE safaris of the "Upcoming trips" box
// (Brother Islands, Dolphin Reef, ...) into the kite offer as kite departures.
//
// Data path (checked 2026-10-12, homepage; robots.txt allows /):
//   "Upcoming trips ... <route> M/Y <vessel> <n> Places left DD-MM-YYYY DD-MM-YYYY <from> <to> Itinerary"
//   Kite is sold as "Kite Charter Request" (on request); the schedule has been dive-only since
//   2026-07 (Aaron keeps the kite offer as a shell).
// Only rows whose route names kite/wing count as departures of the kite offer; with none, the
// adapter states nothing (null) - which also stops the LLM from reading this page.
// Requests per run: 1.
// ---------------------------------------------------------------------------
import { fetchText } from '../../offers/http.js';
import { collapse, iso, parse } from '../../offers/parse.js';
import type { Departure, DepartureStatus } from '../../pipeline/cruise-state.js';
import { emptyState, type CruiseAdapter, type CruiseAdapterItem } from '../types.js';

export const GD_URL = 'https://www.golden-dolphin.net/';

export interface GdTrip { route: string; vessel: string; placesLeft: number; start: string; end: string }

export function parseGdTrips(html: string): GdTrip[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script,style,noscript,svg')) el.remove();
  const t = collapse(root.structuredText);
  const i = t.indexOf('Upcoming trips');
  if (i === -1) return [];
  const box = t.slice(i, t.indexOf('Book a trip', i) > 0 ? t.indexOf('Book a trip', i) : i + 4000);
  const out: GdTrip[] = [];
  const re = /(?:Schedule|Require)\s+(.{3,80}?)\s+M\/Y\s+(.{2,40}?)\s+(\d{1,3}) Places left\s+(\d{2})-(\d{2})-(\d{4})\s+(\d{2})-(\d{2})-(\d{4})/g;
  for (const m of box.matchAll(re)) {
    out.push({ route: m[1].trim(), vessel: m[2].trim(), placesLeft: +m[3], start: iso(+m[6], +m[5], +m[4]), end: iso(+m[9], +m[8], +m[7]) });
  }
  return out;
}

const isKite = (t: GdTrip): boolean => /kite|kiting|wing/i.test(t.route);
const status = (n: number): DepartureStatus => (n === 0 ? 'sold_out' : n <= 4 ? 'few_spots' : 'available');

export const goldenDolphin: CruiseAdapter = {
  key: 'golden-dolphin',
  domain: 'golden-dolphin.net',
  urls: [GD_URL],
  async fetchStates(): Promise<CruiseAdapterItem[]> {
    const kite = parseGdTrips(await fetchText(GD_URL)).filter(isKite);
    const deps: Departure[] = kite.map(t => ({ start_date: t.start, end_date: t.end, price: null, currency: null, status: status(t.placesLeft) }));
    return [{ sourceUrl: GD_URL, titleHint: /kite/i, state: emptyState({ departures: deps.length ? deps : null }) }];
  },
};
