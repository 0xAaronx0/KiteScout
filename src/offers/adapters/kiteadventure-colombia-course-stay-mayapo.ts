// ---------------------------------------------------------------------------
// KiteAdventure Colombia - course + stay packages, Mayapo (La Guajira, Colombia). An IKO kite school on the Second
// Beach of Mayapo (Maliwala sector) sells three all-in packages: 8 or 10 private hours with 3 nights, or 12 private
// hours with 4 nights, each with a private room + breakfast at a partner lodge, return transfer Riohacha - Mayapo,
// lesson gear, IKO certification, radio coaching, photos and video. Kind 'camp' (one place, stay + lessons).
//
// Data path (checked 2026-10-19), server-rendered React site (Vite build), English home page:
//   slots    the "ALL-INCLUSIVE MAYAPO PACKAGES" cards: "8 PRIVATE HOURS 3 NIGHTS · 4 DAYS Essential course + stay
//            COP 2,944,000", "10 PRIVATE HOURS 3 NIGHTS · 4 DAYS ... COP 3,013,000", "12 PRIVATE HOURS 4 NIGHTS · 5
//            DAYS ... COP 3,438,500"; "Prices are per student". Undated (rolling, any date): one slot per package,
//            COP per person (package), packageNights = the card's nights, availability on_request (dates are
//            confirmed on WhatsApp before a 30% card-deposit link is sent). The page states "COP OFFICIAL PAYMENT
//            CURRENCY"; its USD / EUR toggle is a client-side conversion we do not use.
//            A dated promo ("December 2026 & January 2027 10% off Early bird ... Book by 31 October 2026") is kept
//            in the slot text, not as a price.
//   content  same page: JSON-LD (business, images, hero video), Google Maps pin 11.6798061,-72.7661863 (spotCoords).
// robots.txt (2026-10-19): "User-Agent: * Allow: /".
// Requests per run: 1 (memoised across content + slots).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, htmlToText, jsonLd, parseAmount } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kitesurfingcolombia.co';
export const KAC_URL = `${SITE}/`;

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

export interface KacPackage { hours: number; nights: number; days: number; name: string; price: number }
export interface KacPage { packages: KacPackage[]; promo: string | null; coords: { lat: number; lng: number } | null }

export function parseKac(html: string): KacPage {
  const t = collapse(htmlToText(html));
  const packages: KacPackage[] = [];
  const re = /(\d{1,2}) PRIVATE HOURS (\d{1,2}) NIGHTS · (\d{1,2}) DAYS ([A-Za-z +&-]{3,40}?) COP ([\d.,]+)/g;
  for (const m of t.matchAll(re)) {
    const price = parseAmount(m[5]);
    if (!price || packages.some(p => p.hours === +m[1] && p.nights === +m[2])) continue;
    packages.push({ hours: +m[1], nights: +m[2], days: +m[3], name: m[4].trim(), price });
  }
  const promo = t.match(/For ([A-Z][a-z]+ 20\d{2}(?: & [A-Z][a-z]+ 20\d{2})?) (\d{1,2}% off) Early bird.*?(Book by \d{1,2} [A-Z][a-z]+ 20\d{2})/);
  const c = html.match(/(-?\d{1,2}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})&amp;t=/) ?? html.match(/(-?\d{1,2}\.\d{4,})%2C(-?\d{1,3}\.\d{4,})/);
  return {
    packages,
    promo: promo ? `${promo[2]} early bird for ${promo[1]} (${promo[3]})` : null,
    coords: c ? { lat: Number(c[1]), lng: Number(c[2]) } : null,
  };
}

export function buildKacSlots(p: KacPage): Slot[] {
  return p.packages.map(k => ({
    key: `${k.hours}h-${k.nights}n`,
    startDate: null,
    endDate: null,
    unit: `${k.name} (${k.hours} private hours, ${k.nights} nights, private room)`,
    price: k.price,
    currency: 'COP',
    priceUnit: 'package',
    priceBasis: 'person',
    occupancy: 1,
    availability: 'on_request',
    availabilityText: ['dates confirmed on WhatsApp before a 30% deposit', p.promo].filter(Boolean).join('; '),
    spotsLeft: null,
    packageNights: k.nights,
  }));
}

