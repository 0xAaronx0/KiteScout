// ---------------------------------------------------------------------------
// Watersport Oman Kitesurf Camp, Bar al Hikman (Al Wusta, Oman) - seasonal tent camp ("Barefoot Camp") of the
// kite school Watersport Oman on the Bar al Hikman lagoons: 4x4 m Bedouin glamping tents with a double bed at
// the water, restaurant tent, chill-out areas, shower and toilet trailer, three meals a day. Windy season
// May to September; some camp blocks run at the Shrimpies wave spot or a "hidden lagoon" further south.
//
// Data path (checked 2026-10-12): GoDaddy Website Builder site, server-rendered:
//   slots    /camps - "Price list" menu widget, section "Kitesurf Camps - Bar Al Hikman- Shrimpies- Hidden
//            lagoon": "Bedouin Tent (4x4m) per night 1 person" 110 omr, "... 2 persons" 140 omr ("Includes 3
//            Meals, Snacks, Softdrinks, Water"). No season dates with a year, no inventory.
//   content  /camps (camp, tents, spots, photos), /prices (lessons, rental, downwinders, transfer, self-camping),
//            /tours (camp schedule: "2025 Bar al Hikman Camp Agenda", six blocks 28.3-5.4 ... 5.9-21.9; kept in
//            sourceText only, no 2026 agenda is published).
// The menu widget marks every cell with data-aid="MENU_SECTION<n>_ITEM<m>_TITLE|PRICE|DESC" and
//   "MENU_SECTION_TITLE_<n>" / "MENU_SECTION_DESCRIPTION_<n>"; parseGdMenu reads those attributes.
// Images: GoDaddy img1.wsimg.com URLs carry resize/crop operations after "/:/"; stripping them gives the
//   original upload (lazy images keep the URL in data-srclazy / data-srcsetlazy).
// No booking engine: "Book now" goes to the contact form / WhatsApp -> availability 'on_request'.
// robots.txt (2026-10-12): "User-agent: *" without rules (everything allowed), sitemap.
// Liveness evidence (rule 5b relaxed, Aaron 2026-10-12): sitemap.website.xml shows lastmod 2026-08-04 for every
//   page (the last publish of the site); the 2025 camp agenda ran to 21 September 2025; the home page says
//   "Kite Camp Season is just around the corner ... Book Your Camp NOW". Masira Island Resort's own site
//   names Watersport Oman (masirah@watersport-oman.com) as the island's kite operator. No 2026-dated agenda,
//   post or review found (no social media read).
// Requests per run: content 3, slots 1 (/camps memoised for 10 minutes, so a full run makes 3).
// Parsed: 2 slots = tent occupancy (1 or 2 persons), OMR per tent per night, all meals included, no dates.
// Known limits: year-less "Windy Season May till September"; the camp moves between Bar al Hikman, Shrimpies and
//   the hidden lagoon by block (spot = Bar al Hikman, the main location); one child up to 8 sleeps free.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, parse, parseAmount } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://watersport-oman.com';
export const WSO_CAMPS_URL = `${SITE}/camps`;
export const WSO_PRICES_URL = `${SITE}/prices`;
export const WSO_TOURS_URL = `${SITE}/tours`;
const CONTACT_URL = `${SITE}/contact`;
export const WSO_UNIT = 'Bedouin tent (4x4 m), full board';

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
const txt = (s: string | undefined | null): string => clean(s ?? '').replace(/[–—]/g, '-');

/** Visible text blocks (GoDaddy widgets put each text in its own <p>/<h*>/<div>). */
export function wsoLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  const out: string[] = [];
  for (const part of root.innerHTML.split(/<\/?(?:p|li|h\d|div|br|section)\b[^>]*>/i)) {
    const t = txt(part.replace(/<[^>]+>/g, ' '));
    if (t && out[out.length - 1] !== t) out.push(t);
  }
  return out;
}

export interface GdMenuItem { title: string; price: string; desc: string }
export interface GdMenuSection { title: string; description: string; items: GdMenuItem[] }

/** GoDaddy "menu / price list" widget -> sections with items (title, price text, description). */
export function parseGdMenu(html: string): GdMenuSection[] {
  const root = parse(html);
  const byAid = new Map<string, string>();
  for (const el of root.querySelectorAll('[data-aid]')) {
    const aid = el.getAttribute('data-aid') ?? '';
    if (/^MENU_SECTION/.test(aid) && !byAid.has(aid)) byAid.set(aid, txt(el.text));
  }
  const out: GdMenuSection[] = [];
  for (let n = 0; byAid.has(`MENU_SECTION_TITLE_${n}`); n++) {
    const items: GdMenuItem[] = [];
    for (let m = 0; byAid.has(`MENU_SECTION${n}_ITEM${m}_TITLE`); m++) {
      items.push({
        title: byAid.get(`MENU_SECTION${n}_ITEM${m}_TITLE`) ?? '',
        price: byAid.get(`MENU_SECTION${n}_ITEM${m}_PRICE`) ?? '',
        desc: byAid.get(`MENU_SECTION${n}_ITEM${m}_DESC`) ?? '',
      });
    }
    out.push({ title: byAid.get(`MENU_SECTION_TITLE_${n}`) ?? '', description: byAid.get(`MENU_SECTION_DESCRIPTION_${n}`) ?? '', items });
  }
  return out;
}

