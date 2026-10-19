// ---------------------------------------------------------------------------
// Essaouira Watersports kitesurf packages, Essaouira (Morocco) - the IKO school's lessons + accommodation packages:
// 3 to 6 nights with 6 to 12 hours of kite lessons (2 h per night), gear, breakfast, free surf rental and a team
// dinner on the last day, in one of three medina stays (Hostel, Maison du Sud, Riad Zahra Authentic).
//
// Data path (checked 2026-10-19): Next.js site, server-rendered.
//   index    /packages/kitesurf lists the stays (h3 title, description, "From €214") and links each stay page
//            /packages/kitesurf/<stay> (read from the index, so a new stay is picked up).
//   slots    each stay page prints one card per package; its "Book now" link carries the package as query
//            parameters: /book/book-multi-sport-packages?sport=kitesurf&accommodation=hostel&duration=3nights
//            &hours=6h&price=214&persons=1. The booking builder takes `price` from that link (priceOverride in its
//            own script), so these are the prices a guest books at. 2026-10-19: Hostel 1 person 214/282/350/418,
//            Maison du Sud 310/410/510/610 (1 person) and 525/692/860/1028 (2 persons), Riad Zahra 325/430/535/640
//            and 525/692/860/1028, EUR totals for 3/4/5/6 nights.
//            The builder's own fallback matrix (in a JS chunk, used without a package link: "Kitesurf €225 3n · 6h")
//            differs slightly (dorm 225/290/355/420, double 525/670/815/970); it is not read.
//   booking  the builder books online: pick sport, stay, duration and start date, pay a deposit by PayPal or card
//            ("Deposit received - you're booked"), the balance at the school -> instantBooking true. No availability
//            calendar or inventory (every future day is selectable) -> availability 'unknown', liveAvailability false.
// robots.txt (2026-10-19): "User-agent: * Allow: /", Crawl-delay 1 (the shared 1.5 s throttle covers it).
// Requests per run: 1 index + 1 per stay (3 on 2026-10-19), memoised between content and slots.
// Slots: one undated slot per stay x nights x persons; price normalised per person (2-person totals / 2, the
//   printed total in priceTotal), priceUnit 'package', packageNights = nights.
// Known limits: only five photos are server-rendered (the stay carousels load client-side).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, jsonLd, parse, type HTMLElement } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.essaouirawatersports.com';
export const EW_INDEX_URL = `${SITE}/packages/kitesurf`;
export const EW_BOOK_URL = `${SITE}/book/book-multi-sport-packages`;

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
  for (const el of root.querySelectorAll('script, style, noscript, svg, template')) el.remove();
  return root;
}
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');
/** Page text with block breaks kept (for sourceText). */
const blockText = (html: string): string => collapse(visible(html).structuredText.replace(/<!DOCTYPE[^>]*>/i, ''));

// --- index ------------------------------------------------------------------------------------
export interface EwStay { slug: string; name: string; description: string | null; fromPrice: number | null; rooms: string | null; url: string }

