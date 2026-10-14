// ---------------------------------------------------------------------------
// Let's Go Kite - Westaustralien Kitesafari 2026/27 (Perth - Lancelin - Geraldton, 3 weeks by van)
//
// Data path (checked 2026-10-14): one Contao page, https://www.letsgokite.de/de/ziele/australien.html
//   - departure   "Der Kitesafari Termin: 29.Dezember 2026 - 20.Januar 2027" / "vom 29.12.2026 - 20.01.2027"
//   - price       "Mit eigenem Material bist du ab 4.900,- EUR dabei" (own gear); rental 490 EUR per week
//   - route       "Tag 1 - 5: ... Perth", "Lancelin", "Jurien Bay", "Geraldton / Coronation Beach", option Kalbarri
//   Booking is a form on the same page (name, e-mail, airport): no inventory, the team confirms
//   -> availability 'on_request'.
// robots.txt (2026-10-14): disallows only Contao system paths; the page is allowed.
// Requests per run: 1 (content and slots each fetch the page once).
// Origin: Danilo Wolf tried to list this safari on bstoked (mail of 2026-08-07, listing never got published);
//   Aaron asked for it on Kite Scout 2026-10-14, data from the provider's own site.
// Known limits: the page names a wave coach twice ("Gabi Steindl" in the spot text vs the team intro) - kept out
//   of the summary on purpose; the departure year is read from the page, so next season needs no code change.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse, parseAmount, parseDate } from '../parse.js';
import type { ItinerarySpot, OfferAdapter, OfferContent, Slot } from '../types.js';

// the page sets <base href="https://www.letsgokite.de/">, relative image paths resolve against that
const LGK_BASE = 'https://www.letsgokite.de/';
export const LGK_AUSTRALIA_URL = 'https://www.letsgokite.de/de/ziele/australien.html';

export interface LgkSafari {
  start: string;
  end: string;
  priceOwnGear: number | null;
  rentalPerWeek: number | null;
}

function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script,style,noscript,svg')) el.remove();
  return (root.querySelector('body') ?? root).structuredText
    .split('\n').map(s => collapse(s.replace(/​/g, ''))).filter(Boolean).join('\n');
}

// --- pure parsers -------------------------------------------------------------------------------
export function parseLgkSafari(html: string): LgkSafari | null {
  const text = pageText(html);
  // "29.12.2026 - 20.01.2027" (offer section) is the machine-friendly form
  const m = text.match(/(\d{1,2}\.\d{1,2}\.20\d{2})\s*[-–]\s*(\d{1,2}\.\d{1,2}\.20\d{2})/);
  if (!m) return null;
  const start = parseDate(m[1]);
  const end = parseDate(m[2]);
  if (!start || !end) return null;
  const own = text.match(/eigenem Material[^.]*?ab\s*([\d.]+)\s*,?-?\s*(?:€|EUR)/i)?.[1];
  const rent = text.match(/([\d.]+)\s*,?-?\s*(?:€|EUR)\s*pro Woche/i)?.[1];
  return {
    start,
    end,
    priceOwnGear: own ? parseAmount(own.replace(/\./g, '')) : null,
    rentalPerWeek: rent ? parseAmount(rent.replace(/\./g, '')) : null,
  };
}

export function parseLgkSlots(html: string): Slot[] {
  const s = parseLgkSafari(html);
  if (!s) return [];
  return [{
    key: s.start,
    startDate: s.start,
    endDate: s.end,
    unit: null,
    price: s.priceOwnGear,
    currency: s.priceOwnGear !== null ? 'EUR' : null,
    priceUnit: 'package',
    priceBasis: 'person',
    occupancy: null,
    availability: 'on_request',
    availabilityText: 'Booking form on the provider site, the team confirms',
    spotsLeft: null,
  }];
}

const IMAGE_SKIP = /favicon|apple-icon|android-icon|\/design\/|logo|profil|Windstatistik|Hafen%20Dabitz|Deutschland|aegypten|brasilien|team_sonnenuntergang|Kiten%20lernen/i;


/**
 * One URL per photo. Contao renders every photo as a responsive set (srcset 1x/1.5x/2x plus one <source> per
 * breakpoint, each a separately cropped file with its own hash), so the generic candidate list contains the same
 * photo 2-4 times at different zoom levels. Take the highest-density entry of each <img> (the widest breakpoint),
 * add the full-size lightbox files, and keep one file per photo name ("<name>-<hash>.<ext>" -> "<name>").
 */
