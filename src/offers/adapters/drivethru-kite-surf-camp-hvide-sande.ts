// ---------------------------------------------------------------------------
// Drivethru Kite & Surf Camp, Hvide Sande (West Jutland, Denmark) - kite, surf and movement camp of the German operator
// Drivethru GmbH in a roughly 200-year-old thatched dune farmhouse ("Dünenhof") between the North Sea and Ringkøbing Fjord:
// 20 guests in double and 4-bed rooms, 35,000 m² garden, sauna and hot tub, and a private access to the fjord that is the
// camp's own kite spot (lessons, supervised kiting or rental only). Weekly camps from Saturday to Saturday with meals.
//
// Data path (checked 2026-10-12), WordPress (German pages are the current ones, title "Angebote2026", modified 2026-02-27):
//   slots    /daenemark/hvide-sande/angebot/: one block per package - <h2>/<h3> name, <div class="price …"> "Ab 1190,- € / 7 Tage
//            im 4-Bett-Zimmer", <ul class="features-list"> inclusions. Only the Kite Camp becomes a slot.
//   content  the same page + /en/denmark/hvide-sande/price-and-service/ (the English copy of the package lists; it still
//            shows the 2025 New Year special, so prices are taken from the German page), /daenemark/hvide-sande/unterkunft/
//            (house and rooms), /daenemark/hvide-sande/kite-yoga/ (fjord spot), /daenemark/hvide-sande/faq/ (Saturday arrivals).
// Booking engine: bookings.drivethru.de = Bookinglayer; its API (api.bookinglayer.io) is robots.txt "Disallow: /" for us, so
//   there are no dates and no live availability - the published "from" price only.
// robots.txt (2026-10-12): www.drivethru.de "Allow: /".
// Requests per run: content 5, slots 1 (memoised with content).
// Parsed: 1 slot "Kite Camp - bed in a 4-bed room": EUR per person for the 7-night camp (priceUnit 'package', packageNights 7,
//   priceBasis 'person', occupancy 1), no dates, availability 'unknown'. The surf, movement and comfort camps and the New Year
//   special are listed in the optional services only (no kite content).
// Known limits: no season dates on the site (camps run weekly; B&B on any day in the off-season); no map pin (address only).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, detectCurrency, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.drivethru.de';
export const DTC_OFFER_URL = `${SITE}/daenemark/hvide-sande/angebot/`;
export const DTC_OFFER_EN_URL = `${SITE}/en/denmark/hvide-sande/price-and-service/`;
export const DTC_HOUSE_URL = `${SITE}/daenemark/hvide-sande/unterkunft/`;
export const DTC_KITE_URL = `${SITE}/daenemark/hvide-sande/kite-yoga/`;
export const DTC_FAQ_URL = `${SITE}/daenemark/hvide-sande/faq/`;
const BOOKING_URL = 'https://bookings.drivethru.de/en/category/surf-kite-camp-hvide-sande';

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share the offer page */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const text = (h: string): string => clean(h.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '));

/** Visible text lines (scripts, styles dropped), split at block tags. */
export function dtcLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|figure|table)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

export interface DtcPackage { name: string; priceText: string; price: number | null; currency: string | null; nights: number | null; room: string | null; features: string[] }

const GENERIC_HEADINGS = /^(Leistungen inklusive|Services included|Das ist inklusive:?|What’s included\??|Unsere Highlights:?|Our Highlights:?)$/i;

