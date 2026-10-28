// ---------------------------------------------------------------------------
// Haugastøl Turistsenter ("Haugastøl 1000 MOH"), Haugastøl (Hol, Buskerud, Norway) - the family-run mountain hotel
// on Rv7 at the eastern edge of the Hardangervidda plateau, a SNOWKITE base (kiting on snow, not water): owner
// Bjørn Kaupang (6-time snowkite world champion) gives daily spot advice, the two Norwegian schools Kitekurs.no and
// Vindskolen.no run their weekend snowkite courses from the hotel, the hotel books private courses and snowkite
// guides itself and is a full Ozone snowkite dealer. Apartments for 1-8 guests (kitchen, bathroom) and two shared
// 8-bed mountain rooms (half board only).
//
// Data path (checked 2026-10-28): Next.js site, server-rendered, English pages under /en/:
//   content  /en/accommodation (four room types with "Room details" label/value pairs), /en/snowkiting (season,
//            local knowledge, Hardangervidda rules), /en/kite-course (course providers, what is included),
//            /en/guiding (snowkite guides on request), /en/packages (winter package: two nights with meals),
//            /en/food-drinks (meal prices, seasons).
//   slots    none: the site prints no room prices. Rooms are booked in Mews (app.mews.com/distributor/...), whose
//            robots.txt disallows everything ("Disallow: /") - never read. booking.haugastol.no is the bike shop.
//            fetchSlots re-reads the accommodation page (memoised) and returns [] (offer = "price on request");
//            it notes when NOK room prices appear on the page so the adapter can be extended.
// Booking: Mews online booking with instant confirmation (inferred from "Book online" + the Mews distributor);
//   kite courses are booked with the schools, private/group courses and guides by mail@haugastol.no.
// Liveness (2026-10-28): the food page names the shoulder season "from 20 September until the start of February
//   2027"; the site is a recent Next.js rebuild (Ozone Explore V3 dealer page).
// robots.txt (2026-10-28): disallows /api/, /_next/ (also /_next/image), /strom, test paths for "*". Pages and the
//   direct /images/... files are allowed, so image candidates are the /images/ paths behind the /_next/image proxy.
// Requests per run: content 6, slots 1 (memoised: 0 extra when content ran in the same process).
// Parsed: rooms (Type A, Type B, Type D, Mountainroom) with their detail pairs; kite facts as guarded text checks.
// Known limits:
//   - No prices or availability (Mews is robots-blocked) -> confidence 'low', like other content-only stays.
//   - The kite courses are run by the two schools; their dates and prices live on kitekurs.no / vindskolen.no
//     (separate operators, not read here).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.haugastol.no';
export const HG_ACCOMMODATION_URL = `${SITE}/en/accommodation`;
export const HG_SNOWKITING_URL = `${SITE}/en/snowkiting`;
export const HG_COURSE_URL = `${SITE}/en/kite-course`;
export const HG_GUIDING_URL = `${SITE}/en/guiding`;
export const HG_PACKAGES_URL = `${SITE}/en/packages`;
export const HG_FOOD_URL = `${SITE}/en/food-drinks`;
const HG_BOOKING_URL = `${SITE}/en/booking`;

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

/** visible text lines of the page body (menus, header, footer, scripts removed) */
export function hgLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  const main = root.querySelector('main') ?? root.querySelector('body') ?? root;
  return main.structuredText.split('\n').map(s => collapse(s).replace(/[–—]/g, '-')).filter(Boolean);
}

/**
 * The room cards: "Accommodation · Type A", a one-line description, "Room details", then label/value pairs until
 * the "Book your stay" button line.
 */
export function parseHgRooms(lines: string[]): ContentRoom[] {
  const out: ContentRoom[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^Accommodation · (.+)$/);
    if (!m) continue;
    const description = lines[i + 1] ?? null;
    const features: string[] = [];
    let j = i + 2;
    if (lines[j] === 'Room details') j++;
    for (; j + 1 < lines.length && !/^Book your stay/i.test(lines[j]) && !/^Accommodation · /.test(lines[j]); j += 2) {
      features.push(`${lines[j]}: ${lines[j + 1]}`);
    }
    out.push({ name: m[1] === 'Mountainroom' ? 'Mountain room (shared)' : m[1], description, features });
  }
  return out;
}

/**
 * Image candidates: the /images/... files behind the /_next/image proxy (the proxy path is robots-blocked) plus
 * direct /images/ paths. Per photo the 2048 px variant when the page has it, else the 1024 px one; skips the
 * eco-certificate badge and the Rallarvegen bike card shown on every page.
 */
