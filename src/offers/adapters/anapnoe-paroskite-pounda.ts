// ---------------------------------------------------------------------------
// Anapnoe by ParosKite, Pounda (Paros, Greece) - watersports resort of the ParosKite school right on Pounda
// beach, the kite spot: 7 rooms + 4 suites with private pools, breakfast buffet; ParosKite teaches and rents
// on the same beach (April-October).
//
// Data path (checked 2026-10-12):
//   content  paroskiteanapnoe.com (custom WordPress theme): home = suite/room cards (name only as a logo
//            image "<name>-logo-color.png", amenity values: guests, size, view, terrace/pool) + amenities;
//            /gallery/ = full-size photos behind <a href> (thumbnails are -768xN). Kite school facts from
//            the school's own site www.paroskite.com/lessons/kitesurfing/ (levels, lesson formats, rental
//            brands). Map pin = the ParosKite Google Maps place link in the Anapnoe footer
//            (!3d37.031704!4d25.098255, the school next to the resort).
//   slots    none. "BOOK NOW" opens a WebHotelier engine (anapnoeresort.reserve-online.net) that answers
//            HTTP 403 to our UA, even for /robots.txt (checked 2026-10-12) -> BLOCKED, not worked around.
//            The own site prints no room prices -> fetchSlots returns [] ("price on request").
// 2026 signal: pages modified 2026-04/07 (article:modified_time), room photos named 2026-03 / 2026-04-29,
//   ParosKite footer "COPYRIGHT 2026-2028"; no dated season or price for the rooms.
// robots.txt (2026-10-12): paroskiteanapnoe.com and paroskite.com Yoast default, nothing disallowed.
// Requests per run: content 3, slots 0.
// Known limits: no prices or availability until the hotel grants WebHotelier API access or publishes rates.
//   Villa Aquila (inland, "in the heart of the island") is listed on the site but not part of this offer.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, meta, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://paroskiteanapnoe.com';
export const ANAPNOE_HOME_URL = `${SITE}/`;
const GALLERY_URL = `${SITE}/gallery/`;
const KITE_URL = 'https://www.paroskite.com/lessons/kitesurfing/';
const BOOKING_URL = 'https://anapnoeresort.reserve-online.net/';

export interface AnapnoeUnit { kind: 'suite' | 'room'; name: string; amenities: string[]; image: string | null }

const title = (slug: string): string => slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/** Suite ("house*") and room cards: name from the title logo file, amenity values, featured image. */
export function parseAnapnoeUnits(html: string): AnapnoeUnit[] {
  const out: AnapnoeUnit[] = [];
  const root = parse(html);
  for (const card of root.querySelectorAll('.houseDispFlx, .roomDispFlx')) {
    const logo = card.querySelector('.titleLogo img')?.getAttribute('src') ?? '';
    const slug = logo.match(/media-assets\/([a-z]+)-logo/i)?.[1];
    if (!slug) continue;
    const name = title(slug === 'dorida' ? 'doris' : slug);
    if (out.some(u => u.name === name)) continue;
    const style = card.querySelector('[style*="background-image"]')?.getAttribute('style') ?? '';
    out.push({
      kind: card.classNames.includes('house') ? 'suite' : 'room',
      name,
      amenities: card.querySelectorAll('.amenityVal').map(a => collapse(a.text)).filter(Boolean),
      image: style.match(/url\(['"]?([^'")]+)['"]?\)/)?.[1] ?? null,
    });
  }
  return out;
}

/** Full-size gallery photos (the <a href> behind each thumbnail). */
export function anapnoeGallery(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a[^>]+href=['"](https:\/\/paroskiteanapnoe\.com\/media-assets\/[^'"]+\.(?:jpe?g|webp))['"]/gi)) {
    if (/logo|icon|facebook-1200/i.test(m[1]) || out.includes(m[1])) continue;
    out.push(m[1]);
  }
  return out;
}

export function anapnoeCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/google\.[a-z.]+\/maps\/place\/ParosKite[^'"\s]*?!3d(-?[\d.]+)!4d(-?[\d.]+)/i);
  return m ? { lat: Math.round(Number(m[1]) * 1e5) / 1e5, lng: Math.round(Number(m[2]) * 1e5) / 1e5 } : null;
}

function blocks(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  return root.querySelectorAll('h1, h2, h3, h4, p, li, .descriptor, .amenityText, .serviceText, div.text')
    .map(e => collapse(e.text)).filter((t, i, a) => t && a.indexOf(t) === i);
}

export interface AnapnoePages { home: string; gallery: string; kite: string }

