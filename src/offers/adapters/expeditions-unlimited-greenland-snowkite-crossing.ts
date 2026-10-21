// ---------------------------------------------------------------------------
// Expeditions Unlimited (Lyon; part of Secret Planet) - South to North crossing of Greenland by SNOWKITE (kiting on
// snow with skis and pulkas, not on water): about 1,500 km over the ice cap from Kangerlussuaq (helicopter to the
// start) past the abandoned Cold War radar station Dye 2 to Siorapaluk and Qaanaaq (Thule), fully self-sufficient,
// 35-day program incl. reserve days, 2 to 3 participants, guided by Michael Charavin (who also runs Latitudes Nord).
// An expedition for autonomous snowkiters (selection by CV + medical check), listed as kind 'tour'.
//
// Data path (checked 2026-10-19): Drupal, server-rendered; ONE page.
//   slots    the JSON-LD Product.offers (AggregateOffer): one Offer per departure, "Départ en petit groupe le 25/04/2027",
//            availabilityStarts 2027-04-25, price 39000 EUR ("Prix à partir de, vol international non inclus"),
//            availability InStock; a second departure 2028-04-24 (same price). The visible "Departures and pricing"
//            table is loaded by script (not in the HTML), so the JSON-LD is the source. End date = start + duration - 1
//            (TouristTrip "Durée: 35 jours"; its arrivalTime 2027-05-29 for the first departure agrees).
//            EUR per person ("price from", "In small group from 2 to 3 participants"), priceUnit 'package'.
//   content  JSON-LD TouristTrip (description, duration, group size, day-by-day titles) + page text (FAQ, inclusions,
//            level) + the product slideshow photos (originals under /sites/default/files/imported/<year>/<productID>-*).
// Availability: schema.org InStock -> 'available', LimitedAvailability -> 'limited', SoldOut -> 'sold_out' (page data,
//   not an engine -> liveAvailability unset). Booking path behind "Book this expedition" not followed -> instantBooking
//   unset (flagged).
// robots.txt (2026-10-19): Drupal default (core/profile/admin paths), product pages allowed.
// Requests per run: 1 (content + slots share one memoised page fetch).
// Known limits: Dye 2 is an abandoned radar station on the ice cap; whether the geocoder places it is unchecked.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, ldOfType, parse, todayIso } from '../parse.js';
import type { Availability, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.expeditions-unlimited.com';
export const EUG_URL = `${SITE}/en/expeditions/greenland-arctic/south-north-crossing-greenland-snowkite`;

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
type Obj = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

// --- pure parsers -----------------------------------------------------------------------------
export interface EugDeparture { start: string; price: number | null; currency: string | null; availability: Availability; schemaAvailability: string; name: string }
export interface EugTrip { durationDays: number | null; groupSize: string | null; description: string; days: string[]; productId: string | null; image: string | null }

export function parseEugTrip(html: string): EugTrip {
  const trip = ldOfType(html, 'TouristTrip')[0] ?? {};
  const product = ldOfType(html, 'Product')[0] ?? {};
  const props = (Array.isArray(trip.additionalProperty) ? trip.additionalProperty : []) as Obj[];
  const prop = (re: RegExp): string | null => str(props.find(p => re.test(str(p.name)))?.value) || null;
  const items = ((trip.itinerary as Obj | undefined)?.itemListElement ?? []) as Obj[];
  return {
    durationDays: Number(prop(/^dur/i)?.match(/(\d+)/)?.[1] ?? NaN) || null,
    groupSize: prop(/taille du groupe|group size/i),
    description: collapse(str(trip.description)),
    days: items.map(i => collapse(str((i.item as Obj | undefined)?.name))).filter(Boolean),
    productId: str(product.productID) || null,
    image: str(product.image) || str(trip.image) || null,
  };
}

const SCHEMA_AVAIL: Record<string, Availability> = {
  InStock: 'available', LimitedAvailability: 'limited', SoldOut: 'sold_out', OutOfStock: 'sold_out', PreOrder: 'on_request', Discontinued: 'closed',
};

export function parseEugDepartures(html: string): EugDeparture[] {
  const product = ldOfType(html, 'Product')[0];
  const agg = (product?.offers ?? {}) as Obj;
  const offers = (Array.isArray(agg.offers) ? agg.offers : Array.isArray(product?.offers) ? product!.offers : []) as Obj[];
  const out: EugDeparture[] = [];
  for (const o of offers) {
    const start = str(o.availabilityStarts).slice(0, 10) || str(o.name).match(/(\d{2})\/(\d{2})\/(\d{4})/)?.slice(1).reverse().join('-') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) continue;
    const schema = str(o.availability).replace(/^.*\//, '');
    const price = Number(o.price);
    out.push({
      start,
      price: Number.isFinite(price) && price > 0 ? price : null,
      currency: str(o.priceCurrency) || null,
      availability: SCHEMA_AVAIL[schema] ?? 'unknown',
      schemaAvailability: schema,
      name: collapse(str(o.name)),
    });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export function buildEugSlots(deps: EugDeparture[], durationDays: number | null, today: string): Slot[] {
  return deps.filter(d => d.start >= today).map(d => ({
    key: d.start,
    startDate: d.start,
    endDate: durationDays ? addDays(d.start, durationDays - 1) : null,
    unit: 'Small-group expedition (2 to 3 participants)',
    price: d.price,
    currency: d.price !== null ? d.currency : null,
    priceUnit: d.price !== null ? 'package' : null,
    priceBasis: d.price !== null ? 'person' : null,
    occupancy: null,
    availability: d.availability,
    availabilityText: `${d.schemaAvailability || 'no availability given'}; price "from", international flights not included`,
    spotsLeft: null,
  }));
}

/** Slideshow photos -> originals of this product (/sites/default/files/imported/<year>/<productID>-*). */
export function eugImages(html: string, productId: string | null, lead: string | null): string[] {
  const out: string[] = [];
  const push = (u: string): void => { if (!out.includes(u)) out.push(u); };
  if (lead) push(new URL(lead, SITE).toString());
  for (const m of html.matchAll(/\/sites\/default\/files\/(?:styles\/[^/]+\/public\/)?(imported\/\d{4}\/([A-Z]+\d+)-[\w-]+\.(?:jpe?g|png))/gi)) {
    if (productId && m[2] !== productId) continue;
    push(`${SITE}/sites/default/files/${m[1]}`);
  }
  return out;
}

export function parseEugContent(html: string, today = todayIso()): OfferContent {
  const trip = parseEugTrip(html);
  const deps = parseEugDepartures(html);
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, form')) el.remove();
  const text = collapse((root.querySelector('main') ?? root).text);
  const future = deps.filter(d => d.start >= today);
  const fmt = (n: number): string => n.toLocaleString('en-US');
  const day = (d: string): string => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const cheapest = future.filter(d => d.price !== null).sort((a, b) => a.price! - b.price!)[0];

  const summary = [
    'Expeditions Unlimited runs a guided snowkite crossing of the Greenland ice cap from south to north - kiting on snow on skis, pulling the sleds, not on water - about 1,500 km from Kangerlussuaq past the abandoned Dye 2 radar station to Siorapaluk and Qaanaaq.',
    `A helicopter drops the group of 2 to 3 on the ice; from there it travels fully self-sufficient with tents and pulkas of about 70 kg, led by polar guide Michael Charavin with a weather router and a medical hotline, in a ${trip.durationDays ?? 35}-day program that includes reserve days.`,
    'It is a demanding expedition for autonomous snowkiters with multi-day expedition experience; a CV and a medical check are required.',
    future.length
      ? `Departures: ${future.map(d => day(d.start)).join(', ')}${cheapest ? `, from ${cheapest.currency} ${fmt(cheapest.price!)} per person without international flights` : ''}.`
      : 'The next departure date is not published yet.',
  ].join(' ');

  return {
    kind: 'tour',
    title: 'South to North Crossing of Greenland by Snowkite',
    summary,
    continent: 'North America',
    country: 'Greenland',
    region: 'Greenland ice sheet',
    spot: 'Kangerlussuaq, Qeqqata',
    spotCoords: null,
    itinerarySpots: [
      { name: 'Kangerlussuaq', country: 'Greenland', region: 'Qeqqata', order: 1 },
      { name: 'Dye 2', country: 'Greenland', region: 'Greenland ice sheet', order: 2 },
      { name: 'Siorapaluk', country: 'Greenland', region: 'Avannaata', order: 3 },
      { name: 'Qaanaaq', country: 'Greenland', region: 'Avannaata', order: 4 },
    ],
    durationDays: trip.durationDays ?? 35,
    skillLevels: ['advanced'],
    kiteLessons: false,
    equipmentRental: /technical equipment for rental/i.test(text),
    beginnerFriendly: false,
    includedServices: [
      'Field transfers (helicopter to the ice cap, boat to Qaanaaq)',
      'Guesthouse nights at the start and the end (up to 3) with dinners (up to 3)',
      'Freeze-dried meals during the crossing',
      'Collective equipment: tents, pulkas, stoves, fuel, satellite phone, Garmin InReach',
      'Guiding by Michael Charavin, weather router and 24/7 medical hotline (Ifremmont)',
      'Two pre-departure preparation sessions',
    ],
    optionalServices: [
      'Rental of expedition gear (e.g. -30°C down sleeping bag EUR 150-200, down jacket or salopettes EUR 110-140)',
      'Not included: international flights, personal gear, mandatory expedition insurance',
    ],
    accommodation: 'Two-person tents on the ice cap; guesthouse / homestay at the start and the finish',
    mealPlan: 'full_board',
    languages: ['fr', 'en'],
    rooms: [],
    imageUrls: eugImages(html, trip.productId, trip.image).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: EUG_URL,
    bookingUrl: EUG_URL,
    sourceText: [
      `departures: ${deps.map(d => `${d.name} ${d.price} ${d.currency} ${d.schemaAvailability}`).join(' | ')}`,
      `trip: ${trip.description}`,
      `group: ${trip.groupSize ?? '?'}; days: ${trip.days.join(' / ')}`,
      `page: ${text}`,
    ].join('\n'),
  };
}

export async function fetchEugSlots(today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const html = await page(EUG_URL);
  const deps = parseEugDepartures(html);
  if (!ldOfType(html, 'Product').length) throw new Error('expeditions-unlimited-greenland: JSON-LD Product not found (page changed?)');
  if (!deps.length) ctx?.note('expeditions-unlimited-greenland: no dated departures in the JSON-LD offers');
  const slots = buildEugSlots(deps, parseEugTrip(html).durationDays, today);
  if (deps.length && !slots.length) ctx?.note(`expeditions-unlimited-greenland: all departures past (${deps.map(d => d.start).join(', ')})`);
  return slots;
}

// --- adapter ----------------------------------------------------------------------------------
export const expeditionsUnlimitedGreenlandSnowkiteCrossing: OfferAdapter = {
  key: 'expeditions-unlimited-greenland-snowkite-crossing',
  name: 'Expeditions Unlimited - South to North crossing of Greenland by snowkite',
  kind: 'tour',
  disciplines: ['snowkite'],
  operator: {
    name: 'Expeditions Unlimited',
    websiteUrl: `${SITE}/en/`,
    rootDomain: 'expeditions-unlimited.com',
    contactEmail: 'contact@expeditions-unlimited.com',
    phone: '+33 4 78 37 88 88',
  },
  url: EUG_URL,
  slotMethod: 'jsonld',
  fetchBudget: 2,
  async fetchContent() {
    return parseEugContent(await page(EUG_URL));
  },
  fetchSlots: ctx => fetchEugSlots(todayIso(), ctx),
};
