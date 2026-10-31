// ---------------------------------------------------------------------------
// Pousada País Tropical, Icaraí de Amontada (Icaraizinho, Ceará, Brazil) - 15-room pousada with pool, tropical
// garden and restaurant, 50 m from the beach, partnered with the village kite school and club Cabana do Kite
// "right next door" (lessons, rental, downwinders, compressors, secure gear storage on the beach).
//
// Data path (checked 2026-10-12): pais-tropical.com (Astro static site, PT default with /en/, /fr/, /es/; the
//   English pages are read):
//   content  /en/ (intro, amenities, location, FAQ teaser, photos), /en/accommodations (4 room types as
//            .room-detail cards: name, features, photo; schema.org LodgingBusiness JSON-LD with numberOfRooms,
//            geo, check-in/out, e-mail, phone, priceRange), /en/kitesurfing (spot, season, partner club facts).
//   slots    none: the pages print no room price; bookings go through WhatsApp ("For availability and bookings,
//            message the pousada on WhatsApp"). The JSON-LD carries priceRange "R$400–R$700" without unit,
//            occupancy or dates - NOT turned into a slot (kept in sourceText). fetchSlots re-reads
//            /en/accommodations (memoised) and returns [] (offer = "price on request"); it notes when a price
//            shows up in the visible text so the adapter can be extended.
// Liveness (rule 5b): footer "© 2026 Pousada País Tropical"; VideoObject uploadDate 2026-06-05; photos shot
//   2025-08 (file names 14082025-*, 15082025-*).
// robots.txt (2026-10-12): "Allow: /".
// Requests per run: content 3, slots 1 (0 extra when content ran in the same process).
// Map pin: the site's own LodgingBusiness JSON-LD geo (-3.0250829, -39.6546235).
// Known limits: no prices, no room count per type; the kite school is a partner (Cabana do Kite), not owned.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, ldOfType, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://pais-tropical.com';
export const PT_HOME_URL = `${SITE}/en/`;
export const PT_ROOMS_URL = `${SITE}/en/accommodations`;
export const PT_KITE_URL = `${SITE}/en/kitesurfing`;
const WHATSAPP = '+5588981203056';

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share it */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible block lines of the <main> element (scripts, styles, nav, footer dropped). */
export function ptLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, nav, header, footer')) el.remove();
  return (root.querySelector('main') ?? root).structuredText.split('\n').map(l => collapse(l)).filter(Boolean);
}
const ptText = (html: string): string => ptLines(html).join(' ');

/** Largest srcset candidate (or src) of an Astro <img>, absolute. */
function largest(img: { getAttribute(n: string): string | undefined }, base: string): string | null {
  const set = (img.getAttribute('srcset') ?? '').split(',').map(s => s.trim().split(/\s+/)).filter(p => p[0])
    .map(([u, w]) => ({ u, w: Number((w ?? '0').replace(/\D/g, '')) || 0 })).sort((a, b) => b.w - a.w);
  const u = set[0]?.u ?? img.getAttribute('src');
  return u ? new URL(u, base).toString() : null;
}

// --- pure parsers -----------------------------------------------------------------------------
export interface PtRoom { name: string; features: string[]; photo: string | null }

/** /en/accommodations: <div class="room-detail"> name (h2.room-detail__name), li.room-detail__item, img. */
export function parsePtRooms(html: string): PtRoom[] {
  return parse(html).querySelectorAll('.room-detail').map(card => {
    const img = card.querySelector('img');
    return {
      name: collapse(card.querySelector('.room-detail__name')?.text ?? ''),
      features: card.querySelectorAll('.room-detail__item').map(li => collapse(li.text)).filter(Boolean),
      photo: img ? largest(img, PT_ROOMS_URL) : null,
    };
  }).filter(r => r.name);
}

export interface PtLodging { rooms: number | null; lat: number | null; lng: number | null; priceRange: string | null; email: string | null; phone: string | null; checkin: string | null; checkout: string | null }

export function parsePtLodging(html: string): PtLodging {
  const lb = ldOfType(html, 'LodgingBusiness').find(o => o.geo || o.numberOfRooms) ?? {};
  const geo = (lb.geo ?? {}) as Record<string, unknown>;
  const lat = Number(geo.latitude); const lng = Number(geo.longitude);
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    rooms: Number(lb.numberOfRooms) || null,
    lat: Number.isFinite(lat) && lat !== 0 ? lat : null,
    lng: Number.isFinite(lng) && lng !== 0 ? lng : null,
    priceRange: str(lb.priceRange),
    email: str(lb.email),
    phone: str(lb.telephone),
    checkin: str(lb.checkinTime),
    checkout: str(lb.checkoutTime),
  };
}

/** Own photos (Astro /_astro/ images, largest variant), chat-agent avatar dropped, de-duplicated by photo name. */
export function ptImages(pages: Array<[string, string]>, max = 30): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const [html, base] of pages) {
    for (const img of parse(html).querySelectorAll('img')) {
      const u = largest(img, base);
      if (!u || !u.startsWith(`${SITE}/_astro/`) || /maya|agente|logo|icon/i.test(u)) continue;
      const k = u.split('/').pop()!.split('.')[0];
      if (seen.has(k)) continue;
      seen.add(k); out.push(u);
    }
  }
  return out.slice(0, max);
}

/** Visible amounts with a currency sign (the pages print none today). */
export function ptVisiblePrices(html: string): string[] {
  return [...ptText(html).matchAll(/R\$\s?\d[\d.,]*/g)].map(m => m[0]);
}

export interface PtPages { home: string; rooms: string; kite: string }

