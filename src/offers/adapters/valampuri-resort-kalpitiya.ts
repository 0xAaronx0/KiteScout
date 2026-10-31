// ---------------------------------------------------------------------------
// Valampuri Resort (Valampuri Kite Resort), Kalpitiya Lagoon (North Western Province, Sri Lanka) - family-run
// eco resort with its own IKO kite school (Duotone gear, rescue boat, free boat transfer to the kite spot)
// on a 10,000 m2 lagoon-side coconut garden with pool and seafood restaurant; 8 room types, up to 42 guests.
// Found via bstoked listing 6781 ("Eco-Friendly Kitesurf Resort", Kalpitiya Lagoon) - bstoked is a hint only,
// nothing is read from it.
//
// Data path (checked 2026-10-12): static Astro site, English pages.
//   content  / (facts, JSON-LD Resort with geo + WebPage.dateModified), /stay/ (room cards: name, size, guests,
//            tags, blurb, "From EUR x p/p"), /rates-offers/ (package table), /gallery/ (photos).
//            Room photos: the /stay/ card photo, then the room page's own gallery (/images/rooms/<card folder>/);
//            spot photos: the kitesurfing shots of / and /gallery/ (file names with "kitesurf" / "kite-trips").
//   slots    the 8 room pages linked from /stay/ (/<room-slug>/): <div class="price-card"> with
//            price-label / price-amount / price-note ("BB Double p/p" / "EUR 35" / "Per person sharing").
//            No dates, no season prices, no engine: booking is by WhatsApp / e-mail ("No deposit required",
//            confirmation within 24 h) -> availability 'on_request'.
// Liveness (rule 5b, Aaron 2026-10-12): home page JSON-LD dateModified 2026-07-17 and "Last updated: 17 July
//   2026"; rates page prices current (packages from EUR 245 pp); IKO affiliation since 2017.
// robots.txt (2026-10-12): "User-agent: * Allow: /" (sitemap /sitemap-index.xml).
// Requests per run: content 4 + the 8 room pages (memoised; fetchSlots reuses them and /stay/, so a full run makes
//   12 requests, as before), slots alone 1 + 8 room pages.
// Parsed: slot per room page x price card (supplements like "Full Board +EUR 16" skipped and kept as room
//   features), EUR per night, basis person for "p/p" / "pp" cards (occupancy 2 for double sharing, 1 for
//   single), basis room for a group rate ("EUR 90 group rate for 6"); no dates.
// Known limits: "From" prices; extra nights in packages at the standard room rate; the six kite packages
//   (3-10 nights incl. lessons or rental) are kept as optional services, not as slots.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, ldOfType, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot, SlotPriceBasis } from '../types.js';

const SITE = 'https://www.valampuriresort.com';
export const VAL_HOME_URL = `${SITE}/`;
export const VAL_STAY_URL = `${SITE}/stay/`;
export const VAL_RATES_URL = `${SITE}/rates-offers/`;
export const VAL_GALLERY_URL = `${SITE}/gallery/`;

export interface ValRoomCard { name: string; path: string; meta: string | null; tags: string[]; desc: string | null; fromPrice: string | null; scarcity: string | null }
export interface ValPriceCard { label: string; amount: number; note: string | null; supplement: boolean; raw: string }
export interface ValPackage { name: string; nights: number | null; accommodation: string; kite: string; price: string }

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// --- memoised page fetch (content and slots share /stay/) --------------------------------------------
const pageCache = new Map<string, Promise<string>>();
function page(url: string): Promise<string> {
  if (!pageCache.has(url)) {
    const p = fetchText(url, { accept: 'text/html' });
    p.catch(() => pageCache.delete(url));
    pageCache.set(url, p);
  }
  return pageCache.get(url)!;
}

const VAL_JUNK_RE = /\/brand\/|logo|badge|icon|facebook\.com\/tr|\.svg/i;
/** one photo in all its size variants ("-thumb-320w.webp", "-800w.webp", "-q40.webp" -> the plain file) */
const variantKey = (u: string): string => u.replace(/-(?:thumb-)?\d+w(?=\.webp$)|-thumb(?=\.webp$)|-q\d+(?=\.webp$)/, '');
/** /images/rooms/<folder>/ of a room photo (the folder of Garden Eco Chalet is "eco-wooden-cabana") */
const roomFolder = (u: string): string | null => u.match(/\/images\/rooms\/([a-z0-9-]+)\//)?.[1] ?? null;

/** Visible text of <main> without scripts, styles and inline icons. */
function mainText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}

