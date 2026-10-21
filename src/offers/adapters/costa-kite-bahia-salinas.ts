// ---------------------------------------------------------------------------
// Costa Kite, Bahia Salinas (La Cruz, Guanacaste, Costa Rica) - IKO kite school (also wing foil, SUP, Pilates) on
// Playa Copal in Salinas Bay; its accommodation is the Nandel Beach Resort ("Our accommodation is located right on
// the beach, just pump your kite and go!!"): private double rooms with breakfast, pool, restaurant, Wi-Fi, and
// kite + stay packages. Found via a former bstoked.net listing - bstoked is a hint only, nothing is read from it.
// CAVEAT: the resort is a third party that Costa Kite markets as "our accommodation" and sells in its own packages;
//   the operator here is Costa Kite (the school takes the booking), not the resort.
//
// Data path (checked 2026-10-12): WordPress (Enfold theme, Yoast), English pages, content inside <main>.
//   content  / (school, gear, team), /accommodation-costa-rica-kiteboarding/ (Nandel resort, room, price),
//            /packages/ (kite + lodging packs), /courses-and-rentals-costa-rica-kite/ (lesson / rental price cards,
//            "* All Prices are per person in USD."), /spot-info-costa-rica-kite/ (spot, wind season Nov-May),
//            /family-kite-vacation/ (blog post: school on site at the resort's beach, weather station, rental).
//   slots    /accommodation-costa-rica-kiteboarding/: per <h3> room "Price per night for 2 people: 100$-150$";
//            /packages/: "SOLO TRAVELLER PACK: ... PRICE: $999", "PRIVATE DOUBLE ROOM PACK: ... PRICE per person
//            is : $799" (3 nights, breakfast, 3 days of private lessons; "Not available in Christmas and Easter").
//            No dates, no engine: rooms and packs are booked by WhatsApp (+506 8500 3222) or info@costakite.com
//            (the /bookings-costa-rica/ online form only books lessons) -> 'on_request'.
// Currency: the pages print "$" only; the school's own courses page states "All Prices are per person in USD" and
//   the colon (CRC) is never used on the site -> USD.
// Liveness (rule 5b, Aaron 2026-10-12): blog post "Family kite Vacation" datePublished 2026-01-26 (JSON-LD,
//   photo uploaded 2026/01); /packages/ JSON-LD dateModified 2026-07-11; Yoast sitemap index page-sitemap lastmod
//   2026-07-11, post-sitemap lastmod 2026-01-26.
// robots.txt (2026-10-12): "User-agent: *" with no rules (everything allowed).
// Requests per run: content 6, slots 2 (pages memoised, so a full run makes 6).
// Parsed: 1 room slot (USD per room per night for 2 guests, the LOW end of the printed 100-150 range; the range is
//   kept in the room features) + 1 slot per pack (USD per person for the 3-night package, packageNights 3).
// Known limits: no season dates or year on the price lines; which nights cost 100 vs 150 is not stated. spotCoords
//   omitted: the site's only map embed is a country-wide viewport (zoom ~2,000 km), not a pin.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, ldOfType, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://costakite.com';
export const CK_HOME_URL = `${SITE}/`;
export const CK_ACCOMMODATION_URL = `${SITE}/accommodation-costa-rica-kiteboarding/`;
export const CK_PACKAGES_URL = `${SITE}/packages/`;
export const CK_COURSES_URL = `${SITE}/courses-and-rentals-costa-rica-kite/`;
export const CK_SPOT_URL = `${SITE}/spot-info-costa-rica-kite/`;
export const CK_FAMILY_URL = `${SITE}/family-kite-vacation/`;
const BOOKING_URL = `${SITE}/contact-costa-rica-kitesurf/`;

export interface CkRoom { name: string; text: string; guests: number | null; min: number | null; max: number | null; raw: string | null }
export interface CkPack { name: string; items: string[]; nights: number | null; price: number; perPerson: boolean; minPersons: number | null; raw: string }
export interface CkCourse { group: string; name: string; price: number; detail: string | null }

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// --- memoised page fetch (content and slots share the accommodation + packages pages) ----------------------
const pageCache = new Map<string, Promise<string>>();
function page(url: string): Promise<string> {
  if (!pageCache.has(url)) {
    const p = fetchText(url, { accept: 'text/html' });
    p.catch(() => pageCache.delete(url));
    pageCache.set(url, p);
  }
  return pageCache.get(url)!;
}