export function parsePaisTropicalContent(p: PtPages): OfferContent {
  const home = ptText(p.home);
  const kite = ptText(p.kite);
  const rooms = parsePtRooms(p.rooms);
  const lodging = parsePtLodging(p.rooms);
  const season = kite.match(/Between (\w+) and (\w+) the wind blows steadily/) ?? home.match(/steady winds from (\w+) to (\w+)/);
  const fortaleza = home.match(/about (\d+) km from Fortaleza/)?.[1] ?? null;
  const certified = /IKO and ABK certified instructors/i.test(kite);
  const brands = kite.match(/Equipment rental:\s*([A-Za-z\- ,]+?and [A-Za-z\-]+)/)?.[1] ?? null;
  const downwind = kite.match(/Guided downwinders from (\d+ to \d+ km)/)?.[1] ?? null;
  const clubLanguages = kite.match(/Languages spoken\s+([A-Za-z ·]+?)\s+Visit/)?.[1]?.split('·').map(s => s.trim()) ?? [];
  const LANG: Record<string, string> = { Portuguese: 'pt', English: 'en', French: 'fr', Spanish: 'es' };

  const contentRooms: ContentRoom[] = rooms.map(r => ({ name: r.name, description: null, features: r.features }));

  const summary = [
    `Pousada País Tropical is a guesthouse with ${lodging.rooms ?? 15} rooms in the village of Icaraizinho (Icaraí de Amontada) on the west coast of Ceará, Brazil${fortaleza ? `, about ${fortaleza} km from Fortaleza` : ''}, 50 m from the beach, with a pool in a tropical garden and its own restaurant.`,
    `The ${rooms.length || 4} room types (${rooms.map(r => r.name).join(', ')}) have air conditioning, a private bathroom, a mini-fridge, Wi-Fi and a hammock balcony; breakfast is included and bookings go through WhatsApp.`,
    `Its partner Cabana do Kite, the village kite school and club next door, gives kitesurf and wing lessons from beginner to advanced${certified ? ' with IKO and ABK certified instructors' : ''}, rents gear, runs guided downwinders${downwind ? ` of ${downwind}` : ''} and has compressors and secure gear storage on the beach${season ? `; the wind blows steadily from ${season[1]} to ${season[2]}` : ''} over flat, shallow water.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Pousada País Tropical',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Icaraí de Amontada, Ceará',
    spot: 'Icaraí de Amontada',
    // the site's LodgingBusiness JSON-LD geo (checked 2026-10-12)
    spotCoords: lodging.lat !== null && lodging.lng !== null ? { lat: lodging.lat, lng: lodging.lng } : null,
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    // kitesurfing page: "Kitesurf and wing lessons, from day one to advanced level" (Cabana do Kite)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /Kitesurf and wing lessons/i.test(kite),
    equipmentRental: /Equipment rental/i.test(kite),
    beginnerFriendly: /favours learning|first water start/i.test(kite) ? true : null,
    includedServices: ['Breakfast', 'Wi-Fi', 'Pool in the tropical garden', 'Air conditioning'],
    optionalServices: [
      'Kitesurf and wing lessons at partner Cabana do Kite (next door)',
      brands ? `Kite and wing equipment rental (${brands}) at Cabana do Kite` : 'Equipment rental at Cabana do Kite',
      downwind ? `Guided downwinders ${downwind} with 4x4 transport (Cabana do Kite)` : 'Guided downwinders (Cabana do Kite)',
      'Secure gear storage, compressors and repairs on the beach (Cabana do Kite)',
      'Restaurante País Tropical (Ceará cuisine, seafood, vegan options)',
      'Transfer from Fortaleza and airport transfers',
      'Buggy tours',
      'Massages',
    ],
    accommodation: 'suites and bungalows in a tropical garden',
    mealPlan: 'breakfast',
    languages: clubLanguages.map(l => LANG[l]).filter((x): x is string => !!x), // Cabana do Kite: "Languages spoken"
    rooms: contentRooms,
    imageUrls: ptImages([[p.rooms, PT_ROOMS_URL], [p.home, PT_HOME_URL]]),
    heroVideoUrl: null,
    sourceUrl: PT_HOME_URL,
    bookingUrl: `https://wa.me/${WHATSAPP.slice(1)}`,
    sourceText: [
      `home: ${home}`,
      `accommodations: ${rooms.map(r => `${r.name}: ${r.features.join(', ')}`).join(' | ')}`,
      `kitesurfing: ${kite}`,
      `lodging JSON-LD: rooms ${lodging.rooms ?? '-'}, geo ${lodging.lat},${lodging.lng}, priceRange ${lodging.priceRange ?? '-'} (no unit/dates: not used as a slot), check-in ${lodging.checkin ?? '-'}, check-out ${lodging.checkout ?? '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const pousadaPaisTropicalIcarai: OfferAdapter = {
  key: 'pousada-pais-tropical-icarai',
  name: 'Pousada País Tropical Icaraí de Amontada',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Pousada País Tropical',
    websiteUrl: SITE,
    rootDomain: 'pais-tropical.com',
    contactEmail: 'info@pais-tropical.com',
    phone: WHATSAPP,
    whatsapp: WHATSAPP,
  },
  url: PT_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'low', // no prices on the site, booking via WhatsApp
  async fetchContent() {
    const [home, rooms, kite] = [await page(PT_HOME_URL), await page(PT_ROOMS_URL), await page(PT_KITE_URL)];
    return parsePaisTropicalContent({ home, rooms, kite });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const html = await page(PT_ROOMS_URL);
    if (parsePtRooms(html).length === 0) throw new Error('pais-tropical: room cards missing on /en/accommodations (layout changed?)');
    const prices = ptVisiblePrices(html);
    if (prices.length) ctx.note(`prices appeared on /en/accommodations (${prices.slice(0, 5).join(', ')}): extend the adapter`);
    return [];
  },
};