// --- pure parsers -------------------------------------------------------------------------------------
/** /stay/: <a class="v2-room-card" href="/slug/"> with h3, meta, tag spans, blurb, "From EUR x p/p". */
export function parseValRooms(html: string): ValRoomCard[] {
  const out: ValRoomCard[] = [];
  for (const a of parse(html).querySelectorAll('a.v2-room-card')) {
    const name = collapse(a.querySelector('h3')?.text ?? '');
    const path = a.getAttribute('href') ?? '';
    if (!name || !/^\/[a-z0-9-]+\/$/.test(path) || out.some(r => r.path === path)) continue;
    out.push({
      name,
      path,
      meta: collapse(a.querySelector('.v2-room-card__meta')?.text ?? '') || null,
      tags: a.querySelectorAll('.v2-room-card__tags span').map(s => collapse(s.text)).filter(Boolean),
      desc: collapse(a.querySelector('.v2-room-card__desc')?.text ?? '') || null,
      fromPrice: collapse(a.querySelector('.v2-room-card__price')?.text ?? '') || null,
      scarcity: collapse(a.querySelector('.v2-room-card__scarcity')?.text ?? '') || null,
    });
  }
  return out;
}

/** /stay/: the photo of each room card (path -> URLs, as imageCandidates gives them). */
export function parseValCardImages(html: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const a of parse(html).querySelectorAll('a.v2-room-card')) {
    const path = a.getAttribute('href') ?? '';
    if (out.has(path)) continue;
    out.set(path, imageCandidates(a.outerHTML, VAL_STAY_URL, null, 10).filter(u => !VAL_JUNK_RE.test(u) && roomFolder(u)));
  }
  return out;
}

/**
 * Own photos of one room type, best first: its /stay/ card photo, then its room page gallery (only files in the card's
 * /images/rooms/<folder>/, so the "other rooms" teasers on the page stay out). Each photo once, in the URL the general
 * list uses for it (`known`), else the room page's full-size file.
 */
export function valRoomImages(card: string[], roomHtml: string | null, roomUrl: string, known: Map<string, string>): string[] {
  const folder = card.map(roomFolder).find(Boolean) ?? roomUrl.replace(/\/+$/, '').split('/').pop() ?? null;
  const page = roomHtml ? imageCandidates(roomHtml, roomUrl, null, 60).filter(u => !VAL_JUNK_RE.test(u)) : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of [...card, ...page]) {
    if (roomFolder(u) !== folder) continue;
    const k = variantKey(u);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(known.get(k) ?? page.find(x => variantKey(x) === k) ?? u);
  }
  return out;
}

/** Room page price cards. "+EUR 16" amounts are supplements (full board), not stay prices. */
export function parseValPriceCards(html: string): ValPriceCard[] {
  const out: ValPriceCard[] = [];
  for (const card of parse(html).querySelectorAll('.price-card')) {
    const label = collapse(card.querySelector('.price-label')?.text ?? '');
    const raw = collapse(card.querySelector('.price-amount')?.text ?? '');
    const note = collapse(card.querySelector('.price-note')?.text ?? '') || null;
    const amount = parseAmount(raw);
    if (!label || amount === null || !/€|eur/i.test(raw)) continue;
    out.push({ label, amount, note, supplement: raw.trim().startsWith('+'), raw });
  }
  return out;
}

/** Who the price is for: "BB Double p/p" -> person x2, "BB Single" -> 1, "group rate for 6" -> room x6. */
export function valBasis(c: ValPriceCard): { basis: SlotPriceBasis; occupancy: number | null } {
  const t = `${c.label} ${c.note ?? ''}`.toLowerCase();
  const group = t.match(/(?:for|up to)\s+(\d+)/);
  if (/group/.test(t)) return { basis: 'room', occupancy: group ? Number(group[1]) : null };
  const occupancy = /single/.test(t) ? 1 : /triple/.test(t) ? 3 : /double|twin|sharing/.test(t) ? 2 : group ? Number(group[1]) : null;
  // a per-person price without an occupancy word (dorm bed) is for one guest
  if (/p\/p|\bpp\b|per person|per single guest|per guest|per bed|half board|full board/.test(t)) return { basis: 'person', occupancy: occupancy ?? 1 };
  return { basis: 'room', occupancy };
}

