// ---------------------------------------------------------------------------
// Sakalava Lodge, Sakalava Bay near Diego Suarez (Madagascar) - "All-inclusive kitesurf & wingfoil holiday": the
// lodge's package formula: beachfront bungalow facing the lagoon, full board, open bar, unlimited kitesurf and wingfoil
// equipment and individual IKO lessons (2 h in the morning + 2 h in the afternoon), SUP, gym, Starlink Wi-Fi.
// One place, stay + lessons sold as one package -> KIND = 'camp'. The lodge itself is in the catalog as an
// accommodation (sakalava-lodge-diego-suarez.ts: operator, skLines and parseSkSeason imported from there); this is
// the separate camp listing for the package.
//
// Data path (checked 2026-10-21), English pages of sakalava.com (WordPress/Elementor):
//   slots    /en/nos-offres-all-included/ block "All-inclusive rates 2027": three packages, each "LABEL" / "680 €" /
//            "who": "3 DAYS / 3 NIGHTS 680 € 1 person kitesurfing, individual bungalow", "1 WEEK 1400 € 1 person
//            kitesurfing, individual bungalow", "1 WEEK FOR TWO 2400 € Kitesurfing for 2 people, double bungalow".
//            One slot per package for the season of that year; the season limits (2027-04-01 .. 2027-11-30) and the
//            3-night minimum come from the budget simulator script on /en/tarifs-sakalava/ (parseSkSeason). If the
//            simulator's year differs from the rates' year the slots stay undated (note).
//            EUR, priceUnit 'package' (packageNights 3 or 7). priceBasis: one person in an individual bungalow ->
//            'person'; "for two ... double bungalow" -> 'room' with occupancy 2 (price as printed, total for two).
//   content  the same offers page (inclusions, bungalows, kitchen, kite centre facts) + its map link with the
//            lodge's coordinates (spotCoords).
// No booking engine: "Book your stay" opens a quote request (WhatsApp / contact form) -> availability 'on_request',
//   instantBooking false, liveAvailability unset (the form's "Real-time availability" line is sales copy).
// Companion without kite, children and longer stays are priced only through the simulator on the rates page (not
//   stored here; the stay adapter carries those add-ons).
// robots.txt (2026-10-21): "User-agent: * / Crawl-delay: 10", nothing disallowed. http.ts does not read Crawl-delay,
//   so this adapter waits 10 s between its own live requests.
// Requests per run: 2 (offers page + rates page; memoised for content + slots).
// Region / spot as the stay adapter: 'Diana (Diego Suarez)' / 'Sakalava Bay'.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { meta, parseAmount, todayIso } from '../parse.js';
import { parseSkSeason, sakalavaLodgeDiegoSuarez, skLines, type SkSeason } from './sakalava-lodge-diego-suarez.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://sakalava.com';
export const SKC_OFFERS_URL = `${SITE}/en/nos-offres-all-included/`;
export const SKC_RATES_URL = `${SITE}/en/tarifs-sakalava/`;
const BOOKING_URL = `${SITE}/en/contact-booking/`;
const CRAWL_DELAY_MS = 10_000;

let lastLive = 0;
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes, 10 s apart when live (robots Crawl-delay: 10) */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = (async () => {
    if (!process.env.OFFERS_FIXTURE_DIR) {
      const wait = lastLive + CRAWL_DELAY_MS - Date.now();
      if (lastLive > 0 && wait > 0) await new Promise(r => setTimeout(r, wait));
      lastLive = Date.now();
    }
    return fetchText(url, { accept: 'text/html' });
  })();
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

export interface SkcPackage { label: string; who: string; nights: number; persons: number; amount: number; currency: string; year: number | null }

