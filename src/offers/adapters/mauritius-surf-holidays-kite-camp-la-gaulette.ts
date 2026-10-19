// ---------------------------------------------------------------------------
// Mauritius Surf Holidays Kite Camp, La Gaulette (Mauritius) - the Italian-run surf house + kite school opposite
// Le Morne: 7 or 14 nights in a private double room at the surf house, 10 hours of semi-private or 8 hours of
// private kite lessons with IKO certificate, airport transfer both ways and transfers to the beach for the lessons.
// No meals included.
//
// Data path (checked 2026-10-19): ONE server-rendered page (MODX CMS),
//   https://www.mauritiussurfholidays.com/en/kitesurf/kitecamp.html. "Price list :" with lines
//   "1 person 7 nigths : 690 euro" / "2 persons 7 nigths : 1150 euro" / "1 person 14 nigths : 890 euro" /
//   "2 persons 14 nigths : 1290 euro" (typo as printed). The 2-person price is read as the total for two
//   (it is below twice the 1-person price); normalised per person, the printed total kept in priceTotal.
//   Booking: contact form / WhatsApp on the page, no engine; no dates (year-round).
//   Photos: the page's "Photo gallery Kitesurf Camp" (<a href="/assets/img-cache/gallery/<id>/...jpg"> full size).
// robots.txt (2026-10-19): "User-agent: *" with no rules -> allowed.
// Requests per run: 1 (content + slots share one memoised page fetch).
// Slots: 4 undated slots (persons x nights), EUR per person, priceUnit 'package', packageNights 7 / 14,
//   availability 'on_request'.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, meta, parse, parseAmount, type HTMLElement } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.mauritiussurfholidays.com';
export const MSH_URL = `${SITE}/en/kitesurf/kitecamp.html`;

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
function visible(html: string): HTMLElement {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, iframe')) el.remove();
  return root;
}

export interface MshPrice { persons: number; nights: number; total: number }

/** "1 person 7 nigths : 690 euro" (the site's spelling) / "2 persons 14 nights: 1290 €" */
export function parseMshPrices(html: string): MshPrice[] {
  const t = collapse(visible(html).structuredText);
  const out: MshPrice[] = [];
  for (const m of t.matchAll(/(\d+)\s*persons?\s+(\d+)\s*n[a-z]{3,5}s?\s*:\s*(\d[\d.,]*)\s*(?:euros?\b|€|eur\b)/gi)) {
    const p = { persons: Number(m[1]), nights: Number(m[2]), total: parseAmount(m[3]) ?? 0 };
    if (p.persons > 0 && p.nights > 0 && p.total > 0 && !out.some(x => x.persons === p.persons && x.nights === p.nights)) out.push(p);
  }
  return out;
}

export function buildMshSlots(prices: MshPrice[]): Slot[] {
  return prices.map(p => ({
    key: `${p.nights}n|${p.persons}p`,
    startDate: null,
    endDate: null,
    unit: `${p.nights} nights, ${p.persons === 1 ? '1 person in' : `${p.persons} persons sharing`} a private double room`,
    price: Math.round((p.total / p.persons) * 100) / 100,
    currency: 'EUR',
    priceUnit: 'package' as const,
    priceBasis: 'person' as const,
    occupancy: p.persons,
    availability: 'on_request' as const,
    availabilityText: `EUR ${p.total} for ${p.persons === 1 ? '1 person' : `${p.persons} persons`}, ${p.nights} nights; booking by request (form or WhatsApp)`,
    spotsLeft: null,
    priceTotal: p.persons > 1 ? p.total : null,
    packageNights: p.nights,
  }));
}