export function parseAnapnoeContent(p: AnapnoePages): OfferContent {
  const units = parseAnapnoeUnits(p.home);
  const suites = units.filter(u => u.kind === 'suite');
  const rooms = units.filter(u => u.kind === 'room');
  const homeText = collapse(parse(p.home).text);
  const kiteText = collapse(parse(p.kite).text);
  const intro = (homeText.match(/Anapnoe is the first and only accommodation[^.]*\.[^.]*\.[^.]*\./)?.[0] ?? '').split(/VIEW THE ROOMS/i)[0].trim();
  const sizes = rooms.flatMap(u => u.amenities.map(a => a.match(/^(\d+)(?:-(\d+))?\s*m2$/i)).filter((m): m is RegExpMatchArray => !!m).flatMap(m => [Number(m[1]), Number(m[2] ?? m[1])]));
  const services = ['WIFI', 'Breakfast', 'Fitness Center', 'Lounge', 'Open Kitchen Area']
    .filter(s => new RegExp(`\\b${s}`, 'i').test(homeText));
  const levels = kiteText.match(/Beginner \(Level 1\), Intermediate \(Level 2\), Independent \(Level 3\), or Zero to Hero \(all levels\)/)?.[0] ?? null;
  const brands = kiteText.match(/leading brands like ([A-Z][\w-]+(?: & [A-Z][\w-]+)?)/)?.[1] ?? null;

  const contentRooms: ContentRoom[] = [
    ...suites.map(u => ({ name: `${u.name} Suite`, description: 'Suite with private pool next to Pounda beach (house for 4+ guests).', features: u.amenities })),
    ...rooms.map(u => ({ name: `${u.name} Room`, description: null, features: u.amenities })),
  ];
  const imageUrls = [...new Set([
    ...units.map(u => u.image).filter((u): u is string => !!u),
    ...anapnoeGallery(p.gallery),
  ])].slice(0, 30);

  const summary = [
    `Anapnoe is the watersports resort of the ParosKite school, right on Pounda beach on Paros, Greece, the island's kite spot: ${rooms.length || 7} rooms${sizes.length ? ` (${Math.min(...sizes)}-${Math.max(...sizes)} m2, most with sea view)` : ''} and ${suites.length || 4} suites with private pools (70-75 m2, 4+ guests), and a breakfast buffet.`,
    `Guests share a lounge, an open kitchen with a vegetable garden and a fitness center.`,
    `ParosKite teaches on the same beach: kite, windsurf and wingfoil lessons from beginner to independent level (private, semi-private 2:1, kids) and rental${brands ? ` of ${brands} gear` : ''}, from April to October.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Anapnoe by ParosKite',
    summary,
    continent: 'Europe',
    country: 'Greece',
    region: 'Cyclades',
    spot: 'Pounda, Paros',
    spotCoords: anapnoeCoords(p.home),
    itinerarySpots: [],
    durationDays: null,
    // paroskite.com: "Paroskite is dedicated to accommodating all levels of experience" (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /kitesurf(?:ing)? lessons/i.test(kiteText),
    equipmentRental: /rental services for kites/i.test(kiteText),
    beginnerFriendly: /Beginner \(Level 1\)/.test(kiteText),
    includedServices: services.map(s => ({ WIFI: 'Wi-Fi', Breakfast: 'Breakfast buffet', 'Fitness Center': 'Fitness center', Lounge: 'Lounge', 'Open Kitchen Area': 'Open kitchen area and vegetable garden' }[s] ?? s)),
    optionalServices: ['Kitesurf, windsurf and wingfoil lessons (ParosKite)', 'Kite, board and foil rental (ParosKite)', 'Surf shop'],
    accommodation: 'beachfront rooms and suites with private pools',
    mealPlan: 'breakfast',
    languages: ['en'],
    rooms: contentRooms,
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: ANAPNOE_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `about: ${intro || (meta(p.home, 'og:description') ?? '')}`,
      `units: ${units.map(u => `${u.kind} ${u.name}: ${u.amenities.join(', ')}`).join('; ')}`,
      `services: ${services.join(', ')}`,
      `kite school (paroskite.com): ${levels ?? ''} | lessons: semi-private 2:1, private, VIP, kids | rental brands: ${brands ?? '-'}`,
      `page modified: ${meta(p.home, 'article:modified_time') ?? '-'}`,
    ].join('\n'),
  };
}

export const anapnoeParoskitePounda: OfferAdapter = {
  key: 'anapnoe-paroskite-pounda',
  name: 'Anapnoe by ParosKite Pounda',
  kind: 'accommodation',
  operator: {
    name: 'Paros Kite Anapnoe Resort',
    websiteUrl: SITE,
    rootDomain: 'paroskiteanapnoe.com',
    contactEmail: 'anapnoe@paroskite.gr',
    whatsapp: '+306940800941',
    phone: '+302284093018',
  },
  url: ANAPNOE_HOME_URL,
  slotMethod: 'booking_engine',
  fetchBudget: 3,
  confidence: 'low',
  async fetchContent() {
    const home = await fetchText(ANAPNOE_HOME_URL, { accept: 'text/html' });
    const gallery = await fetchText(GALLERY_URL, { accept: 'text/html' });
    const kite = await fetchText(KITE_URL, { accept: 'text/html' });
    return parseAnapnoeContent({ home, gallery, kite });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    // WebHotelier (anapnoeresort.reserve-online.net) answers 403 to non-browser clients: never bypassed.
    ctx.note('no slot source: WebHotelier engine blocks our UA (HTTP 403, 2026-10-12) and the site prints no room prices');
    return [];
  },
};
