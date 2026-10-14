// ---------------------------------------------------------------------------
// Chilochill Glamping Resort and Kiteschool, La Ventana (Baja California Sur, Mexico) - beach glamping (the
// /en/services/ page offers "10 glamping tents", up to 4 guests per tent; private bathroom with outdoor hot shower),
// beach club and restaurant, with its own kite
// school (IKO certified instructors, lessons in English, Spanish, German and French; CORE equipment).
//
// Data path (checked 2026-10-14): WordPress site chilochill.com, English pages.
//   content  /en/ (intro, glamping types, address), /en/experiences/ (kitesurf school text, packages),
//            /glamping (tent types "Single King" / "Double Queen" with text), /kitesurf (school prices, packages).
//   slots    /kitesurf "Packages Kitesschool": blocks "<N> DAY PACKAGE" / "KITE & BED" / "Lodging for 2 people
//            glamping king size bed, <n> nights <d> days." / lesson hours / "PRICE: $25,150°° MXN". A package
//            becomes a slot only when the page states its length consistently (heading days = body days =
//            nights + 1). On 2026-10-14 the "4 DAY PACKAGE" says "6 nights 7 days" in its body -> left out
//            (noted), only the 3-day package (2 nights) is a slot. Glamping nightly rates are not printed on the
//            site; the booking engine is eZee (live.ipms247.com), which answers HTTP 403 to our UA even for
//            robots.txt (2026-10-14) and loads rates client-side -> not used.
// Liveness: the kitesurf page carries photos uploaded 2026/01 and 2026/02 (2026 site edit); no year on the prices.
// robots.txt (2026-10-14): chilochill.com disallows /wp-admin/ only. The home page's Google Maps embed is by name
//   only (no coordinates) -> no spotCoords.
// Requests per run: content 4, slots 1 (the /kitesurf page, memoised within a run).
// Parsed: slot = package without dates, MXN per package for 2 people sharing a king glamping tent
//   (priceUnit 'package', priceBasis 'room', occupancy 2, packageNights = nights), availability 'unknown'
//   (the page says nothing; "Book now" goes to the eZee engine). Kite lesson prices (MXN) go to optionalServices.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, parseAmount } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://chilochill.com';
export const CC_HOME_URL = `${SITE}/en/`;
export const CC_EXPERIENCES_URL = `${SITE}/en/experiences/`;
export const CC_GLAMPING_URL = `${SITE}/glamping`;
export const CC_KITE_URL = `${SITE}/kitesurf`;
const BOOKING_URL = 'https://live.ipms247.com/booking/book-rooms-chilochillglampingresort';

// --- local helpers ---------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

export function ccLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, template, nav, header, footer')) el.remove();
  return root.structuredText.split('\n').map(l => collapse(l)).filter(Boolean);
}

// --- kite school + packages --------------------------------------------------------------------------
export interface CcPackage {
  title: string;
  headingDays: number;
  nights: number | null;
  days: number | null;
  guests: number | null;
  lessonHours: number | null;
  price: number | null;
  currency: string | null;
  lines: string[];
  /** heading days = body days = nights + 1 */
  consistent: boolean;
}

export function parseCcPackages(html: string): CcPackage[] {
  const lines = ccLines(html);
  const out: CcPackage[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^(\d+)\s+DAY PACKAGE$/i);
    if (!h) continue;
    const block: string[] = [];
    for (let j = i + 1; j < lines.length && !/^\d+\s+DAY PACKAGE$/i.test(lines[j]) && !/^Learn more about us$/i.test(lines[j]); j++) block.push(lines[j]);
    const text = block.join('\n');
    const nd = text.match(/(\d+)\s+nights?\s+(\d+)\s+days?/i);
    const priceLine = block.find(l => /^PRICE:/i.test(l)) ?? '';
    const headingDays = Number(h[1]);
    const nights = nd ? Number(nd[1]) : null;
    const days = nd ? Number(nd[2]) : null;
    out.push({
      title: `${headingDays}-day ${collapse(block[0] ?? 'package').replace(/^KITE & BED$/i, 'Kite & Bed')}`,
      headingDays,
      nights,
      days,
      guests: Number(text.match(/Lodging for (\d+) people/i)?.[1]) || null,
      lessonHours: Number(text.match(/(\d+)\s+hours/i)?.[1]) || null,
      price: parseAmount(priceLine.replace(/°/g, '')),
      currency: /MXN/i.test(priceLine) ? 'MXN' : null,
      lines: block.filter(l => !/^Book now$/i.test(l)),
      consistent: nights !== null && days === headingDays && days === nights + 1,
    });
  }
  return out;
}