/** Full-size gallery photos (the gallery links), og:image first. */
export function mshImages(html: string): string[] {
  const out: string[] = [];
  const og = meta(html, 'og:image');
  if (og) out.push(new URL(og, SITE).toString());
  for (const m of html.matchAll(/<a\b[^>]*href="(\/assets\/img-cache\/gallery\/\d+\/[^"]+\.(?:jpe?g|png|webp))"/gi)) {
    const u = `${SITE}${m[1]}`;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

function listAfter(root: HTMLElement, heading: RegExp): string[] {
  const text = root.structuredText.split('\n').map(s => collapse(s)).filter(Boolean);
  const i = text.findIndex(l => heading.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of text.slice(i + 1)) {
    if (/:\s*$/.test(l) || /^Price list/i.test(l)) break;
    out.push(l);
  }
  return out;
}

export function parseMshContent(html: string): OfferContent {
  const root = visible(html);
  const text = collapse(root.structuredText);
  const prices = parseMshPrices(html);
  const one7 = prices.find(p => p.persons === 1 && p.nights === 7);
  const two7 = prices.find(p => p.persons === 2 && p.nights === 7);
  const included = listAfter(root, /What is included/i).map(s => s.replace(/transfert/gi, 'transfer').replace(/Tranfert/gi, 'Transfer').replace(/Accomodation/gi, 'Accommodation').replace(/\s+\.$/, '').trim());
  const excluded = listAfter(root, /What is not i[n]?cluded/i);

  const summary = [
    `Mauritius Surf Holidays runs a kite camp from its surf house in La Gaulette, across the lagoon from Le Morne, the island's best-known kite beach in the south-west of Mauritius.`,
    `The package includes a private double room, 10 hours of semi-private or 8 hours of private kite lessons with IKO certificate, transfers to the beach for the lessons and a round-trip airport transfer; meals are not included.`,
    one7 ? `Prices: EUR ${one7.total} for one person and 7 nights${two7 ? `, EUR ${two7.total} for two` : ''}${prices.some(p => p.nights === 14) ? `; 14 nights from EUR ${prices.filter(p => p.nights === 14 && p.persons === 1)[0]?.total ?? ''}` : ''}; booking by request, any dates.` : 'Prices on request.',
  ].join(' ');

  return {
    kind: 'camp',
    title: 'Mauritius Surf Holidays Kite Camp, La Gaulette',
    summary,
    continent: 'Africa',
    country: 'Mauritius',
    region: 'Le Morne, Black River',
    spot: 'La Gaulette',
    itinerarySpots: [],
    durationDays: 8,
    skillLevels: ['beginner'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: included,
    optionalServices: ['Kite equipment rental after the course', 'Excursions (dolphins, trekking, yoga) on no-wind days'],
    accommodation: 'private double room in the surf house (La Gaulette)',
    mealPlan: excluded.some(l => /breakfast/i.test(l)) ? 'self_catering' : null,
    languages: ['en', 'it'],
    rooms: [],
    imageUrls: mshImages(html).slice(0, 30),
    heroVideoUrl: null, // the page embeds a YouTube video only
    sourceUrl: MSH_URL,
    bookingUrl: MSH_URL,
    sourceText: text,
  };
}

export const mauritiusSurfHolidaysKiteCampLaGaulette: OfferAdapter = {
  key: 'mauritius-surf-holidays-kite-camp-la-gaulette',
  name: 'Mauritius Surf Holidays Kite Camp, La Gaulette',
  kind: 'camp',
  operator: {
    name: 'Mauritius Surf Holidays',
    websiteUrl: `${SITE}/`,
    rootDomain: 'mauritiussurfholidays.com',
    contactEmail: 'info@mauritiussurfholidays.com',
    whatsapp: '+23058432689',
    phone: '+23058432689',
  },
  url: MSH_URL,
  slotMethod: 'price_table',
  liveAvailability: false,
  instantBooking: false,
  fetchBudget: 2,
  async fetchContent() {
    return parseMshContent(await page(MSH_URL));
  },
  async fetchSlots() {
    const prices = parseMshPrices(await page(MSH_URL));
    if (prices.length === 0) throw new Error('mauritius-surf-holidays: "Price list" lines not found (layout changed?)');
    return buildMshSlots(prices);
  },
};