export function hgImages(htmls: string[]): string[] {
  const best = new Map<string, string>();
  for (const html of htmls) {
    const paths = [
      ...[...html.matchAll(/url=(%2Fimages%2F[^&"\\]+)/g)].map(m => decodeURIComponent(m[1])),
      ...[...html.matchAll(/"(\/images\/[^"\\?]+\.(?:jpe?g|webp|png))/gi)].map(m => m[1]),
    ];
    for (const p of paths) {
      if (/eco-lighthouse|\/00\/03\/26-/.test(p)) continue;
      const base = p.replace(/-(1024|2048)(\.\w+)$/, '$2');
      const prev = best.get(base);
      if (!prev || (/-2048\./.test(p) && !/-2048\./.test(prev))) best.set(base, p);
    }
  }
  return [...best.values()].map(p => `${SITE}${p}`);
}

export interface HgPages { accommodation: string; snowkiting: string; course: string; guiding: string; packages: string; food: string }

export function parseHaugastolContent(p: HgPages): OfferContent {
  const acc = hgLines(p.accommodation);
  const kite = hgLines(p.snowkiting).join('\n');
  const course = hgLines(p.course).join('\n');
  const guiding = hgLines(p.guiding).join('\n');
  const packages = hgLines(p.packages).join('\n');
  const food = hgLines(p.food).join('\n');
  const rooms = parseHgRooms(acc);
  if (!/one of the best spots in the world for snowkiting/i.test(kite)) throw new Error('haugastol: snowkiting claim missing on /en/snowkiting (layout changed?)');
  const schools = ['Kitekurs.no', 'Vindskolen.no'].filter(s => course.includes(s));
  if (!schools.length) throw new Error('haugastol: course providers missing on /en/kite-course (layout changed?)');
  const weekends = /Courses every weekend in the winter season/i.test(course);
  const gearIncluded = /Kite equipment is included in the course/i.test(course);
  const guides = /snowkite guides/i.test(guiding);
  const season = kite.match(/snow from (late \w+) to (late \w+)/i);
  const best = kite.match(/visiting between (\w+) and (\w+)/i);
  const winterPkg = packages.match(/Two nights with dinner Saturday evening, plus breakfast and packed lunch Saturday and Sunday/i)?.[0] ?? null;
  const dinner = food.match(/Dinner for staying guests NOK (\d+)/i)?.[1];
  const breakfast = food.match(/breakfast NOK (\d+)/i)?.[1];
  const dogFee = acc.join('\n').match(/fee of NOK (\d+)/i)?.[1];

  const summary = [
    'Haugastøl Turistsenter is a family-run mountain hotel at 1,000 m on the eastern edge of the Hardangervidda plateau in Norway, one of the best-known snowkite spots in the world; the National Tourist Route across the plateau starts at the door.',
    `Owner Bjørn Kaupang (6-time snowkite world champion) gives daily advice on spots and safety; ${schools.join(' and ')} run ${weekends ? 'weekend snowkite courses every winter weekend' : 'snowkite courses'} from the hotel${gearIncluded ? ' with kite gear included' : ''}${guides ? ', and snowkite guides can be booked through the hotel' : ''}.`,
    `It has self-catering apartments for 1-8 guests and two shared 8-bed mountain rooms (half board only)${season ? `; there is often snow from ${season[1]} to ${season[2]}` : ''}${best ? `, best from ${best[1]} to ${best[2]}` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Haugastøl Turistsenter (snowkite base, Hardangervidda)',
    summary,
    continent: 'Europe',
    country: 'Norway',
    region: 'Hardangervidda',
    spot: 'Haugastøl, Hardangervidda',
    spotCoords: { lat: 60.5124, lng: 7.8531 }, // OSM tourism=hotel "Haugastøl Turistsenter" (way 434843122)
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: gearIncluded ? true : null,
    beginnerFriendly: true,
    includedServices: [
      'Bed linen, towels and final cleaning',
      'Free fibre Wi-Fi',
      'Parking by the hotel',
      'Daily snowkite spot and safety advice from the hotel',
    ],
    optionalServices: [
      ...schools.map(s => `Weekend snowkite course (${s}, kite gear included, booked with the school)`),
      'Private and group snowkite courses (booked with the hotel)',
      ...(guides ? ['Snowkite guiding, from a few hours to a whole week (on request)'] : []),
      'Ozone snowkite gear sales',
      ...(winterPkg ? [`Winter package: ${winterPkg.charAt(0).toLowerCase()}${winterPkg.slice(1)}`] : []),
      ...(dinner && breakfast ? [`Dinner NOK ${dinner}, breakfast NOK ${breakfast} (pre-book 2 days ahead, main seasons)`] : []),
      'Cross-country ski and snowshoe rental',
      ...(dogFee ? [`Dogs in some apartments (NOK ${dogFee})`] : []),
    ],
    accommodation: 'self-catering apartments for 1-8 guests and shared mountain rooms',
    mealPlan: 'self_catering',
    languages: ['no', 'en'],
    rooms,
    imageUrls: hgImages([p.course, p.snowkiting, p.accommodation]).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: HG_SNOWKITING_URL,
    bookingUrl: HG_BOOKING_URL,
    sourceText: [acc.join('\n'), kite, course, guiding, packages].join('\n\n'),
  };
}

export const haugastolTuristsenterHardangervidda: OfferAdapter = {
  key: 'haugastol-turistsenter-hardangervidda',
  name: 'Haugastøl Turistsenter (snowkite base, Hardangervidda)',
  kind: 'accommodation',
  disciplines: ['snowkite'],
  operator: {
    name: 'Haugastøl Turistsenter',
    websiteUrl: SITE,
    rootDomain: 'haugastol.no',
    contactEmail: 'mail@haugastol.no',
    phone: '+4732087564',
  },
  url: HG_SNOWKITING_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 7,
  confidence: 'low', // no room prices on the site, Mews robots-blocked
  async fetchContent() {
    const [accommodation, snowkiting, course, guiding, packages, food] = [
      await page(HG_ACCOMMODATION_URL), await page(HG_SNOWKITING_URL), await page(HG_COURSE_URL),
      await page(HG_GUIDING_URL), await page(HG_PACKAGES_URL), await page(HG_FOOD_URL),
    ];
    return parseHaugastolContent({ accommodation, snowkiting, course, guiding, packages, food });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const lines = hgLines(await page(HG_ACCOMMODATION_URL));
    if (parseHgRooms(lines).length === 0) throw new Error('haugastol: room cards missing on /en/accommodation (layout changed?)');
    const prices = lines.filter(l => /NOK\s*\d/.test(l) && !/dog/i.test(l));
    if (prices.length) ctx.note(`room prices appeared on haugastol.no (${prices.slice(0, 3).join(' | ')}): extend the adapter`);
    return [];
  },
};