export function lgkImages(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('header,footer,nav,script,style')) el.remove();
  const abs = (u: string): string | null => { try { return new URL(u, LGK_BASE).toString(); } catch { return null; } };
  const stem = (u: string): string => decodeURIComponent(u.split('/').pop() ?? u).replace(/-[0-9a-f]{8}(\.[a-z]+)$/i, '$1').toLowerCase();
  const best = (ss: string | undefined, src: string | undefined): string | null => {
    let top: { url: string; d: number } | null = null;
    for (const part of (ss ?? '').split(',')) {
      const [u, desc] = part.trim().split(/\s+/);
      if (!u) continue;
      const d = desc ? parseFloat(desc) || 1 : 1;
      if (!top || d > top.d) top = { url: u, d };
    }
    return abs(top?.url ?? src ?? '');
  };
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u: string | null): void => {
    if (!u || !u.startsWith(LGK_BASE) || IMAGE_SKIP.test(u) || !/\.(jpe?g|png|webp)$/i.test(u)) return;
    const k = stem(u);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(u);
  };
  for (const img of root.querySelectorAll('img')) push(best(img.getAttribute('srcset'), img.getAttribute('src') ?? undefined));
  for (const a of root.querySelectorAll('a')) push(abs(a.getAttribute('href') ?? ''));
  return out;
}

export function parseLgkContent(html: string): OfferContent {
  const s = parseLgkSafari(html);
  if (!s) throw new Error('letsgokite: no departure range (e.g. "29.12.2026 - 20.01.2027") on the page');
  const text = pageText(html);
  const days = Math.round((Date.parse(s.end) - Date.parse(s.start)) / 86400000) + 1;
  const fmt = (n: number | null) => (n === null ? '?' : n.toLocaleString('en-US'));

  const itinerarySpots: ItinerarySpot[] = ['Perth', 'Lancelin', 'Jurien Bay', 'Geraldton', 'Coronation Beach']
    .map((name, i) => ({ name, country: 'Australia', region: 'Western Australia', order: i + 1 }));

  const includedServices = [
    'Airport pick-up and all transfers to spots and accommodation',
    'Accommodation incl. breakfast',
    'Kitesurf guiding by VDWS-licensed guides',
    '6 days wave training incl. video analysis with VDWS instructor (or jump training)',
  ];
  const optionalServices = [
    `Duotone gear rental (EUR ${fmt(s.rentalPerWeek)} per week)`,
    'Flight booking help',
    'Day trip to Kalbarri and Pink Lake',
  ];

  const summary = [
    'A three-week guided kitesurf safari along the west coast of Western Australia, driven by van from Perth via Lancelin and Jurien Bay to Geraldton, with a six-day wave or jump training block at Coronation Beach.',
    `The ${s.start.slice(0, 4)}/${s.end.slice(0, 4)} trip runs ${s.start} to ${s.end} with a New Year's Eve in Perth; arrival one or two days later is possible.`,
    'Riders need a proven VDWS level 5 and bring their own gear or rent Duotone kit; spots range from flat-water bays to reef-break waves, so twintip and wave riders are both served.',
    `The price is from EUR ${fmt(s.priceOwnGear)} per person with own gear and covers transfers, accommodation with breakfast, guiding and the wave training.`,
  ].join(' ');

  const imageUrls = lgkImages(html);

  const from = text.indexOf('Australien - Kitesafari');
  const to = text.indexOf('Buchungsformular');
  const sourceText = from >= 0 ? text.slice(from, to > from ? to : undefined) : text;

  return {
    kind: 'tour',
    title: 'Western Australia Kite Safari 2026/27',
    summary,
    continent: 'Oceania',
    country: 'Australia',
    region: 'Western Australia',
    spot: 'Perth',
    spotCoords: { lat: -31.95, lng: 115.86 },
    itinerarySpots,
    durationDays: days,
    // "Kannst du uns nachweisen, dass du im Kitesurfen Level 5 erfolgreich absolviert hast"
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: true,             // 6 days wave or jump training with VDWS instructors
    equipmentRental: true,         // Duotone rental on request
    beginnerFriendly: false,
    includedServices,
    optionalServices,
    accommodation: 'Airbnbs, holiday cottages and beach huts in good locations (Fremantle, Jurien Bay, Geraldton)',
    mealPlan: 'breakfast',
    languages: ['de'],
    rooms: [],
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: LGK_AUSTRALIA_URL,
    bookingUrl: `${LGK_AUSTRALIA_URL}#buchung`,
    sourceText,
  };
}

export const letsgokiteWestaustralienKitesafari: OfferAdapter = {
  key: 'letsgokite-westaustralien-kitesafari',
  name: "Let's Go Kite - Western Australia Kite Safari",
  kind: 'tour',
  operator: {
    name: "Let's Go! Kite",
    websiteUrl: 'https://www.letsgokite.de',
    rootDomain: 'letsgokite.de',
    contactEmail: 'info@letsgokite.de',
    phone: '+491632669822',
  },
  url: LGK_AUSTRALIA_URL,
  slotMethod: 'html_dates',
  instantBooking: false,           // booking form, the team confirms by mail
  fetchBudget: 2,
  async fetchContent() {
    return parseLgkContent(await fetchText(LGK_AUSTRALIA_URL));
  },
  async fetchSlots(ctx) {
    const html = await fetchText(LGK_AUSTRALIA_URL);
    const slots = parseLgkSlots(html);
    if (slots.length === 0) throw new Error('letsgokite: no departure on the page - layout changed');
    if (slots[0].price === null) ctx.note('no "ab ... EUR" price found');
    return slots;
  },
};