export function buildCcSlots(pkgs: CcPackage[], ctx?: FetchContext): Slot[] {
  const out: Slot[] = [];
  for (const p of pkgs) {
    if (!p.consistent) {
      ctx?.note(`chilochill: "${p.headingDays} DAY PACKAGE" left out: the page gives its length as ${p.nights ?? '?'} nights ${p.days ?? '?'} days`);
      continue;
    }
    if (!p.price || !p.currency) continue;
    out.push({
      key: `kite-and-bed-${p.headingDays}d`,
      startDate: null,
      endDate: null,
      unit: `Kite & Bed ${p.headingDays}-day package (king glamping tent${p.lessonHours ? `, ${p.lessonHours} h kite lessons for 1 person` : ''})`,
      price: p.price,
      currency: p.currency,
      priceUnit: 'package',
      priceBasis: 'room',
      occupancy: p.guests ?? 2,
      availability: 'unknown',
      availabilityText: null,
      spotsLeft: null,
      packageNights: p.nights,
    });
  }
  return out;
}

/** "Full course 12Hrs." + "$19,200 MXN" pairs of the kite school price list. */
export function parseCcLessons(html: string): string[] {
  const lines = ccLines(html);
  const i = lines.findIndex(l => /^PROFESSIONAL KITESCHOOL$/i.test(l));
  const end = lines.findIndex(l => /^Packages Kite/i.test(l));
  if (i < 0 || end < i) return [];
  const out: string[] = [];
  for (let j = i + 1; j < end - 1; j++) {
    if (/Hrs?\.?$/i.test(lines[j]) && /MXN/i.test(lines[j + 1])) {
      out.push(`${lines[j].replace(/\.$/, '').replace(/(\d+)Hrs/i, '$1 h').replace(/^For Hr$/i, 'Per hour')}: ${lines[j + 1].replace(/\$\s?([\d,]+)\s*MXN/g, 'MXN $1')}`);
      j++;
    }
  }
  return out;
}

// --- content -------------------------------------------------------------------------------------
export interface CcPages { home: string; experiences: string; glamping: string; kite: string }

export function parseCcTents(html: string): ContentRoom[] {
  const lines = ccLines(html);
  const out: ContentRoom[] = [];
  lines.forEach((l, i) => {
    if (/^(Single King|Double Queen)$/i.test(l) && lines[i + 1] && !/^Book/i.test(lines[i + 1])) {
      out.push({ name: `Glamping tent ${l}`, description: lines[i + 1], features: ['Private bathroom with outdoor hot shower', 'Wi-Fi'] });
    }
  });
  return out;
}