/** Package blocks: name = last real heading before the price box, features = the list after it. */
export function parseDtcPackages(html: string): DtcPackage[] {
  const prices = [...html.matchAll(/<div class="price[^"]*">([\s\S]*?)<\/div>/g)];
  return prices.map((m, i) => {
    const heads = [...html.slice(0, m.index!).matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/g)].map(h => text(h[1])).filter(h => h && !GENERIC_HEADINGS.test(h));
    const after = html.slice(m.index!, prices[i + 1]?.index ?? html.length);
    const list = after.match(/<ul class="features-list[^"]*">([\s\S]*?)<\/ul>/)?.[1] ?? '';
    const priceText = text(m[1]);
    const nights = priceText.match(/\/\s*(\d+)\s*(?:Tage|days|Nächte|Nights)/i)?.[1];
    return {
      name: heads[heads.length - 1] ?? '',
      priceText,
      price: parseAmount(priceText.replace(/,-/g, '')),
      currency: detectCurrency(priceText),
      nights: nights ? Number(nights) : null,
      room: priceText.match(/im (4-Bett-Zimmer|4er Dorm)|in a (4 Person Dorm|4-bed dorm)/i)?.[0]?.replace(/^(im|in a) /i, '') ?? null,
      features: [...list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(x => text(x[1])).filter(Boolean),
    };
  });
}

export const DTC_KITE_UNIT = 'Kite Camp - bed in a 4-bed room';

export function buildDtcSlots(packages: DtcPackage[]): Slot[] {
  const kite = packages.find(p => /^Kite Camp$/i.test(p.name));
  if (!kite || !kite.price || !kite.currency) return [];
  return [{
    key: 'kite-camp|4-bed-room',
    startDate: null,
    endDate: null,
    unit: DTC_KITE_UNIT,
    price: kite.price,
    currency: kite.currency,
    priceUnit: 'package',
    priceBasis: 'person',
    occupancy: 1,
    availability: 'unknown',
    availabilityText: kite.priceText,
    spotsLeft: null,
    packageNights: kite.nights === 7 ? 7 : kite.nights,
  }];
}

/** Drivethru photos of the package sliders (largest 1856x1230 renditions), cache-buster dropped; other destinations excluded. */
export function dtcImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<figure class="right"><img src="(https:\/\/www\.drivethru\.de\/content\/uploads\/[^"?]+)(?:\?[^"]*)?"/g)) {
    if (/sri|madiha|polhena|peru|boat|malediv/i.test(m[1]) || out.includes(m[1])) continue;
    out.push(m[1]);
  }
  for (const m of html.matchAll(/<img[^>]+src="(https:\/\/www\.drivethru\.de\/content\/uploads\/[^"?]+?-\d{3,4}x\d{3,4}\.(?:jpe?g|webp))(?:\?[^"]*)?"/g)) {
    const w = Number(m[1].match(/-(\d{3,4})x\d{3,4}\./)?.[1] ?? 0);
    if (w < 1000 || /sri|madiha|polhena|peru|boat|malediv|aspect-ratio/i.test(m[1]) || out.includes(m[1])) continue;
    out.push(m[1]);
  }
  return out;
}

export interface DtcPages { offer: string; offerEn: string; house: string; kite: string; faq: string }

