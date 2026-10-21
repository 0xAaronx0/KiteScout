// ---------------------------------------------------------------------------
// Wind Sports Fiji, Nananu-i-Ra island off Rakiraki (north coast of Viti Levu, Fiji) - family-run eco lodge
// (owners Warren and Masha) for kitesurfers and wing foilers: three beachfront bures and two shared Mango Lodges on
// the hill, all-inclusive Saturday-to-Saturday weeks with meals, Nadi airport transfers and daily boat support.
//
// Data path (checked 2026-10-12): Squarespace site windsportsfiji.com.
//   content  / (spot, trade winds), /stay (what a week includes, the two accommodation types with prices,
//            food, typical day), /kitesurfing (lessons, gear hire, spots).
//   slots    /book-now: "We take booking for week-long stays running from Saturday to Saturday. For our 2026 season,
//            we have dates available starting from April 4 until November 7." + /stay: per accommodation an <h4>
//            ("Beachfront Bures", "Shared Seaview mango LODGES") and "Week long, all inclusive packages starting
//            from $3595 AUD per person" (the lodges' line omits "AUD"; the page's general line says "$2595 AUD").
// No booking engine: a request form ("fill out the form below to request availability") -> 'on_request'.
// robots.txt (2026-10-12): Squarespace defaults (/config, /search, /api/, /static/, ?format=json ...), the pages
//   above are allowed.
// Requests per run: content 3, slots 2.
// Parsed: slot = accommodation type x season ("beachfront-bures|2026"), AUD per person for the 7-night week
//   (priceUnit 'package', packageNights 7, minNights 7, priceBasis person) with the season's real limits
//   (2026-04-04 .. 2026-11-07); a season that ended before today yields no slots. Discounts (non-riders -30%,
//   teens -50%, under-12 free) go into the room features.
// Known limits: prices are "from" prices for an adult rider; arrival is any Saturday in the season (no fixed
//   camp dates). No 2027 dates on the site yet.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates, iso, monthOf, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://windsportsfiji.com';
export const WSF_HOME_URL = `${SITE}/`;
export const WSF_STAY_URL = `${SITE}/stay`;
export const WSF_BOOK_URL = `${SITE}/book-now`;
const WSF_KITE_URL = `${SITE}/kitesurfing`;
const NIGHTS = 7;

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Headings, paragraphs and list items in document order (script/style/noscript dropped). */
export function wsfBlocks(html: string): Array<{ tag: string; text: string }> {
  const s = html.replace(/<(script|style|svg|noscript)\b[\s\S]*?<\/\1>/gi, ' ');
  const out: Array<{ tag: string; text: string }> = [];
  for (const m of s.matchAll(/<(h[1-4]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = clean(m[2].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '));
    if (text && !/^Slide \d+/.test(text)) out.push({ tag: m[1].toLowerCase(), text });
  }
  return out;
}

// --- pure parsers -----------------------------------------------------------------------------
export interface WsfSeason { start: string; end: string; text: string }
export interface WsfUnit { name: string; price: number; currency: string; description: string; rooms: string[]; terms: string | null }

/** "For our 2026 season, we have dates available starting from April 4 until November 7." */
export function parseWsfSeason(html: string): WsfSeason | null {
  const t = wsfBlocks(html).map(b => b.text).join(' ');
  const m = t.match(/For our (20\d{2}) season, we have dates available starting from ([A-Z][a-z]+) (\d{1,2}) until ([A-Z][a-z]+) (\d{1,2})/);
  if (!m || !monthOf(m[2]) || !monthOf(m[4])) return null;
  const y = Number(m[1]);
  const start = iso(y, monthOf(m[2])!, Number(m[3]));
  const end = iso(y, monthOf(m[4])!, Number(m[5]));
  return end >= start ? { start, end, text: m[0] } : null;
}

/** Accommodation types on /stay: <h4> heading, description, room lines, "packages starting from $X ... per person". */
export function parseWsfUnits(html: string): WsfUnit[] {
  const blocks = wsfBlocks(html);
  const all = blocks.map(b => b.text).join(' ');
  const pageCurrency = all.match(/\$\s?[\d,]+\s*(AUD|USD|FJD|NZD)\b/)?.[1] ?? null;
  const out: WsfUnit[] = [];
  let cur: { name: string; texts: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const line = cur.texts.find(t => /packages starting from \$/i.test(t));
    const m = line?.match(/starting from \$\s?([\d,]+)\s*(AUD|USD|FJD|NZD)?\s*per person/i);
    const price = m ? parseAmount(m[1]) : null;
    const currency = m?.[2]?.toUpperCase() ?? pageCurrency;
    if (price && currency) {
      out.push({
        name: cur.name,
        price,
        currency,
        description: cur.texts[0] ?? '',
        rooms: cur.texts.filter(t => /^(Bure|Upper|Lower) [\w ]+ - /.test(t)),
        terms: line?.match(/\(([^)]*)\)/)?.[1] ?? null,
      });
    }
    cur = null;
  };
  for (const b of blocks) {
    if (/^h[1-4]$/.test(b.tag)) { flush(); cur = { name: b.text, texts: [] }; continue; }
    cur?.texts.push(b.text);
  }
  flush();
  return out;
}

const unitName = (h: string): string => (/bure/i.test(h) ? 'Beachfront bure' : /mango lodge/i.test(h) ? 'Shared seaview Mango Lodge' : h);

export function buildWsfSlots(units: WsfUnit[], season: WsfSeason, today: string): Slot[] {
  if (season.end < today) return [];
  const year = season.start.slice(0, 4);
  return units.map(u => ({
    key: `${keyPart(u.name)}|${year}`,
    startDate: season.start,
    endDate: season.end,
    unit: `${unitName(u.name)} - all-inclusive week (Saturday to Saturday)`,
    price: u.price,
    currency: u.currency,
    priceUnit: 'package',
    priceBasis: 'person',
    occupancy: null,
    availability: 'on_request',
    availabilityText: null,
    spotsLeft: null,
    packageNights: NIGHTS,
    minNights: NIGHTS,
  }));
}

// --- content ----------------------------------------------------------------------------------
export interface WsfPages { home: string; stay: string; book: string; kite: string }

export function parseWindSportsFijiContent(p: WsfPages): OfferContent {
  const home = wsfBlocks(p.home).map(b => b.text);
  const stay = wsfBlocks(p.stay);
  const kite = wsfBlocks(p.kite).map(b => b.text);
  const units = parseWsfUnits(p.stay);
  const season = parseWsfSeason(p.book);
  const homeText = home.join(' ');
  const kiteText = kite.join(' ');
  const includes = stay.filter(b => b.tag === 'li' && /^[A-Z][A-Za-z /&-]+:/.test(b.text))
    .map(b => b.text.match(/^([^:]+:\s*[^.!]+[.!]?)/)?.[1]?.trim() ?? b.text);
  const notIncluded = stay.map(b => b.text.match(/Not Included:\s*(.+)$/i)?.[1]).find(Boolean) ?? null;
  const discounts = stay.find(b => /Non-kiters\/foilers get 30% off/i.test(b.text))?.text.match(/Non-kiters[^!]*!?/)?.[0] ?? null;
  const wind = homeText.match(/steady trade winds \(([^)]+)\)/)?.[1] ?? null;
  const lesson = kiteText.match(/Formal Instruction: AUD\$(\d+) per hour/)?.[1] ?? null;
  const course = kiteText.match(/True Beginner Kite Surf Course: AUD\$(\d+)/)?.[1] ?? null;
  const hire = kiteText.match(/Rental prices are: AUD\$(\d+) per day \/ AUD\$(\d+) per week/);
  const cheapest = [...units].sort((a, b) => a.price - b.price)[0];
  const fmt = (n: number) => n.toLocaleString('en-US');

  const rooms: ContentRoom[] = units.map(u => ({
    name: unitName(u.name),
    description: u.description || null,
    features: [
      ...u.rooms,
      `All-inclusive week from ${u.currency} ${fmt(u.price)} per person (adult rider)`,
      ...(u.terms ? [u.terms] : []),
    ],
  }));

  const imgs: string[] = [];
  const seen = new Set<string>();
  for (const [html, base] of [[p.stay, WSF_STAY_URL], [p.home, WSF_HOME_URL], [p.kite, WSF_KITE_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 80)) {
      if (!/images\.squarespace-cdn\.com\/content\//.test(u) || /logo|favicon|icon|\.png(\?|$)/i.test(u)) continue;
      const k = u.replace(/\?.*$/, '');
      if (seen.has(k)) continue;
      seen.add(k); imgs.push(k);
    }
  }

  const summary = [
    `Wind Sports Fiji is a family-run eco lodge on Nananu-i-Ra island off the north coast of Viti Levu, Fiji, in the Vatu-i-Ra passage with steady trade winds${wind ? ` (${wind})` : ''}; by its own account the only accommodation on the island with all-day boat support for riders.`,
    `Stays are all-inclusive Saturday-to-Saturday weeks: 7 nights in one of three beachfront bures or the shared Mango Lodges on the hill, all meals (mostly vegetarian), Nadi airport transfers, daily boat trips and downwinders${cheapest ? `, from ${cheapest.currency} ${fmt(cheapest.price)} per person` : ''}${discounts ? ' with discounts for non-riders, teens and kids' : ''}.`,
    `Kite lessons${lesson ? ` (AUD ${lesson} per hour` : ''}${course ? `${lesson ? ', ' : ' ('}AUD ${course} beginner course)` : lesson ? ')' : ''} and gear hire are extra${season ? `; the ${season.start.slice(0, 4)} season runs from ${season.start} to ${season.end}` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Wind Sports Fiji',
    summary,
    continent: 'Oceania',
    country: 'Fiji',
    region: 'Ra Province, Viti Levu',
    spot: 'Nananu-i-Ra',
    itinerarySpots: [],
    durationDays: null,
    // kitesurfing page: lessons for beginners, coaching for riders, downwinders
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: !!lesson || /lessons/i.test(kiteText),
    equipmentRental: !!hire,
    beginnerFriendly: /perfect for beginner kite surfers|perfect learning location/i.test(kiteText),
    includedServices: includes.length ? includes : ['Transfers', 'Accommodation', 'Dedicated Boat Support', 'Food'],
    optionalServices: [
      lesson ? `Kite lessons: AUD ${lesson} per hour incl. gear` : null,
      course ? `True beginner kite course: AUD ${course} (6 h 1:1 over 3 days, gear incl.)` : null,
      hire ? `Kite gear hire: AUD ${hire[1]} per day / AUD ${hire[2]} per week` : null,
      'Scuba diving (Vatu-i-Ra / Bligh Water) with partner divers',
      'Private transfers on other days',
      notIncluded ? `Not included: ${notIncluded}` : null,
    ].filter((x): x is string => !!x),
    accommodation: 'three beachfront bures and two shared hillside lodges (private rooms and bunk rooms)',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: WSF_STAY_URL,
    bookingUrl: WSF_BOOK_URL,
    sourceText: [
      `home: ${homeText}`,
      `stay: ${stay.map(b => b.text).join(' | ')}`,
      `kitesurfing: ${kiteText}`,
      `season: ${season?.text ?? '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const windSportsFijiNananuIRa: OfferAdapter = {
  key: 'wind-sports-fiji-nananu-i-ra',
  name: 'Wind Sports Fiji',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Wind Sports Fiji',
    websiteUrl: SITE,
    rootDomain: 'windsportsfiji.com',
    contactEmail: 'windsportsfiji@gmail.com',
    whatsapp: '+6799488888',
    phone: '+6799488888',
  },
  url: WSF_STAY_URL,
  slotMethod: 'price_table',
  fetchBudget: 6,
  async fetchContent() {
    const home = await fetchText(WSF_HOME_URL, { accept: 'text/html' });
    const stay = await fetchText(WSF_STAY_URL, { accept: 'text/html' });
    const book = await fetchText(WSF_BOOK_URL, { accept: 'text/html' });
    const kite = await fetchText(WSF_KITE_URL, { accept: 'text/html' });
    return parseWindSportsFijiContent({ home, stay, book, kite });
  },
  async fetchSlots(ctx: FetchContext) {
    const season = parseWsfSeason(await fetchText(WSF_BOOK_URL, { accept: 'text/html' }));
    const units = parseWsfUnits(await fetchText(WSF_STAY_URL, { accept: 'text/html' }));
    if (!season) throw new Error('wind-sports-fiji: season sentence ("For our YYYY season ... from <date> until <date>") not found on /book-now');
    if (units.length < 2) throw new Error(`wind-sports-fiji: accommodation prices not found or changed (${units.length} parsed)`);
    const slots = buildWsfSlots(units, season, todayIso());
    if (slots.length === 0) ctx.note(`season ${season.start}..${season.end} is over; no newer season on /book-now`);
    return slots;
  },
};