export function parseKacContent(html: string): OfferContent {
  const t = collapse(htmlToText(html));
  const p = parseKac(html);
  const imgs: string[] = [];
  const add = (u: string | null | undefined) => {
    if (!u) return;
    const abs = new URL(u, SITE).toString();
    if (!imgs.includes(abs)) imgs.push(abs);
  };
  for (const n of ['kitesurf-course-stay-mayapo-12-hours', 'kitesurf-course-stay-mayapo-8-hours', 'kitesurf-course-stay-mayapo-10-hours', 'kitesurfing-action-mayapo-colombia'])
    if (html.includes(`/seo-media/services/${n}.webp`)) add(`/seo-media/services/${n}.webp`);
  for (const o of jsonLd(html)) {
    const im = o.image;
    for (const u of Array.isArray(im) ? im : [im]) if (typeof u === 'string') add(u);
  }
  for (const m of html.matchAll(/src="(\/(?:seo-media|images)\/[^"]+\.(?:webp|jpe?g))"/g)) {
    if (/reviews\/|brands\/|logo/i.test(m[1])) continue;
    add(m[1]);
  }
  const video = jsonLd(html).map(o => (o.video as Record<string, unknown> | undefined)?.contentUrl).find(v => typeof v === 'string') as string | undefined;
  const cheapest = p.packages.reduce<KacPackage | null>((a, b) => (!a || b.price < a.price ? b : a), null);
  const nights = cheapest?.nights ?? 3;

  return {
    kind: 'camp',
    title: 'KiteAdventure Colombia Kite Course + Stay, Mayapo',
    summary: [
      'An IKO-certified kite school on the Second Beach of Mayapo in La Guajira, Colombia, sells course-and-stay packages: private lessons with gear and IKO certification, a private room with breakfast at a partner lodge in Mayapo, and the return transfer from Riohacha.',
      p.packages.length
        ? `Packages: ${p.packages.map(k => `${k.hours} private hours with ${k.nights} nights (COP ${k.price.toLocaleString('en-US')})`).join(', ')}, per student, any dates on request.`
        : 'Packages combine 8 to 12 private hours with 3 or 4 nights, any dates on request.',
      'Shallow, warm water in steady trade winds; beginners welcome. Dates are confirmed on WhatsApp, then a 30% card deposit secures the booking.',
    ].join(' '),
    continent: 'South America',
    country: 'Colombia',
    region: 'La Guajira',
    spot: 'Mayapo',
    spotCoords: p.coords,
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      'Private IKO-certified instruction (8, 10 or 12 hours) with complete kite equipment',
      'IKO certification, walkie-talkie radio coaching, course photos and videos',
      '3 or 4 nights in a private room with breakfast (Yosu Beach Ecohotel, La Costa House or Talata Hostel)',
      'Return transfer Riohacha - Mayapo, local travel assistance',
    ],
    optionalServices: ['Extra nights, unlisted meals and companion costs on request'],
    accommodation: 'private room at a partner beach lodge or hostel in Mayapo',
    mealPlan: 'breakfast',
    languages: ['en', 'es'],
    rooms: [],
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: video ?? null,
    sourceUrl: KAC_URL,
    bookingUrl: KAC_URL,
    sourceText: [
      `home: ${t}`,
      `parsed: ${p.packages.map(k => `${k.hours}h/${k.nights}n COP ${k.price}`).join('; ')}; promo ${p.promo}; coords ${p.coords ? `${p.coords.lat},${p.coords.lng}` : null}`,
    ].join('\n'),
  };
}

export async function fetchKacSlots(ctx?: { note(t: string): void }): Promise<Slot[]> {
  const p = parseKac(await page(KAC_URL));
  if (p.packages.length === 0) throw new Error('kiteadventure-colombia: no "<n> PRIVATE HOURS <n> NIGHTS ... COP" package card found (layout changed?)');
  if (p.promo) ctx?.note(`promo: ${p.promo}`);
  return buildKacSlots(p);
}

export const kiteadventureColombiaCourseStayMayapo: OfferAdapter = {
  key: 'kiteadventure-colombia-course-stay-mayapo',
  name: 'KiteAdventure Colombia Course + Stay, Mayapo',
  kind: 'camp',
  operator: {
    name: 'KiteAdventure Colombia',
    websiteUrl: SITE,
    rootDomain: 'kitesurfingcolombia.co',
    contactEmail: 'contact@kitesurfingcolombia.co',
    whatsapp: '+573207655364',
    phone: '+573207655364',
  },
  url: KAC_URL,
  slotMethod: 'price_table',
  liveAvailability: false,
  instantBooking: false,
  fetchBudget: 2,
  async fetchContent() { return parseKacContent(await page(KAC_URL)); },
  fetchSlots: ctx => fetchKacSlots(ctx),
};