export function parseDrivethruContent(p: DtcPages): OfferContent {
  const de = parseDtcPackages(p.offer);
  const en = parseDtcPackages(p.offerEn);
  const kiteDe = de.find(x => /^Kite Camp$/i.test(x.name));
  const kiteEn = en.find(x => /^Kite Camp$/i.test(x.name));
  const house = dtcLines(p.house).join(' ');
  const guests = house.match(/Platz für (\d+) Leute/)?.[1] ?? null;
  const faq = dtcLines(p.faq);
  const arrival = faq.find(l => /Anreisetage am Samstag/i.test(l)) ?? null;
  const spot = dtcLines(p.kite).find(l => /Stehrevieren/i.test(l)) ?? null;
  const eur = (n: number | null) => (n ? `EUR ${n.toLocaleString('en-US')}` : '-');
  const inclusions = (kiteEn?.features.length ? kiteEn.features : kiteDe?.features ?? []).filter(f => !/on demand|auf Anfrage/i.test(f));
  const onDemand = (kiteEn?.features ?? []).filter(f => /on demand/i.test(f));

  const rooms: ContentRoom[] = [
    { name: 'Double room', description: 'Room with two single beds that can be pushed together, direct or side view of Ringkøbing Fjord; some rooms with a private bathroom, otherwise one of two shared bathrooms.', features: ['Fjord view', 'Free Wi-Fi', 'Bed linen and towels provided'] },
    { name: '4-bed shared room', description: 'Shared dorm with four beds for solo travellers, direct or side view of the fjord.', features: ['Fjord view', 'Free Wi-Fi', ...(kiteDe?.price ? [`Kite Camp ${eur(kiteDe.price)} per person for 7 nights`] : [])] },
  ];
  const imgs: string[] = [];
  for (const u of [...dtcImages(p.offer), ...dtcImages(p.house), ...dtcImages(p.kite)]) if (!imgs.includes(u)) imgs.push(u);

  const summary = [
    `Drivethru Kite & Surf Camp is a kite, surf and movement camp in a roughly 200-year-old thatched dune farmhouse near Hvide Sande on the west coast of Denmark, between the North Sea and Ringkøbing Fjord, with a 35,000 m² garden, sauna, hot tub and a private access to the fjord that serves as the camp's own kite spot.`,
    `The house sleeps ${guests ?? 20} guests in double rooms and 4-bed shared rooms; camps run from Saturday to Saturday with three meals a day (breakfast only on Mondays and Thursdays).`,
    `The Kite Camp combines a week's stay with kite lessons and equipment, supervised kiting or equipment rental in small groups on the shallow fjord${kiteDe?.price ? `, from ${eur(kiteDe.price)} per person for 7 nights in a 4-bed room` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Drivethru Kite & Surf Camp Hvide Sande',
    summary,
    continent: 'Europe',
    country: 'Denmark',
    region: 'Hvide Sande, West Jutland',
    spot: 'Hvide Sande',
    itinerarySpots: [],
    durationDays: null,
    // German page: "Ob Anfänger oder fortgeschrittener Kiter" + "Flachwasserbereich für Anfänger"
    skillLevels: ['beginner', 'intermediate'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: inclusions,
    optionalServices: [
      ...onDemand,
      ...de.filter(x => !/^Kite Camp$/i.test(x.name) && x.price).map(x => `${x.name.replace(/^Silvester Special/i, 'New Year special')}: ${x.priceText.replace(/^Ab /, 'from ').replace(/,-\s*€/, ' EUR').replace(/Tage im 4-Bett-Zimmer/, 'days in a 4-bed room').replace(/Nächte im 4er Dorm/, 'nights in a 4-bed dorm')}`),
      'Airport transfer from Billund or Ringkøbing station (extra charge)', 'Massages',
    ],
    accommodation: 'double and 4-bed rooms in a thatched farmhouse',
    mealPlan: 'full_board',
    languages: ['de', 'en'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: DTC_OFFER_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `packages (de): ${de.map(x => `${x.name.replace(/^Silvester Special/i, 'New Year special')}: ${x.priceText}`).join(' | ')}`,
      `kite camp inclusions (en): ${kiteEn?.features.join('; ') ?? '-'}`,
      `house: ${house.match(/Die Unterkunft im Hvide Sande Surfcamp[^.]*\.[^.]*\./)?.[0] ?? ''}`,
      `kite spot: ${spot ?? ''}`,
      `faq: ${arrival ?? ''}`,
    ].join('\n'),
  };
}

export async function fetchDtcSlots(): Promise<Slot[]> {
  const packages = parseDtcPackages(await page(DTC_OFFER_URL));
  const slots = buildDtcSlots(packages);
  if (slots.length === 0) throw new Error(`drivethru: "Kite Camp" price box not found on the offer page (packages: ${packages.map(p => p.name).join(', ')})`);
  return slots;
}

export const drivethruKiteSurfCampHvideSande: OfferAdapter = {
  key: 'drivethru-kite-surf-camp-hvide-sande',
  name: 'Drivethru Kite & Surf Camp Hvide Sande',
  kind: 'accommodation',
  operator: {
    name: 'Drivethru GmbH',
    websiteUrl: SITE,
    rootDomain: 'drivethru.de',
    contactEmail: 'booking@drivethru.de',
    phone: '+4521430944',
  },
  url: DTC_OFFER_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 6,
  confidence: 'medium', // "from" price without dates; Bookinglayer (dates, availability) is robots-blocked
  async fetchContent() {
    const offer = await page(DTC_OFFER_URL);
    const offerEn = await page(DTC_OFFER_EN_URL);
    const house = await page(DTC_HOUSE_URL);
    const kite = await page(DTC_KITE_URL);
    const faq = await page(DTC_FAQ_URL);
    return parseDrivethruContent({ offer, offerEn, house, kite, faq });
  },
  async fetchSlots() {
    return fetchDtcSlots();
  },
};