/** <main> without scripts, styles, the review widget and the sidebar. */
function mainRoot(html: string) {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, aside, header, footer, nav, .ti-widget')) el.remove();
  return root.querySelector('main') ?? root.querySelector('#main') ?? root;
}
/** Visible text of <main> as lines (block elements break lines). */
function mainLines(html: string): string[] {
  return mainRoot(html).structuredText.split('\n').map(l => collapse(l)).filter(Boolean);
}
function mainText(html: string): string {
  return collapse(mainLines(html).join(' '));
}

// --- pure parsers -------------------------------------------------------------------------------------
/** Accommodation page: <h3> room heading, then "Price per night for 2 people: 100$-150$". */
export function parseCkRooms(html: string): CkRoom[] {
  const lines = mainLines(html);
  const out: CkRoom[] = [];
  const heads = mainRoot(html).querySelectorAll('h3').map(h => collapse(h.text)).filter(Boolean);
  for (const name of heads) {
    const i = lines.indexOf(name);
    if (i < 0) continue;
    const rest: string[] = [];
    for (const l of lines.slice(i + 1)) {
      if (heads.includes(l) || /^Contact$/i.test(l)) break;
      rest.push(l);
    }
    const priceLine = rest.find(l => /price per night/i.test(l)) ?? null;
    const m = priceLine?.match(/for\s+(\d+)\s+(?:people|persons?|guests?)\s*:\s*\$?\s*([\d.,]+)\s*\$?(?:\s*-\s*\$?\s*([\d.,]+)\s*\$?)?/i);
    if (!m) continue;
    out.push({
      name,
      text: rest.filter(l => l !== priceLine).join(' '),
      guests: Number(m[1]),
      min: parseAmount(m[2]),
      max: m[3] ? parseAmount(m[3]) : null,
      raw: priceLine,
    });
  }
  return out;
}

/** Packages page: "SOLO TRAVELLER PACK:" ... "PRICE: $999" / "PRIVATE DOUBLE ROOM PACK:" ... "PRICE per person is : $799". */
export function parseCkPacks(html: string): CkPack[] {
  const lines = mainLines(html);
  const out: CkPack[] = [];
  let cur: { name: string; items: string[] } | null = null;
  for (const l of lines) {
    const head = l.match(/^([A-Z][A-Z ]+PACK)\s*:?$/);
    if (head) { cur = { name: head[1], items: [] }; continue; }
    if (!cur) continue;
    const price = l.match(/^PRICE(\s+per person)?(?:\s+is)?\s*:\s*\$\s?([\d.,]+)/i);
    if (price) {
      const items = cur.items;
      const amount = parseAmount(price[2]);
      const nights = items.join(' ').match(/(\d+)\s+nights/i);
      const minP = items.join(' ').match(/minimum\s+(\d+)\s+persons?/i);
      if (amount !== null) {
        out.push({ name: cur.name, items, nights: nights ? Number(nights[1]) : null, price: amount, perPerson: !!price[1] || /^SOLO/i.test(cur.name), minPersons: minP ? Number(minP[1]) : null, raw: l });
      }
      cur = null;
      continue;
    }
    cur.items.push(l.replace(/\s*\.$/, '').replace(/\s+\./g, '.'));
  }
  return out;
}

/** "* All Packages: Not available in Christmas and Easter." */
export function parseCkPackNote(html: string): string | null {
  const l = mainLines(html).find(x => /all packages/i.test(x));
  return l ? l.replace(/^\*\s*/, '').replace(/\.$/, '') : null;
}

