// ---------------------------------------------------------------------------
// NaneaKite "8 days Kitesurf Camp Essaouira" (Morocco) - the school's week package: 7 nights in a riad in the
// medina (Riad Aylal, private room, daily breakfast), 12 hours of kite lessons with IKO certification, all gear,
// surfing included, a team dinner on the last day.
//
// Data path (checked 2026-10-19): ONE server-rendered page, https://naneakite.com/8-days-kitesurf-camp-essaouira/
//   (custom PHP site, clean markup). The "Camp type and prices" section (section[data-nk="prices"]) has one
//   <article class="ctype"> per variant: <h3 class="ctype__t"> name, <p class="ctype__note"> instructor ratio,
//   <p class="ctype__p"> "€599 per person". 2026-10-19: Group classes (single, double or triple room) EUR 599,
//   Semi-private classes + private room EUR 699, Private classes + private room EUR 799, all per person.
//   Booking = "Send Enquiry" mailto per variant ("We reply with availability and confirm your booking"), no engine.
//   The site's JSON-LD (LocalBusiness) carries the school's geo point in Essaouira (used as spotCoords).
// robots.txt naneakite.com (2026-10-19): "Allow: /".
// Requests per run: 1 (content + slots share one memoised page fetch).
// Slots: one undated slot per variant, EUR per person for the 7-night package (priceUnit 'package',
//   packageNights 7), availability 'on_request'. No dates on the page: the camp runs on request all year.
// Known limits: og:description still says "group camp for just €580" (stale meta); the visible price list wins.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, jsonLd, parse, parseAmount, detectCurrency, type HTMLElement } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

export const NANEA_URL = 'https://naneakite.com/8-days-kitesurf-camp-essaouira/';

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');
/** Parsed page without scripts / styles (JSON-LD would otherwise leak into the text). */
function visible(html: string): HTMLElement {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg')) el.remove();
  return root;
}

export interface NaneaVariant { key: string; name: string; note: string | null; price: number | null; currency: string | null; perPerson: boolean }

/** "Group classes single, double, or triple rooms." -> group; "Semi-Private ..." -> semi-private; "Private ..." -> private */
function variantKey(name: string): string {
  if (/semi[\s-]?private/i.test(name)) return 'semi-private';
  if (/private classes|private instructor/i.test(name)) return 'private';
  if (/group/i.test(name)) return 'group';
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'camp';
}

export function parseNaneaVariants(html: string): NaneaVariant[] {
  const root = parse(html);
  const sec = root.querySelector('section[data-nk="prices"]') ?? root.querySelector('#camp-types');
  if (!sec) return [];
  return sec.querySelectorAll('article.ctype').map(a => {
    const name = txt(a.querySelector('.ctype__t')).replace(/\.$/, '').replace(/\s+/g, ' ');
    const priceText = txt(a.querySelector('.ctype__p'));
    return {
      key: variantKey(name),
      name,
      note: txt(a.querySelector('.ctype__note')) || null,
      price: parseAmount(priceText),
      currency: detectCurrency(priceText),
      perPerson: /per person|\bpp\b/i.test(priceText),
    };
  }).filter(v => v.name);
}

export interface NaneaFacts { days: number | null; nights: number | null; hours: number | null }
export function parseNaneaFacts(html: string): NaneaFacts {
  const t = collapse(visible(html).text);
  const dn = t.match(/(\d+)\s*Days?\s*\/\s*(\d+)\s*Nights?/i);
  const h = t.match(/(\d+)\s*Hours?\s*Kitesurf Lessons/i) ?? t.match(/(\d+)-hour kitesurfing lessons/i);
  return { days: dn ? Number(dn[1]) : null, nights: dn ? Number(dn[2]) : null, hours: h ? Number(h[1]) : null };
}

export function buildNaneaSlots(vs: NaneaVariant[], nights: number | null): Slot[] {
  return vs.map(v => ({
    key: v.key,
    startDate: null,
    endDate: null,
    unit: (v.note ? `${v.name} (${v.note})` : v.name).replace(/\bwhit\b/gi, 'with').replace(/\bprivat\b/gi, 'private'),
    price: v.price,
    currency: v.price !== null ? v.currency ?? 'EUR' : null,
    priceUnit: v.price !== null ? 'package' as const : null,
    priceBasis: v.price !== null ? 'person' as const : null,
    occupancy: 1,
    availability: 'on_request' as const,
    availabilityText: 'Enquiry by e-mail ("Send Enquiry"); the school replies with availability and confirms the booking',
    spotsLeft: null,
    packageNights: nights,
  }));
}

