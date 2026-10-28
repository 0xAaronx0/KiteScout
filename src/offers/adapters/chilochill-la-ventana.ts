// ---------------------------------------------------------------------------
// Chilochill Glamping Resort and Kiteschool, La Ventana (Baja California Sur, Mexico) - beach glamping (the
// /en/services/ page offers "10 glamping tents", up to 4 guests per tent; private bathroom with outdoor hot shower),
// beach club and restaurant, with its own kite
// school (IKO certified instructors, lessons in English, Spanish, German and French; CORE equipment).
//
// Data path (checked 2026-10-28, after the site moved from WordPress to a Next.js build; the old /kitesurf and
// /glamping pages answer 404, which turned the daily slots job red):
//   content  /en/ (intro, reservation box), /en/kitesurf/ (school: IKO, languages, 3 / 6 / 9 / 12 h lesson formats,
//            wing and tow foil), /en/packages/kite-and-stay/ ("Kite & Stay": glamping + lessons, quote on request),
//            /en/king/ and /en/double-queen/ (tent pages: beds, private bathroom with hot shower, Wi-Fi, photos).
//   slots    none since the relaunch: lessons ("Our team will confirm current lesson options ... and rates") and the
//            Kite & Stay package ("Request a package quote ... rates are confirmed for your dates") are on request;
//            the glamping rates live in the eZee engine (live.ipms247.com), which answers HTTP 403 to our UA
//            (2026-10-14) -> price on request. The old "<N> DAY PACKAGE ... PRICE: $25,150 MXN" parser stays, so priced
//            package blocks are picked up again if the site prints them.
// Liveness guard: fetchSlots throws when the Kite & Stay page no longer names the package.
// robots.txt (2026-10-28): Allow /, Disallow /admin/, /api/, /agent/. Photos: the site's own Vercel Blob store
//   (originals; the 400x280 thumbnails, the /assets/optimized AVIF copies and the wordmark are dropped).
//   No coordinates on the site -> no spotCoords.
// Requests per run: content 5, slots 1 (the package page, memoised within a run).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, parseAmount } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://chilochill.com';
export const CC_HOME_URL = `${SITE}/en/`;
export const CC_KITE_URL = `${SITE}/en/kitesurf/`;
export const CC_PACKAGE_URL = `${SITE}/en/packages/kite-and-stay/`;
export const CC_KING_URL = `${SITE}/en/king/`;
export const CC_QUEEN_URL = `${SITE}/en/double-queen/`;
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

/** Lesson formats on /en/kitesurf/ since the relaunch: "3 h" / "6 h" ... each "Build your session plan" (no prices). */
export function parseCcLessonFormats(html: string): number[] {
  const out: number[] = [];
  for (const l of ccLines(html)) {
    const m = l.match(/^(\d{1,2})\s*h$/i);
    if (m && !out.includes(Number(m[1]))) out.push(Number(m[1]));
  }
  return out.sort((a, b) => a - b);
}

/** One tent page (/en/king/, /en/double-queen/): name, bed / bathroom tags, description. */
export function parseCcTent(html: string): ContentRoom | null {
  const lines = ccLines(html);
  const name = lines.find(l => /^(King|Double Queen) Glamping$/i.test(l));
  if (!name) return null;
  const tags = lines.filter(l => /^(\d+\s+(KING|QUEEN)\s+BEDS?|PRIVATE BATHROOM|WIFI)$/i.test(l));
  const desc = lines.find(l => /^A (private escape|comfortable base)/i.test(l)) ?? null;
  const features = [...new Set(tags.map(t => t.toLowerCase().replace(/^\w/, c => c.toUpperCase()).replace(/wifi/i, 'Wi-Fi')))];
  if (desc && /two queen beds/i.test(desc) && !features.some(f => /queen bed/i.test(f))) features.unshift('2 queen beds');
  if (lines.some(l => /own bathroom, a hot shower/i.test(l)) && !features.includes('Hot shower')) features.push('Hot shower');
  return { name: `${name.replace(/ Glamping$/i, '')} glamping tent`, description: desc, features };
}

// --- content -------------------------------------------------------------------------------------
export interface CcPages { home: string; kite: string; packagePage: string; king: string; queen: string }