export function buildValSlots(rooms: ValRoomCard[], cardsByPath: Map<string, ValPriceCard[]>): Slot[] {
  const out: Slot[] = [];
  for (const r of rooms) {
    for (const c of cardsByPath.get(r.path) ?? []) {
      if (c.supplement) continue;
      const { basis, occupancy } = valBasis(c);
      const key = `${keyPart(r.name)}|${keyPart(c.label)}`;
      if (out.some(s => s.key === key)) continue;
      out.push({
        key,
        startDate: null,
        endDate: null,
        unit: `${r.name} (${c.label})`,
        price: c.amount,
        currency: 'EUR',
        priceUnit: 'per_night',
        priceBasis: basis,
        occupancy,
        availability: 'on_request',
        // "Only 2 rooms" on /stay/ counts the rooms of that type (not rooms left) -> room features, not here
        availabilityText: 'booking by WhatsApp or e-mail, no deposit',
        spotsLeft: null,
      });
    }
  }
  return out;
}

/** /rates-offers/: the "All six packages compared" table. */
export function parseValPackages(html: string): ValPackage[] {
  const out: ValPackage[] = [];
  for (const tr of parse(html).querySelectorAll('table tr')) {
    const cells = tr.querySelectorAll('td').map(td => collapse(td.text));
    if (cells.length < 5 || !/€/.test(cells[4])) continue;
    out.push({ name: cells[0], nights: /^\d+$/.test(cells[1]) ? Number(cells[1]) : null, accommodation: cells[2], kite: cells[3], price: cells[4] });
  }
  return out;
}

export interface ValPages {
  home: string; stay: string; rates: string; gallery: string;
  /** room page HTML by /stay/ card path ("/open-air-cabana/"); a missing page only costs that room's gallery */
  roomPages?: Record<string, string>;
}

export function parseValampuriContent(p: ValPages): OfferContent {
  const home = mainText(p.home);
  const stay = mainText(p.stay);
  const rates = mainText(p.rates);
  const rooms = parseValRooms(p.stay);
  const packages = parseValPackages(p.rates);
  const resort = ldOfType(p.home, 'Resort')[0] as Record<string, unknown> | undefined;
  const geo = (resort?.geo ?? null) as { latitude?: number; longitude?: number } | null;
  const modified = (ldOfType(p.home, 'WebPage')[0]?.dateModified as string | undefined) ?? null;
  const seasons = home.match(/Good wind from ([A-Z][a-z]+ to [A-Z][a-z]+), and from ([A-Z][a-z]+ to [A-Z][a-z]+)/);
  const lessonFrom = rates.match(/Private kitesurfing lessons without a package cost from (€\d+ per hour)/)?.[1] ?? null;
  const roomFrom = stay.match(/from (€\d+) per person per night/i)?.[1] ?? rates.match(/Room-only stays start at (€\d+ per person per night)/)?.[1] ?? null;
  const storage = stay.match(/gear storage \((€\d+\/day)\)/i)?.[1] ?? null;

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of [
    ...(Array.isArray(resort?.image) ? (resort!.image as string[]) : []),
    ...imageCandidates(p.home, VAL_HOME_URL, null, 40),
    ...imageCandidates(p.gallery, VAL_GALLERY_URL, null, 60),
    ...imageCandidates(p.stay, VAL_STAY_URL, null, 40),
  ]) {
    if (VAL_JUNK_RE.test(u)) continue;
    const k = variantKey(u);
    if (seen.has(k)) continue;
    seen.add(k); imageUrls.push(u);
  }
  const cardImages = parseValCardImages(p.stay);
  // kiting on the lagoon (home hero, lesson and downwinder cards, gallery riders); room photos ("kitesurf stay") stay out
  const spotImageUrls = imageUrls.filter(u => !roomFolder(u) && /kitesurf|kite-trips/i.test(u.split('/').pop() ?? ''));

  // a room photo that is also in the delivered general list keeps that list's URL (one identity in the curation)
  const known = new Map(imageUrls.slice(0, 40).map(u => [variantKey(u), u] as const));
  const contentRooms: ContentRoom[] = rooms.map(r => {
    const own = valRoomImages(cardImages.get(r.path) ?? [], p.roomPages?.[r.path] ?? null, `${SITE}${r.path}`, known);
    return {
      name: r.name,
      description: [r.meta, r.desc].filter(Boolean).join('. ') || null,
      features: [...r.tags, ...(r.fromPrice ? [r.fromPrice] : []), ...(r.scarcity ? [r.scarcity] : [])],
      ...(own.length ? { imageUrls: own } : {}),
    };
  });

  const summary = [
    `Valampuri is a family-run eco resort on Kalpitiya Lagoon in north-western Sri Lanka, open since 2016, with its own IKO-affiliated kite school (Duotone equipment, rescue boat, free boat transfers to the kite spot a few minutes away).`,
    `Its ${rooms.length || 8} room types range from a dorm to a family suite for six on a 10,000 m² coconut garden with a pool and a seafood restaurant; breakfast is included${roomFrom ? `, rooms start at ${roomFrom.replace(/ per person per night$/, '')} per person per night` : ''} and half or full board can be added.`,
    seasons ? `The wind seasons are ${seasons[1]} and ${seasons[2]}; bookings are made by WhatsApp or e-mail without a deposit.` : 'Bookings are made by WhatsApp or e-mail without a deposit.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Valampuri Resort',
    summary,
    continent: 'Asia',
    country: 'Sri Lanka',
    region: 'North Western Province',
    spot: 'Kalpitiya Lagoon',
    spotCoords: geo && typeof geo.latitude === 'number' && typeof geo.longitude === 'number' ? { lat: geo.latitude, lng: geo.longitude } : null,
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'], // "Complete beginners through advanced riders"
    kiteLessons: /IKO/.test(home),
    equipmentRental: /rental/i.test(rates),
    beginnerFriendly: true,
    includedServices: ['Breakfast', 'Pool', 'Wi-Fi', 'Free boat transfer to the kite spot (kite packages)'],
    optionalServices: [
      'Half board or full board',
      ...(lessonFrom ? [`Private kite lessons without a package from ${lessonFrom}`] : ['Kite lessons (IKO)']),
      'Duotone kite rental',
      ...(storage ? [`Gear storage (${storage})`] : []),
      ...packages.map(k => `${k.name}: ${k.nights ?? '?'} nights, ${k.accommodation}, ${k.kite}, ${k.price}`),
      'Dolphin watching, Wilpattu safari, lagoon boat tours, kayaking',
      'Airport transfer',
    ],
    accommodation: 'eco chalets, cabanas, doubles, family rooms and a dorm in a lagoon-side garden',
    mealPlan: 'breakfast',
    languages: [],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 40),
    ...(spotImageUrls.length ? { spotImageUrls } : {}),
    heroVideoUrl: null,
    sourceUrl: VAL_HOME_URL,
    bookingUrl: `${SITE}/contact/`,
    sourceText: [
      `home (dateModified ${modified ?? '?'}): ${home}`,
      `stay: ${stay}`,
      `packages: ${packages.map(k => `${k.name} | ${k.nights} | ${k.accommodation} | ${k.kite} | ${k.price}`).join('; ')}`,
      `rates: ${rates}`,
    ].join('\n'),
  };
}