/** One <ul class="panel__list"> under the panel whose title matches. */
function panelList(root: HTMLElement, title: RegExp): string[] {
  const head = root.querySelectorAll('h2.panel__t').find(h => title.test(txt(h)));
  const panel = head?.parentNode as HTMLElement | undefined;
  return (panel?.querySelectorAll('li') ?? []).map(li => txt(li)).filter(Boolean);
}
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function parseNaneaContent(html: string, url = NANEA_URL): OfferContent {
  const root = visible(html);
  const text = collapse(root.text);
  const f = parseNaneaFacts(html);
  const vs = parseNaneaVariants(html);
  const nights = f.nights ?? 7;
  const geo = jsonLd(html).map(o => o.geo as Record<string, unknown> | undefined).find(g => g && g.latitude && g.longitude);
  const riadRaw = text.match(/ACCOMMODATION\s+(RIAD [A-Za-z]+)/i)?.[1];
  const riad = riadRaw ? riadRaw.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : null;
  const priceLine = vs.filter(v => v.price).map(v => `${v.name.replace(/\s*(single, double, or triple rooms|and privat room)$/i, '')} EUR ${v.price}`).join(', ');

  const summary = [
    `NaneaKite's ${f.days ?? nights + 1}-day kitesurf camp in Essaouira, Morocco: ${nights} nights in a riad in the medina${riad ? ` (${riad})` : ''} with daily breakfast, ${f.hours ?? 12} hours of kite lessons with IKO certification and all kite and surf gear, plus a team dinner on the last day.`,
    `Lessons run in small groups (at most two students per instructor) for beginners and intermediate riders at the Essaouira kite spot; surfing is included at any time.`,
    priceLine ? `Prices per person: ${priceLine}; booking by enquiry, no fixed dates.` : 'Booking by enquiry, no fixed dates.',
  ].join(' ');

  return {
    kind: 'camp',
    title: 'NaneaKite 8 Days Kitesurf Camp Essaouira',
    summary,
    continent: 'Africa',
    country: 'Morocco',
    region: 'Marrakech-Safi',
    spot: 'Essaouira',
    spotCoords: geo ? { lat: Number(geo.latitude), lng: Number(geo.longitude) } : null,
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner', 'intermediate'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: panelList(root, /Price Includes/i).map(cap),
    optionalServices: ['Extra lesson hours and extra nights on request', 'Airport transfer (Essaouira, Marrakesh or Agadir; arranged by the school)'],
    accommodation: `riad in the Essaouira medina${riad ? ` (${riad})` : ''}, rooms with private bathroom`,
    mealPlan: 'breakfast',
    languages: ['en', 'fr', 'es', 'ar'],
    rooms: [],
    imageUrls: imageCandidates(html, url, null, 30).filter(u => !/logo|naneakite-surf-camp\.png/i.test(u)),
    heroVideoUrl: null,
    sourceUrl: url,
    bookingUrl: url,
    sourceText: text,
  };
}

export const naneakite8DayCampEssaouira: OfferAdapter = {
  key: 'naneakite-8-day-camp-essaouira',
  name: 'NaneaKite 8 Days Kitesurf Camp, Essaouira',
  kind: 'camp',
  operator: {
    name: 'NaneaKite',
    websiteUrl: 'https://naneakite.com/',
    rootDomain: 'naneakite.com',
    contactEmail: 'naneakite@gmail.com',
    whatsapp: '+212601297087',
    phone: '+212601297087',
  },
  url: NANEA_URL,
  slotMethod: 'price_table',
  liveAvailability: false,
  instantBooking: false,
  fetchBudget: 2,
  async fetchContent() {
    return parseNaneaContent(await page(NANEA_URL));
  },
  async fetchSlots() {
    const html = await page(NANEA_URL);
    const vs = parseNaneaVariants(html);
    if (vs.length === 0) throw new Error('naneakite: "Camp type and prices" cards not found (layout changed?)');
    return buildNaneaSlots(vs, parseNaneaFacts(html).nights);
  },
};