export function parseChilochillContent(p: CcPages, ctx?: FetchContext): OfferContent {
  const home = ccLines(p.home);
  const exp = ccLines(p.experiences);
  const kite = ccLines(p.kite);
  const pkgs = parseCcPackages(p.kite);
  const lessons = parseCcLessons(p.kite);
  const rooms = parseCcTents(p.glamping);
  const ok = pkgs.filter(x => x.consistent && x.price);
  const years = exp.join(' ').match(/With (\d+) years of experience in teaching kitesurfing/i)?.[1] ?? null;
  const langs = kite.find(l => /IKO certified instructors classes in/i.test(l)) ?? '';

  if (rooms[0]) {
    for (const x of ok) rooms[0].features.push(`Kite & Bed ${x.headingDays}-day package: ${x.nights} nights for ${x.guests ?? 2} people with ${x.lessonHours} h of kite lessons for 1 person, MXN ${x.price!.toLocaleString('en-US')}`);
  }

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const raw of [...imageCandidates(p.home, CC_HOME_URL, null, 30), ...imageCandidates(p.kite, CC_KITE_URL, null, 20), ...imageCandidates(p.glamping, CC_GLAMPING_URL, null, 20), ...imageCandidates(p.experiences, CC_EXPERIENCES_URL, null, 30)]) {
    const u = raw.replace(/^http:\/\//, 'https://');
    if (/\.svg|logo|icon|Artboard|favicon|play_|tiktok_/i.test(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u); imageUrls.push(u);
  }

  const summary = [
    'Chilochill is a beach glamping resort in La Ventana, Baja California Sur, on the Sea of Cortez facing Cerralvo Island, with private glamping tents (Single King or Double Queen, each with its own bathroom and an outdoor hot shower), a beach club and a Mexican restaurant.',
    `Its own kite school${years ? ` (${years} years of teaching)` : ''} has IKO certified instructors teaching in English, Spanish, German and French on CORE equipment; lessons are open to guests and non-guests.`,
    ok.length ? `Kite & Bed packages combine the glamping stay with lessons, from MXN ${Math.min(...ok.map(x => x.price!)).toLocaleString('en-US')} for ${ok[0].nights} nights for two people.` : 'Glamping and kite packages are priced on request.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Chilochill Glamping Resort and Kiteschool',
    summary,
    continent: 'North America',
    country: 'Mexico',
    region: 'La Ventana, Baja California Sur',
    spot: 'La Ventana',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: ['Wi-Fi', 'Breakfast in the Kite & Bed packages', 'Use of paddleboard, kayak and snorkel equipment (Kite & Bed packages)'],
    optionalServices: [
      ...lessons.map(l => `Kite lessons, ${l}`),
      'E-bike tours (Santa Cruz e-bikes)',
      'Seafari and fishing tours',
      'Restaurant and beach club',
    ],
    accommodation: 'beach glamping tents with private bathroom',
    mealPlan: null,
    languages: /German/i.test(langs) ? ['en', 'es', 'de', 'fr'] : ['en', 'es'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: CC_KITE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${home.join(' ')}`,
      `kitesurf: ${kite.join(' ')}`,
      `experiences: ${exp.filter(l => /kite|CORE|IKO|glamping/i.test(l)).join(' ')}`,
      `packages: ${pkgs.map(x => `${x.headingDays} DAY: ${x.nights}n/${x.days}d ${x.price} ${x.currency} ${x.consistent ? 'ok' : 'INCONSISTENT'}`).join('; ')}`,
    ].join('\n'),
  };
}

export const chilochillLaVentana: OfferAdapter = {
  key: 'chilochill-la-ventana',
  name: 'Chilochill Glamping Resort and Kiteschool La Ventana',
  kind: 'accommodation',
  operator: {
    name: 'Chilochill Glamping Resort and Kiteschool',
    websiteUrl: SITE,
    rootDomain: 'chilochill.com',
    contactEmail: 'reservas@chilochill.com',
    whatsapp: '+52 612 200 3779',
    phone: '+52 612 200 3779',
  },
  url: CC_KITE_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 5,
  confidence: 'medium',
  async fetchContent(ctx) {
    const home = await page(CC_HOME_URL);
    const experiences = await page(CC_EXPERIENCES_URL);
    const glamping = await page(CC_GLAMPING_URL);
    const kite = await page(CC_KITE_URL);
    return parseChilochillContent({ home, experiences, glamping, kite }, ctx);
  },
  async fetchSlots(ctx) {
    const pkgs = parseCcPackages(await page(CC_KITE_URL));
    if (pkgs.length === 0) throw new Error('chilochill: no "DAY PACKAGE" block on /kitesurf (layout changed?)');
    return buildCcSlots(pkgs, ctx);
  },
};