/** Stay cards of /packages/kitesurf: link /packages/kitesurf/<slug> with h3 name, description and "From €x". */
export function parseEwIndex(html: string): EwStay[] {
  const root = visible(html);
  const out: EwStay[] = [];
  for (const a of root.querySelectorAll('a[href^="/packages/kitesurf/"]')) {
    const slug = (a.getAttribute('href') ?? '').split('/')[3]?.split(/[?#]/)[0];
    if (!slug || out.some(s => s.slug === slug)) continue;
    const name = txt(a.querySelector('h3')) || slug;
    const t = collapse(a.structuredText);
    const paras = a.querySelectorAll('p').map(x => txt(x)).sort((x, y) => y.length - x.length);
    const from = t.match(/From\s*€\s?(\d[\d,.]*)/i);
    out.push({
      slug,
      name,
      description: paras[0] && paras[0].length > 40 ? paras[0] : null,
      fromPrice: from ? Number(from[1].replace(/[,.]/g, '')) : null,
      rooms: t.match(/Rooms\s*(.+?)\s*Breakfast/i)?.[1] ?? null,
      url: `${SITE}/packages/kitesurf/${slug}`,
    });
  }
  return out;
}

// --- stay pages ---------------------------------------------------------------------------------
export interface EwPackage { stay: string; nights: number; hours: number; price: number; persons: number }

/** The "Book now" links of a stay page: sport=kitesurf&accommodation=<slug>&duration=3nights&hours=6h&price=214&persons=1 */
export function parseEwPackages(html: string): EwPackage[] {
  const out: EwPackage[] = [];
  for (const m of html.matchAll(/href="\/book\/book-multi-sport-packages\?([^"]+)"/g)) {
    const q = new URLSearchParams(m[1].replace(/&amp;/g, '&'));
    if (q.get('sport') !== 'kitesurf') continue;
    const nights = Number(q.get('duration')?.match(/^(\d+)nights?$/)?.[1]);
    const hours = Number(q.get('hours')?.match(/^(\d+)h$/)?.[1]);
    const price = Number(q.get('price'));
    const persons = Number(q.get('persons') ?? 1);
    const stay = q.get('accommodation') ?? '';
    if (!stay || !(nights > 0) || !(price > 0) || !(persons > 0)) continue;
    if (out.some(p => p.stay === stay && p.nights === nights && p.persons === persons)) continue;
    out.push({ stay, nights, hours: hours > 0 ? hours : nights * 2, price, persons });
  }
  return out.sort((a, b) => a.persons - b.persons || a.nights - b.nights);
}

const AVAIL_TEXT = 'Online booking with a deposit (PayPal or card), balance at the school; no availability calendar';

export function buildEwSlots(stays: EwStay[], pkgs: EwPackage[]): Slot[] {
  return pkgs.map(p => {
    const stay = stays.find(s => s.slug === p.stay);
    const name = stay?.name ?? p.stay;
    const perPerson = Math.round((p.price / p.persons) * 100) / 100;
    return {
      key: `${p.stay}|${p.nights}n|${p.persons}p`,
      startDate: null,
      endDate: null,
      unit: `${name}, ${p.nights} nights + ${p.hours}h kitesurfing, ${p.persons === 1 ? '1 person' : `${p.persons} persons sharing`}`,
      price: perPerson,
      currency: 'EUR',
      priceUnit: 'package' as const,
      priceBasis: 'person' as const,
      occupancy: p.persons,
      availability: 'unknown' as const,
      availabilityText: AVAIL_TEXT,
      spotsLeft: null,
      priceTotal: p.persons > 1 ? p.price : null,
      packageNights: p.nights,
    };
  });
}

// --- content ------------------------------------------------------------------------------------
export interface EwPages { index: string; stays: Array<[string, string]> } // [slug, html]

export function ewImages(pages: string[]): string[] {
  const out: string[] = [];
  for (const html of pages) {
    for (const m of html.matchAll(/(?:https:\/\/www\.essaouirawatersports\.com)?(\/images\/(?:photos|pictures[a-z]*|repictures[a-z]*)\/[^"'\s?,)\\]+\.(?:webp|jpe?g|png))/gi)) {
      const u = `${SITE}${m[1]}`;
      if (!out.includes(u)) out.push(u);
    }
  }
  return out;
}

/** The school's JSON-LD GeoCoordinates (SportsActivityLocation in the page head). */
export function ewGeo(html: string): { lat: number; lng: number } | null {
  for (const o of jsonLd(html)) {
    const g = o.geo as Record<string, unknown> | undefined;
    if (g && Number.isFinite(Number(g.latitude)) && Number.isFinite(Number(g.longitude))) return { lat: Number(g.latitude), lng: Number(g.longitude) };
  }
  return null;
}

export function parseEwContent(p: EwPages): OfferContent {
  const stays = parseEwIndex(p.index);
  const pkgs = p.stays.flatMap(([, html]) => parseEwPackages(html));
  const single = pkgs.filter(x => x.persons === 1);
  const minNights = Math.min(...pkgs.map(x => x.nights));
  const maxNights = Math.max(...pkgs.map(x => x.nights));
  const firstStay = p.stays[0]?.[1] ?? '';
  const incRoot = visible(firstStay);
  const incHead = incRoot.querySelectorAll('h4').find(h => /^Included/i.test(txt(h)));
  const included = (incHead?.parentNode as HTMLElement | undefined)?.querySelectorAll('li').map(li => txt(li)).filter(Boolean) ?? [];
  const cheapest = single.sort((a, b) => a.price - b.price)[0];

  const summary = [
    `Essaouira Watersports, an IKO kite school in Essaouira (Morocco), sells kitesurf packages of ${minNights} to ${maxNights} nights with 2 hours of kite lessons per night (${minNights * 2} to ${maxNights * 2} hours), equipment, breakfast, free surf rental and a dinner with the team on the last day.`,
    `Guests choose one of ${stays.length || 'three'} stays in the medina: ${stays.map(s => s.name).join(', ') || 'Hostel, Maison du Sud, Riad Zahra Authentic'}.`,
    cheapest ? `Packages start at EUR ${cheapest.price} for ${cheapest.nights} nights and ${cheapest.hours} hours (1 person${stays.find(s => s.slug === cheapest.stay) ? `, ${stays.find(s => s.slug === cheapest.stay)!.name}` : ''}); booking online with a deposit, any start date.` : 'Booking online with a deposit, any start date.',
  ].join(' ');

  return {
    kind: 'camp',
    title: 'Essaouira Watersports Kitesurf Package',
    summary,
    continent: 'Africa',
    country: 'Morocco',
    region: 'Marrakech-Safi',
    spot: 'Essaouira',
    spotCoords: ewGeo(p.index), // the school's own JSON-LD geo (SportsActivityLocation): 31.5085 / -9.7595 on 2026-10-19
    itinerarySpots: [],
    durationDays: Number.isFinite(maxNights) ? maxNights + 1 : 7,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      `${minNights}-${maxNights} nights in the chosen stay${stays.length ? ` (${stays.map(x => x.name).join(', ')})` : ''}`,
      `${minNights * 2}-${maxNights * 2} hours of IKO kitesurf lessons`,
      ...included.filter(x => !/^Accommodation$/i.test(x)),
    ],
    optionalServices: ['Surf and wingfoil packages (same stays)', 'Extra lessons and equipment rental at the school'],
    accommodation: 'medina stays: hostel (dorm or private), Maison du Sud or Riad Zahra Authentic (single or double)',
    mealPlan: 'breakfast',
    languages: ['en', 'fr', 'es'],
    rooms: stays.map(s => ({ name: s.name, description: s.description, features: s.rooms ? [s.rooms] : [] })),
    imageUrls: ewImages([p.index, ...p.stays.map(([, h]) => h)]),
    heroVideoUrl: null,
    sourceUrl: EW_INDEX_URL,
    bookingUrl: EW_BOOK_URL,
    sourceText: [blockText(p.index), ...p.stays.map(([slug, h]) => `${slug}: ${blockText(h)}`)].join('\n'),
  };
}

async function loadPages(): Promise<EwPages & { list: EwStay[] }> {
  const index = await page(EW_INDEX_URL);
  const list = parseEwIndex(index);
  if (list.length === 0) throw new Error('essaouira-watersports: no stay links on /packages/kitesurf (layout changed?)');
  const stays: Array<[string, string]> = [];
  for (const s of list) stays.push([s.slug, await page(s.url)]);
  return { index, stays, list };
}

export const essaouiraWatersportsKitePackage: OfferAdapter = {
  key: 'essaouira-watersports-kite-package-essaouira',
  name: 'Essaouira Watersports Kitesurf Package, Essaouira',
  kind: 'camp',
  operator: {
    name: 'Essaouira Watersports',
    websiteUrl: `${SITE}/`,
    rootDomain: 'essaouirawatersports.com',
    contactEmail: 'essaouirawatersports@gmail.com',
    whatsapp: '+212690255062',
    phone: '+212690255062',
  },
  url: EW_INDEX_URL,
  slotMethod: 'price_table',
  liveAvailability: false,
  instantBooking: true,
  fetchBudget: 6,
  async fetchContent() {
    const { index, stays } = await loadPages();
    return parseEwContent({ index, stays });
  },
  async fetchSlots(ctx) {
    const { stays, list } = await loadPages();
    const pkgs = stays.flatMap(([slug, html]) => {
      const p = parseEwPackages(html);
      if (p.length === 0) ctx.note(`essaouira-watersports: no "Book now" package links on /packages/kitesurf/${slug}`);
      return p;
    });
    if (pkgs.length === 0) throw new Error('essaouira-watersports: no package links on any stay page (layout changed?)');
    return buildEwSlots(list, pkgs);
  },
};