/** The "All-inclusive rates <year>" block of the offers page: LABEL / "680 €" / who. */
export function parseSkcPackages(html: string): SkcPackage[] {
  const ls = skLines(html);
  const head = ls.findIndex(l => /^All-inclusive rates\s+(20\d{2})$/i.test(l));
  if (head < 0) return [];
  const year = Number(ls[head].match(/(20\d{2})/)![1]);
  const out: SkcPackage[] = [];
  for (let i = head + 1; i < ls.length - 1; i++) {
    if (/^(Companion|All rates|Book your)/i.test(ls[i])) break;
    const price = ls[i + 1].match(/^(\d[\d\s.,]*)\s*€$|^€\s*(\d[\d\s.,]*)$/);
    if (!price) continue;
    const label = ls[i];
    const who = ls[i + 2] ?? '';
    const amount = parseAmount((price[1] ?? price[2]).replace(/\s/g, ''));
    const nights = Number(label.match(/(\d+)\s*NIGHTS?/i)?.[1] ?? (/WEEK/i.test(label) ? 7 : NaN));
    const persons = Number(who.match(/(\d+)\s*(?:person|people)/i)?.[1] ?? (/FOR TWO/i.test(label) ? 2 : 1));
    if (!amount || !Number.isFinite(nights)) continue;
    out.push({ label, who, nights, persons, amount, currency: 'EUR', year });
    i += 2;
  }
  return out;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function buildSkcSlots(pkgs: SkcPackage[], season: SkSeason | null, today: string): Slot[] {
  const dated = season && pkgs[0]?.year !== null && season.start.slice(0, 4) === String(pkgs[0]?.year);
  if (dated && season.end < today) return [];
  return pkgs.map(p => ({
    key: `${p.persons}p-${p.nights}n|${p.year ?? 'undated'}`,
    startDate: dated ? season.start : null,
    endDate: dated ? season.end : null,
    unit: `${p.label.replace(/\b([A-Z])([A-Z]+)\b/g, (_, a, b) => a + b.toLowerCase())}: ${p.who}`,
    price: p.amount,
    currency: p.currency,
    priceUnit: 'package',
    priceBasis: p.persons > 1 ? 'room' : 'person',
    occupancy: p.persons,
    availability: 'on_request',
    availabilityText: `${p.year ?? ''} all-inclusive rate; quote on request (WhatsApp / form)`.trim(),
    spotsLeft: null,
    packageNights: p.nights,
    minNights: dated ? season.minNights : null,
  }));
}

/** Photos of the offers page (wp-content uploads), "-scaled" / "-WxH" twins and logos removed, og:image first. */
export function skcImages(html: string): string[] {
  const out: string[] = [];
  const stems = new Set<string>();
  const og = meta(html, 'og:image');
  for (const raw of [og ?? '', ...[...html.matchAll(/https:\/\/sakalava\.com\/wp-content\/uploads\/[^"'\s)]+?\.(?:jpe?g|webp|png)/gi)].map(m => m[0])]) {
    if (!raw || /logo|icon|favicon|cropped-|Sakalava_YPKL|tripadvisor|google/i.test(raw)) continue;
    const u = raw.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
    const stem = u.replace(/-scaled(?=\.[a-z]+$)/i, '').toLowerCase();
    if (stems.has(stem)) continue;
    stems.add(stem);
    out.push(u);
  }
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1];

const between = (ls: string[], head: RegExp, stop: RegExp): string[] => {
  const i = ls.findIndex(l => head.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of ls.slice(i + 1)) { if (stop.test(l)) break; out.push(l); }
  return out;
};

export function parseSkcContent(offersHtml: string, season: SkSeason | null): OfferContent {
  const ls = skLines(offersHtml);
  const pkgs = parseSkcPackages(offersHtml);
  if (!pkgs.length) throw new Error('sakalava-camp: no "All-inclusive rates <year>" packages on the offers page (layout changed?)');
  const coords = offersHtml.match(/google\.com\/maps\/search\/\?api=1&(?:amp;)?query=(-?\d+\.\d+),(-?\d+\.\d+)/);
  // "Everything is included" cards: title / one-line detail pairs up to the LODGING section
  const cards = between(ls, /^Everything is included$/i, /^LODGING$/i).slice(1);
  const included: string[] = [];
  for (let i = 0; i + 1 < cards.length; i += 2) included.push(`${cards[i][0].toUpperCase()}${cards[i].slice(1)}: ${cards[i + 1]}`);
  const gear = between(ls, /^Unlimited kite and wingfoiling$/i, /^Discover kitesurfing$/i).filter(l => /\d/.test(l) && l.length < 80);
  const year = pkgs[0].year;
  const week1 = pkgs.find(p => p.nights === 7 && p.persons === 1);
  const week2 = pkgs.find(p => p.nights === 7 && p.persons === 2);
  const short = pkgs.find(p => p.nights < 7);
  const eur = (n: number) => `EUR ${n.toLocaleString('en-US')}`;

  const summary = [
    'Sakalava Lodge on Sakalava Bay near Diego Suarez in northern Madagascar sells an all-inclusive kitesurf and wingfoil holiday: a bungalow facing the lagoon, full board, an open bar, and unlimited kite and wing equipment with individual IKO lessons, two hours in the morning and two in the afternoon.',
    `The lodge's IKO centre opened in 2005${gear.length ? ` (${gear.slice(0, 2).join(', ').replace(/\s*m²/g, ' m2')})` : ''}; stand up paddles, a gym and Starlink Wi-Fi are part of the stay.`,
    `${year ?? ''} rates${season ? ` (season ${monthName(season.start)} to ${monthName(season.end)} ${season.end.slice(0, 4)}, minimum ${season.minNights ?? 3} nights)` : ''}: ${[week1 && `${eur(week1.amount)} for one week for one person`, week2 && `${eur(week2.amount)} for two people sharing a bungalow`, short && `${eur(short.amount)} for ${short.nights} nights for one person`].filter(Boolean).join(', ')}; booking by quote request.`.trim(),
  ].join(' ');

  return {
    kind: 'camp',
    title: 'Sakalava Lodge All-inclusive Kitesurf and Wingfoil Holiday',
    summary,
    continent: 'Africa',
    country: 'Madagascar',
    region: 'Diana (Diego Suarez)',
    spot: 'Sakalava Bay',
    spotCoords: coords ? { lat: Number(coords[1]), lng: Number(coords[2]) } : null, // map link on the offers page
    itinerarySpots: [],
    durationDays: (week1?.nights ?? pkgs[0].nights) + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: included.length ? included : ['Beachfront bungalow', 'Full board', 'Open bar', 'Unlimited kite and wing equipment', 'Individual IKO lessons'],
    optionalServices: [
      'Companion who does not ride, children and longer stays (priced in the rates page simulator)',
      'Coaching for independent riders (Big Air, Freestyle, Wave)',
      'Nanny service for children',
    ],
    accommodation: 'Beachfront bungalow facing the lagoon (individual or double)',
    mealPlan: 'full_board',
    languages: ['fr', 'en', 'mg'],
    rooms: [],
    imageUrls: skcImages(offersHtml).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: SKC_OFFERS_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      ls.join('\n'),
      `packages: ${pkgs.map(p => `${p.label} ${p.amount} ${p.currency} (${p.who}; ${p.nights} n, ${p.persons} p)`).join(' | ')}`,
      `season (rates page simulator): ${season ? `${season.start}..${season.end} min ${season.minNights}` : '-'}`,
      `coords (offers page map link): ${coords ? `${coords[1]},${coords[2]}` : '-'}`,
    ].join('\n'),
  };
}

async function load(ctx?: Pick<FetchContext, 'note'>): Promise<{ offers: string; season: SkSeason | null }> {
  const offers = await page(SKC_OFFERS_URL);
  let season: SkSeason | null = null;
  try { season = parseSkSeason(await page(SKC_RATES_URL)); } catch (e) { ctx?.note(`rates page: ${(e as Error).message}`); }
  if (!season) ctx?.note('season limits (seasonMin / seasonMax of the rates simulator) not found: slots stay undated');
  return { offers, season };
}

export async function fetchSkcSlots(today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const { offers, season } = await load(ctx);
  const pkgs = parseSkcPackages(offers);
  if (pkgs.length < 2) throw new Error(`sakalava-camp: rate block changed (${pkgs.length} packages parsed)`);
  if (season && String(pkgs[0].year) !== season.start.slice(0, 4)) ctx?.note(`rates are for ${pkgs[0].year}, simulator season ${season.start}: slots undated`);
  const slots = buildSkcSlots(pkgs, season, today);
  if (!slots.length) ctx?.note(`the ${pkgs[0].year} season is over; no newer rates on the page`);
  return slots;
}

export const sakalavaLodgeAllInclusiveKiteWingHoliday: OfferAdapter = {
  key: 'sakalava-lodge-all-inclusive-kite-wing-holiday',
  name: 'Sakalava Lodge All-inclusive Kitesurf and Wingfoil Holiday',
  kind: 'camp',
  operator: sakalavaLodgeDiegoSuarez.operator,
  url: SKC_OFFERS_URL,
  slotMethod: 'price_table',
  fetchBudget: 2,
  async fetchContent(ctx) {
    const { offers, season } = await load(ctx);
    return parseSkcContent(offers, season);
  },
  fetchSlots: ctx => fetchSkcSlots(todayIso(), ctx),
};