/** Courses page: tab titles (Group Courses / Private / Wing Foil / Rentals and Others) -> rpt_plan price cards. */
export function parseCkCourses(html: string): { courses: CkCourse[]; currencyNote: string | null } {
  const root = parse(html);
  const courses: CkCourse[] = [];
  for (const a of root.querySelectorAll('.squelch-taas-tab a')) {
    const group = collapse(a.text);
    const id = (a.getAttribute('href') ?? '').replace(/^#/, '');
    const box = id ? root.querySelector(`[id="${id}"]`) : null;
    if (!box) continue;
    for (const plan of box.querySelectorAll('.rpt_plan')) {
      const name = collapse(plan.querySelector('.rpt_title')?.text ?? '');
      const price = parseAmount(collapse(plan.querySelector('.rpt_price')?.text ?? ''));
      if (!name || price === null) continue;
      courses.push({ group, name, price, detail: collapse(plan.querySelector('.rpt_description')?.text ?? '') || null });
    }
  }
  const currencyNote = mainLines(html).find(l => /all prices are per person in usd/i.test(l))?.replace(/^\*\s*/, '') ?? null;
  return { courses, currencyNote };
}

export function buildCkSlots(rooms: CkRoom[], packs: CkPack[], packNote: string | null): Slot[] {
  const out: Slot[] = [];
  for (const r of rooms) {
    if (r.min === null) continue;
    out.push({
      key: `${keyPart(r.name.replace(/\(.*?\)/g, ''))}|${r.guests ?? 'x'}p`,
      startDate: null,
      endDate: null,
      unit: r.name,
      price: r.min,
      currency: 'USD',
      priceUnit: 'per_night',
      priceBasis: 'room',
      occupancy: r.guests,
      availability: 'on_request',
      availabilityText: 'booking by WhatsApp or e-mail',
      spotsLeft: null,
    });
  }
  for (const p of packs) {
    out.push({
      key: keyPart(p.name),
      startDate: null,
      endDate: null,
      unit: `${p.name.charAt(0)}${p.name.slice(1).toLowerCase()} (${p.items.join(', ')})`,
      price: p.price,
      currency: 'USD',
      priceUnit: 'package',
      priceBasis: 'person',
      occupancy: p.minPersons ?? (/solo/i.test(p.name) ? 1 : null),
      availability: 'on_request',
      availabilityText: packNote,
      spotsLeft: null,
      packageNights: p.nights,
    });
  }
  return out;
}

const fmtUsd = (n: number): string => `USD ${n.toLocaleString('en-US')}`;

export interface CkPages { home: string; accommodation: string; packages: string; courses: string; spot: string; family: string }

export function parseCostaKiteContent(p: CkPages): OfferContent {
  const home = mainText(p.home);
  const acc = mainText(p.accommodation);
  const spot = mainText(p.spot);
  const family = mainText(p.family);
  const rooms = parseCkRooms(p.accommodation);
  const packs = parseCkPacks(p.packages);
  const packNote = parseCkPackNote(p.packages);
  const { courses, currencyNote } = parseCkCourses(p.courses);
  const modified = (ldOfType(p.packages, 'WebPage')[0]?.dateModified as string | undefined)?.slice(0, 10) ?? null;
  const posted = (ldOfType(p.family, 'BlogPosting')[0]?.datePublished as string | undefined)?.slice(0, 10)
    ?? (ldOfType(p.family, 'Article')[0]?.datePublished as string | undefined)?.slice(0, 10) ?? null;
  const season = spot.match(/strong winds everyday from ([A-Z][a-z]+) to ([A-Z][a-z]+)/);
  const airportKm = spot.match(/Liberia, just (\d+)\s?Km away/i)?.[1] ?? null;
  const townKm = spot.match(/La Cruz \((\d+)\s?Km\)/i)?.[1] ?? null;
  const room = rooms[0] ?? null;
  const solo = packs.find(k => /solo/i.test(k.name)) ?? null;
  const dbl = packs.find(k => /double/i.test(k.name)) ?? null;

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: r.text || null,
    features: [
      ...(/private bathroom/i.test(r.text) ? ['Private bathroom'] : []),
      ...(/\bTV\b/.test(r.text) ? ['TV'] : []),
      ...(/\bAC\b|air ?con/i.test(r.text) ? ['Air conditioning'] : []),
      ...(/breakfast/i.test(r.name) ? ['Breakfast included'] : []),
      ...(r.min !== null ? [`${fmtUsd(r.min)}${r.max ? `-${r.max}` : ''} per night for ${r.guests ?? 2} people (as printed: "${r.raw}")`] : []),
    ],
  }));

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of [
    ...imageCandidates(p.accommodation, CK_ACCOMMODATION_URL, null, 40),
    ...imageCandidates(p.family, CK_FAMILY_URL, null, 20),
    ...imageCandidates(p.packages, CK_PACKAGES_URL, null, 20),
    ...imageCandidates(p.home, CK_HOME_URL, null, 40),
  ]) {
    if (!/^https:\/\/costakite\.com\/wp-content\/uploads\//.test(u)) continue;
    if (/logo|icon|flag|banner-|\.svg|\.gif|-\d{2,3}x\d{2,3}\.(?:jpe?g|png)$/i.test(u)) continue;
    const k = u.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '');
    if (seen.has(k)) continue;
    seen.add(k); imageUrls.push(u);
  }

  const summary = [
    `Costa Kite is a kite school with IKO-certified instructors on Bahia Salinas (Playa Copal) near La Cruz in Guanacaste, north-west Costa Rica, and houses its students at the Nandel Beach Resort, a resort right on the kite beach with a pool, a restaurant and Wi-Fi that the school markets as its own accommodation.`,
    room && room.min !== null
      ? `Private double rooms with bathroom, TV and air conditioning include breakfast (${fmtUsd(room.min)}${room.max ? `-${room.max}` : ''} per night for two)${solo || dbl ? `; three-night packs with breakfast and three days of private lessons cost ${[solo ? `${fmtUsd(solo.price)} for a solo traveller` : null, dbl ? `${fmtUsd(dbl.price)} per person in a double room` : null].filter(Boolean).join(' or ')}` : ''}.`
      : 'Rooms and kite packages are priced on request.',
    `${season ? `Strong wind blows daily from ${season[1]} to ${season[2]} over fairly flat water; ` : ''}the school rents gear on the beach, offers radio lessons and books rooms by WhatsApp or e-mail.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Costa Kite - Nandel Beach Resort',
    summary,
    continent: 'North America',
    country: 'Costa Rica',
    region: 'Guanacaste',
    spot: 'Bahia Salinas',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'], // Zero to Hero, refresher, private lessons, instructor courses
    kiteLessons: /IKO/.test(home) || courses.length > 0,
    equipmentRental: courses.some(c => /gear rent/i.test(c.name)) || /rent equipment/i.test(family),
    beginnerFriendly: true,
    includedServices: ['Breakfast', 'Wi-Fi in all rooms', 'Pool'],
    optionalServices: [
      ...courses.map(c => `${c.group}: ${c.name}${c.detail ? ` (${c.detail})` : ''} ${fmtUsd(c.price)}${/rentals/i.test(c.group) ? '' : ' per person'}`),
      ...packs.map(k => `${k.name.charAt(0)}${k.name.slice(1).toLowerCase()}: ${k.items.join(', ')}; ${fmtUsd(k.price)}${k.perPerson && !/solo/i.test(k.name) ? ' per person' : ''}`),
      'Wing foil, SUP and Pilates lessons',
      'Radio lessons (Bbtalkin)',
      'Afternoon activities organised by the school (SUP, Pilates, sunsets)',
      'Restaurant at the resort',
    ],
    accommodation: 'beachfront resort rooms (Nandel Beach Resort) with pool and restaurant',
    mealPlan: 'breakfast',
    languages: [],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: CK_ACCOMMODATION_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `accommodation: ${acc}`,
      `packages (dateModified ${modified ?? '?'}): ${packs.map(k => `${k.name}: ${k.items.join(', ')} | ${k.raw}`).join(' || ')} | ${packNote ?? ''}`,
      `courses: ${courses.map(c => `${c.group} / ${c.name} / ${c.detail ?? '-'} / $${c.price}`).join('; ')} | ${currencyNote ?? 'no currency note'}`,
      `spot: ${spot}`,
      `family kite vacation (posted ${posted ?? '?'}): ${family}`,
      `home: ${home}`,
      `distances: Liberia airport ${airportKm ?? '?'} km, La Cruz ${townKm ?? '?'} km`,
    ].join('\n'),
  };
}

export const costaKiteBahiaSalinas: OfferAdapter = {
  key: 'costa-kite-bahia-salinas',
  name: 'Costa Kite - Nandel Beach Resort (Bahia Salinas)',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Costa Kite',
    websiteUrl: SITE,
    rootDomain: 'costakite.com',
    contactEmail: 'info@costakite.com', // site header + contact widget, 2026-10-12
    whatsapp: '+50685003222',
    phone: '+50685003222',
  },
  url: CK_ACCOMMODATION_URL,
  slotMethod: 'price_table',
  fetchBudget: 8,
  async fetchContent() {
    const home = await page(CK_HOME_URL);
    const accommodation = await page(CK_ACCOMMODATION_URL);
    const packages = await page(CK_PACKAGES_URL);
    const courses = await page(CK_COURSES_URL);
    const spot = await page(CK_SPOT_URL);
    const family = await page(CK_FAMILY_URL);
    return parseCostaKiteContent({ home, accommodation, packages, courses, spot, family });
  },
  async fetchSlots(ctx) {
    const rooms = parseCkRooms(await page(CK_ACCOMMODATION_URL));
    let packs: CkPack[] = [];
    let note: string | null = null;
    try {
      const html = await page(CK_PACKAGES_URL);
      packs = parseCkPacks(html);
      note = parseCkPackNote(html);
    } catch (err) {
      ctx.incomplete(`packages page failed: ${(err as Error).message}`);
    }
    if (rooms.length === 0 && packs.length === 0) throw new Error('costa-kite: neither the room price nor the packs were found (page changed?)');
    if (rooms.length === 0) ctx.note('no "Price per night" line on the accommodation page');
    return buildCkSlots(rooms, packs, note);
  },
};