/** Photos from the own Vercel Blob store: originals only, no thumbnails / AVIF copies / logo. */
export function ccImages(p: CcPages): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const pages: Array<[string, string]> = [[p.packagePage, CC_PACKAGE_URL], [p.kite, CC_KITE_URL], [p.home, CC_HOME_URL], [p.king, CC_KING_URL], [p.queen, CC_QUEEN_URL]];
  for (const [html, base] of pages) {
    for (const raw of imageCandidates(html, base, null, 40)) {
      if (!/blob\.vercel-storage\.com\/chilochill\//.test(raw)) continue;
      if (/logo|wordmark|favicon|icon/i.test(raw)) continue;
      const u = raw.replace(/-\d{2,4}x\d{2,4}(?=\.(?:webp|jpe?g|png|avif)$)/i, '');
      if (seen.has(u)) continue;
      seen.add(u); out.push(u);
    }
  }
  return out;
}

export function parseChilochillContent(p: CcPages): OfferContent {
  const home = ccLines(p.home);
  const kite = ccLines(p.kite);
  const pack = ccLines(p.packagePage);
  const formats = parseCcLessonFormats(p.kite);
  const rooms = [parseCcTent(p.king), parseCcTent(p.queen)].filter((r): r is ContentRoom => r !== null);
  const langs = kite.find(l => /instruction in English, Spanish, German or French/i.test(l)) ?? '';
  const iko = kite.some(l => /IKO-certified/i.test(l));

  const summary = [
    'Chilochill is a beach glamping resort in La Ventana, Baja California Sur, on the Sea of Cortez, with glamping tents (King or Double Queen, each with its own bathroom, hot shower and Wi-Fi), a beach club and a restaurant.',
    `Its own kite school${iko ? ' has IKO-certified instructors' : ''}${/German/i.test(langs) ? ', teaching in English, Spanish, German or French,' : ''} and offers lessons for beginners to advanced riders${formats.length ? ` (${formats.map(h => `${h} h`).join(', ')} formats)` : ''}, plus wing foil and tow foil sessions; non-guests can join too.`,
    'Kite & Stay packages combine the glamping stay with lessons; nights, lesson hours, meals and equipment are quoted on request, and glamping rates are shown in the resort\'s reservation system.',
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
    includedServices: ['Wi-Fi', 'Private bathroom with hot shower'],
    optionalServices: [
      ...(formats.length ? [`Kite lessons, ${formats.map(h => `${h} h`).join(' / ')} (price on request)`] : ['Kite lessons (price on request)']),
      'Kite & Stay package: glamping + lessons, quote on request',
      'Wing foil and tow foil sessions',
      'Desert ride, sea safari, fishing, paddle and kayak tours',
      'Restaurant and beach club',
    ],
    accommodation: 'beach glamping tents with private bathroom',
    mealPlan: null,
    languages: /German/i.test(langs) ? ['en', 'es', 'de', 'fr'] : ['en', 'es'],
    rooms,
    imageUrls: ccImages(p).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: CC_PACKAGE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${home.join(' ')}`,
      `kitesurf: ${kite.join(' ')}`,
      `kite & stay: ${pack.join(' ')}`,
      `tents: ${rooms.map(r => `${r.name} (${r.features.join(', ')})`).join('; ')}`,
    ].join('\n'),
  };
}

/** Liveness guard: the package page still names "Kite & Stay". */
export function ccHasKiteAndStay(html: string): boolean {
  return ccLines(html).some(l => /^Kite & Stay$/i.test(l));
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
  url: CC_PACKAGE_URL,
  slotMethod: 'price_table',
  instantBooking: true, // the glamping tents book online in the eZee engine ("Open reservations")
  fetchBudget: 6,
  confidence: 'low',
  async fetchContent() {
    const [home, kite, packagePage, king, queen] = [
      await page(CC_HOME_URL), await page(CC_KITE_URL), await page(CC_PACKAGE_URL), await page(CC_KING_URL), await page(CC_QUEEN_URL),
    ];
    return parseChilochillContent({ home, kite, packagePage, king, queen });
  },
  async fetchSlots(ctx) {
    const html = await page(CC_PACKAGE_URL);
    if (!ccHasKiteAndStay(html)) throw new Error('chilochill: "Kite & Stay" no longer on /en/packages/kite-and-stay/ (layout changed or package gone?)');
    const slots = buildCcSlots(parseCcPackages(html), ctx);
    if (slots.length === 0) ctx.note('chilochill: no prices on the own site since the 2026-10 relaunch (lessons and Kite & Stay quoted on request, glamping rates only in the eZee engine): price on request');
    return slots;
  },
};