export const valampuriResortKalpitiya: OfferAdapter = {
  key: 'valampuri-resort-kalpitiya',
  name: 'Valampuri Resort (Kalpitiya)',
  kind: 'accommodation',
  operator: {
    name: 'Valampuri Resort',
    websiteUrl: SITE,
    rootDomain: 'valampuriresort.com',
    contactEmail: 'valampuriresort@gmail.com', // site footer + JSON-LD, 2026-10-12
    whatsapp: '+94776314144',
    phone: '+94776314144',
  },
  url: VAL_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 13,
  async fetchContent() {
    const home = await page(VAL_HOME_URL);
    const stay = await page(VAL_STAY_URL);
    const rates = await page(VAL_RATES_URL);
    const gallery = await page(VAL_GALLERY_URL);
    // the room pages fetchSlots reads anyway (memoised): their galleries are the per-room photos
    const roomPages: Record<string, string> = {};
    for (const r of parseValRooms(stay)) {
      try { roomPages[r.path] = await page(`${SITE}${r.path}`); } catch { /* that room keeps its /stay/ card photo only */ }
    }
    return parseValampuriContent({ home, stay, rates, gallery, roomPages });
  },
  async fetchSlots(ctx) {
    const rooms = parseValRooms(await page(VAL_STAY_URL));
    if (rooms.length < 4) throw new Error(`valampuri: room list not found or changed (${rooms.length} rooms)`);
    const cards = new Map<string, ValPriceCard[]>();
    for (const r of rooms) {
      try {
        cards.set(r.path, parseValPriceCards(await page(`${SITE}${r.path}`)));
      } catch (err) {
        ctx.incomplete(`room page ${r.path} failed: ${(err as Error).message}`);
      }
    }
    const slots = buildValSlots(rooms, cards);
    for (const r of rooms) if (!(cards.get(r.path) ?? []).some(c => !c.supplement)) ctx.note(`no price card on ${r.path} (${r.name}: ${r.fromPrice ?? 'no from-price'})`);
    return slots;
  },
};