/** Original GoDaddy uploads of the page's content photos (no logo / favicon / page graphic), in page order. */
export function wsoImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/(?:https:)?\/\/img1\.wsimg\.com\/isteam\/ip\/([0-9a-f-]+)\/([^"\s),\\]+)/g)) {
    const file = m[2].split('/:/')[0];
    if (/favicon|_Final_Blue|Home%20Page|logo|^static\//i.test(file) || !/\.(jpe?g|png|webp)$/i.test(file)) continue;
    if (/^rs%3D/i.test(file)) continue; // re-uploaded resize artefact, no original name
    const u = `https://img1.wsimg.com/isteam/ip/${m[1]}/${file}`;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

// --- pure parsers -----------------------------------------------------------------------------
export interface WsoTent { persons: number; price: number; title: string; note: string }

/** The camp section of the price list: per-night Bedouin tent prices by persons. */
export function parseWsoTents(sections: GdMenuSection[]): WsoTent[] {
  const camp = sections.find(s => /Kitesurf Camps/i.test(s.title));
  if (!camp) return [];
  const out: WsoTent[] = [];
  for (const it of camp.items) {
    const m = it.title.match(/Bedouin Tent.*per night\s*(\d)\s*persons?/i);
    const price = /omr/i.test(it.price) ? parseAmount(it.price) : null;
    if (m && price) out.push({ persons: Number(m[1]), price, title: it.title, note: it.desc });
  }
  return out;
}

export function buildWsoSlots(tents: WsoTent[]): Slot[] {
  return tents.map(t => ({
    key: `bedouin-tent-${t.persons}p`,
    startDate: null,
    endDate: null,
    unit: WSO_UNIT,
    price: t.price,
    currency: 'OMR',
    priceUnit: 'per_night',
    priceBasis: 'room',
    occupancy: t.persons,
    availability: 'on_request',
    availabilityText: null,
    spotsLeft: null,
  }));
}

/** "2025 Bar al Hikman Camp Agenda" block on /tours: heading + the block lines ("Bar al Hikman 28.3-5.4"). */
export function parseWsoAgenda(html: string): { heading: string | null; blocks: string[] } {
  const lines = wsoLines(html);
  const i = lines.findIndex(l => /Camp Agenda/i.test(l));
  if (i < 0) return { heading: null, blocks: [] };
  const blocks: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (/^Special rates/i.test(l)) continue;
    if (!/\d{1,2}\.\d{1,2}\s*-\s*\d{1,2}\.\d{1,2}/.test(l)) break;
    blocks.push(l);
  }
  return { heading: lines[i], blocks };
}

const menuLine = (it: GdMenuItem): string => `${it.title}: ${it.price.replace(/\bomr\b/i, 'OMR')}${it.desc ? ` (${it.desc})` : ''}`;

export interface WsoPages { camps: string; prices: string; tours: string }

export function parseWatersportOmanCampContent(p: WsoPages): OfferContent {
  const campLines = wsoLines(p.camps);
  const campMenu = parseGdMenu(p.camps);
  const priceMenu = parseGdMenu(p.prices);
  const tents = parseWsoTents(campMenu);
  const agenda = parseWsoAgenda(p.tours);
  const campSection = campMenu.find(s => /Kitesurf Camps/i.test(s.title));
  const find = (re: RegExp): string | null => campLines.find(l => re.test(l)) ?? null;
  const mainCamp = find(/^Beyond the luxury glamping tents/i);
  const meals = find(/^Our chefs prepare three fresh meals/i);
  const tent = find(/^Step out of your tent/i);
  const barAlHikman = find(/^We bring you to Bar al Hikman/i);
  const shrimpies = find(/^Introducing Shrimpies/i);
  const hidden = find(/^The hidden lagoon, a big flatwater lagoon/i);
  const season = find(/^Windy Season/i);
  const learn = find(/^Learn from zero at our camp/i);
  const drive = find(/^Bar al Hikman is a \d+ hour drive/i);
  const t1 = tents.find(t => t.persons === 1);
  const t2 = tents.find(t => t.persons === 2);

  const optional: string[] = [];
  for (const s of priceMenu) {
    if (/^Kitesurf/i.test(s.title) && !/Camps/i.test(s.title)) {
      optional.push(`${s.title}: ${s.items.map(it => `${it.title} ${it.price.replace(/\bomr\b/i, 'OMR')}`).join(' / ')}`);
    }
  }
  for (const it of campSection?.items ?? []) if (!/Bedouin Tent/i.test(it.title)) optional.push(menuLine(it));
  const down = campMenu.find(s => /Down ?Winders/i.test(s.title));
  if (down) optional.push(`Downwinders (${down.description}): ${down.items.map(it => `${it.title} ${it.price.replace(/\bomr\b/i, 'OMR')}`).join(' / ')}`);

  const room: ContentRoom = {
    name: 'Bedouin tent (4x4 m)',
    description: tent ? 'Glamping Bedouin tent of 4 x 4 m at the water with carpets, soft lighting and a double bed.' : null,
    features: [
      ...tents.map(t => `${t.persons} person${t.persons > 1 ? 's' : ''}: OMR ${t.price} per night, all meals included`),
      ...(campSection && /1 child up to 8 years for free/i.test(campSection.description) ? ['Fits 1 child up to 8 years for free'] : []),
      'Shared shower and toilet trailer with fresh water',
    ],
  };

  const summary = [
    'Watersport Oman runs a seasonal kitesurf tent camp at Bar al Hikman, a flat-water lagoon spot on the Al Wusta coast about 5 hours by road from Muscat airport and 3 hours from Duqm airport.',
    'Guests sleep in 4 x 4 m Bedouin glamping tents with a double bed next to the water; the camp has a restaurant tent, chill-out areas and a shower and toilet trailer, and the price includes three meals a day, snacks and soft drinks.',
    t1 && t2 ? `A tent costs OMR ${t1.price} per night for one person and OMR ${t2.price} for two.` : '',
    'The camp runs in the windy season from May to September, some blocks also at the Shrimpies wave spot or a lagoon further south; lessons, rental and downwinders are booked separately.',
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'Watersport Oman Kitesurf Camp, Bar al Hikman',
    summary,
    continent: 'Asia',
    country: 'Oman',
    region: 'Al Wusta',
    spot: 'Bar al Hikman',
    itinerarySpots: [],
    durationDays: null,
    // /camps: "Learn from zero at our camp if you are a beginner ... For experienced kiteboarders ... freestyle to freeride"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: priceMenu.some(s => /^Kitesurf.*lessons/i.test(s.title)),
    equipmentRental: priceMenu.some(s => /^Kitesurf equipment rental/i.test(s.title)),
    beginnerFriendly: !!learn,
    includedServices: ['Three meals a day', 'Snacks', 'Soft drinks and water', 'Freshwater showers and toilets', 'Restaurant tent and chill-out areas'],
    optionalServices: optional,
    accommodation: 'Bedouin glamping tents in a seasonal beach camp',
    mealPlan: 'full_board',
    languages: [],
    rooms: [room],
    imageUrls: wsoImages(p.camps).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: WSO_CAMPS_URL,
    bookingUrl: CONTACT_URL,
    sourceText: [
      `camp: ${[mainCamp, meals, tent, barAlHikman, drive, shrimpies, hidden, season, learn].filter(Boolean).join(' | ')}`,
      `camp price list: ${campSection ? `${campSection.title} - ${campSection.description} - ${campSection.items.map(menuLine).join('; ')}` : '-'}`,
      `agenda: ${agenda.heading ?? '-'} ${agenda.blocks.join('; ')}`,
      `prices page: ${optional.join(' | ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const watersportOmanCampBarAlHikman: OfferAdapter = {
  key: 'watersport-oman-camp-bar-al-hikman',
  name: 'Watersport Oman Kitesurf Camp, Bar al Hikman',
  kind: 'accommodation',
  operator: {
    name: 'Watersport Oman',
    websiteUrl: SITE,
    rootDomain: 'watersport-oman.com',
    contactEmail: 'info@watersport-oman.com',
    whatsapp: '+96892694962',
    phone: '+968 9269 4962',
  },
  url: WSO_CAMPS_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'medium',
  async fetchContent() {
    const camps = await page(WSO_CAMPS_URL);
    const prices = await page(WSO_PRICES_URL);
    const tours = await page(WSO_TOURS_URL);
    return parseWatersportOmanCampContent({ camps, prices, tours });
  },
  async fetchSlots(ctx: FetchContext) {
    const tents = parseWsoTents(parseGdMenu(await page(WSO_CAMPS_URL)));
    if (tents.length < 2) throw new Error(`watersport-oman-camp: camp price list not found or changed (${tents.length} tent prices parsed)`);
    ctx.note('tent prices without season dates (site: "Windy Season May till September"); booking on request');
    return buildWsoSlots(tents);
  },
};
