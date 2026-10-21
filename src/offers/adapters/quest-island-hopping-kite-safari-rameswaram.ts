// ---------------------------------------------------------------------------
// Quest Adventure Sports Academy "Island Hopping" kite safari, Rameswaram (Tamil Nadu, India): a guided 5-day
// downwinder along the east coast of India, 15-30 km a day, ending at "a world class kite spot", with a trip leader,
// kite guide, safety gear, beach transfers, an all-day standby support vehicle, home-stay accommodation and meals.
// The tour starts and ends in Rameswaram at the operator's own boutique home stay Kathadi North. Quest is the kite /
// watersports school on Beach Road, Pirappanvalasai (Gulf of Mannar). Sibling products on the same page: "Spice Coast
// Expedition" (14 days, quest-spice-coast-expedition-kite-safari-tamil-nadu.ts, which imports this file's helpers) and
// "Flat Water Bay" (3 days, not built: short, a sibling only).
//
// Kind 'tour'. itinerarySpots: Rameswaram (the only place the page names for this route: start and end). The page calls
//   it "Island Hoping" (sic); the title spells it correctly.
//
// Data path (checked 2026-10-21): ONE Squarespace page, /kitesurfing-tours (server-rendered).
//   slots    each tour block is "<name>" / description / "<n> days ₹ <price>" / "Includes ..." -> one undated slot per
//            product, INR as printed (₹, Indian digit grouping "1,10,000" = 110000), priceUnit 'package', priceBasis
//            'person' (inferred: "per person" is not printed), availability 'on_request'. No dates and no season on the
//            page (the intro only says the wind season "extends to almost 10 months every year").
//   content  the same page (tour blocks, intro, gallery "image-slide-anchor" photos).
// Booking (checked 2026-10-21): the header "Book Now" goes to /booking, a Checkfront widget (quest-academy.checkfront.com,
//   robots.txt allows `*`). Its public /reserve/ page lists 8 categories (Sea Kayaking, SUP, Windsurfing, Sailing,
//   Scuba Diving, Snorkelling, Lifesaving, Retreats) and NO kitesurfing category, so the kite safaris cannot be booked
//   or checked there; the widget page also carries a CSRF token. Booking is by e-mail / WhatsApp / inquiry form ->
//   liveAvailability unset, instantBooking false.
// Liveness: (c)-less Squarespace site; the newest year on the site navigation is "Groms Quest 2025"; the Checkfront
//   assets are dated 2026-10-14 (the engine is active). Weak, flagged in the report.
// robots.txt www.quest-asia.com (2026-10-21): Squarespace default (named AI bots blocked, `*` allowed on this path).
// Requests per run: 1 (memoised; content and slots share it, also with the Spice Coast adapter in the same process).
// Photos: the page gallery (16 slides, kiting on the Gulf of Mannar and around Rameswaram, the Pamban bridge, the home
//   stay); checked by eye 2026-10-21. Dropped: a close-up portrait, a food photo, two duplicate uploads, slides
//   smaller than 500x330 and the partner logos. The photos are not tagged per tour, so both safaris share them.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse, parseAmount } from '../parse.js';
import type { FetchContext, ItinerarySpot, OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';

export const QUEST_SITE = 'https://www.quest-asia.com';
export const QUEST_TOURS_URL = `${QUEST_SITE}/kitesurfing-tours`;

export const QUEST_OPERATOR: OperatorRef = {
  name: 'Quest Adventure Sports Academy',
  websiteUrl: QUEST_SITE,
  rootDomain: 'quest-asia.com',
  contactEmail: 'booking@quest-asia.com', // page footer, 2026-10-21
  phone: '+91 86571 95551',
};

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
export function questPage(url = QUEST_TOURS_URL): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

export function questLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script,style,noscript,svg')) el.remove();
  return (root.querySelector('body') ?? root).structuredText
    .split('\n').map(s => collapse(s.replace(/[​ ]/g, ' ')).replace(/[–—]/g, '-')).filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------------------
export interface QuestTour {
  name: string;
  days: number;
  price: number | null;
  currency: string | null;
  priceText: string;
  description: string;
  includes: string[];
  startEnd: string | null;
}

/** Tour blocks: "<name>" / "<description>" / "5 days ₹ 50,000" / "Includes ... . Tour starts & ends in ...". */
export function parseQuestTours(html: string): QuestTour[] {
  const lines = questLines(html);
  const out: QuestTour[] = [];
  for (let i = 2; i < lines.length; i++) {
    const m = lines[i].match(/^(\d{1,2})\s+days?\s*(₹|INR|Rs\.?)\s*([\d,]+)/i);
    if (!m) continue;
    const inc = lines[i + 1] && /^Includes\b/i.test(lines[i + 1]) ? lines[i + 1] : '';
    // "Tour starts & ends in the city of Rameswaram from our boutique home stay Kathadi North" -> "Rameswaram"
    const startEnd = inc.match(/Tour starts\s*&?\s*(?:and\s*)?ends in (?:the (?:city|town) of\s+)?([^.]+?)(?:\s+from\b[^.]*)?(?:\.|$)/i)?.[1] ?? null;
    const includes = inc.replace(/^Includes\s+/i, '').replace(/\.\s*Tour starts.*$/i, '').replace(/\.$/, '')
      .split(/\s*,\s*|\s*&\s*(?=[a-z])/i).map(s => collapse(s)).filter(Boolean)
      .map(s => s.charAt(0).toUpperCase() + s.slice(1));
    out.push({
      name: lines[i - 2],
      days: Number(m[1]),
      price: parseAmount(m[3]),
      currency: 'INR',
      priceText: lines[i],
      description: lines[i - 1],
      includes,
      startEnd: startEnd ? collapse(startEnd) : null,
    });
  }
  return out;
}

export function findQuestTour(tours: QuestTour[], name: RegExp): QuestTour | null {
  return tours.find(t => name.test(t.name)) ?? null;
}

export function buildQuestSlots(t: QuestTour | null): Slot[] {
  if (!t || t.price === null) return [];
  return [{
    key: `${t.days}-days`,
    startDate: null,
    endDate: null,
    unit: `${t.name.replace(/Hoping/i, 'Hopping')}, ${t.days} days`,
    price: t.price,
    currency: t.currency,
    priceUnit: 'package',
    priceBasis: 'person', // inferred, see header
    occupancy: null,
    availability: 'on_request',
    availabilityText: `"${t.priceText}"; no dates published, booking by e-mail / WhatsApp (not in the online booking system)`,
    spotsLeft: null,
  }];
}

const SKIP_PHOTOS = [
  '1465909365973-VSP8L84H3EMQE3OKIZ83', // close-up portrait
  '1465909478398-5PB7DEWEE2UI7ZHD8RYW', // crab dinner
];
/** Gallery slides (".image-slide-anchor img") >= 500x330, de-duplicated by file name. */
export function questImages(html: string): string[] {
  const root = parse(html);
  const out: string[] = [];
  const names = new Set<string>();
  for (const img of root.querySelectorAll('.image-slide-anchor img, .promoted-gallery-wrapper img')) {
    const src = img.getAttribute('data-src') ?? '';
    if (!/^https:\/\/images\.squarespace-cdn\.com\/content\//.test(src)) continue;
    if (SKIP_PHOTOS.some(id => src.includes(id)) || /logo/i.test(src)) continue;
    const [w, h] = (img.getAttribute('data-image-dimensions') ?? '0x0').split('x').map(Number);
    if (!(w >= 500 && h >= 330)) continue;
    const name = decodeURIComponent(src.split('/').pop() ?? '').toLowerCase();
    if (names.has(name)) continue;
    names.add(name);
    out.push(src);
  }
  return out;
}

export const QUEST_RAMESWARAM: ItinerarySpot = { name: 'Rameswaram', country: 'India', region: 'Tamil Nadu', order: 1 };

export interface QuestListing {
  name: RegExp;
  title: string;
  skillLevels: string[];
  lead: (t: QuestTour) => string;
}

export function questContent(html: string, l: QuestListing): OfferContent {
  const tours = parseQuestTours(html);
  const t = findQuestTour(tours, l.name);
  if (!t) throw new Error(`quest: tour block ${l.name} not found on /kitesurfing-tours (layout changed?)`);
  const price = t.price !== null ? `INR ${t.price.toLocaleString('en-IN')}` : null;
  const stops = t.startEnd && /rameswaram/i.test(t.startEnd) ? [QUEST_RAMESWARAM] : [];
  const summary = [
    l.lead(t),
    'The guided safari is all inclusive: kite guide, trip leader, safety gear, beach transfers, a support vehicle on standby all day, accommodation, meals, snacks and drinking water; the group kites about 15-30 km downwind a day.',
    `${price ? `The price is ${price} (per person, inferred)` : 'The price is on request'}; no dates are published and booking is by e-mail or WhatsApp. Gear rental is not mentioned for the safaris.`,
  ].join(' ');
  return {
    kind: 'tour',
    title: l.title,
    summary,
    continent: 'Asia',
    country: 'India',
    region: 'Tamil Nadu',
    spot: 'Rameswaram',
    itinerarySpots: stops,
    durationDays: t.days,
    skillLevels: l.skillLevels,
    kiteLessons: false,
    equipmentRental: null, // not mentioned for the safaris
    beginnerFriendly: false,
    includedServices: t.includes,
    optionalServices: [],
    accommodation: /home-stays? & hotels|hotels/i.test(t.description) ? 'home-stays and hotels along the route' : 'home-stay (Kathadi North, Rameswaram)',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms: [],
    imageUrls: questImages(html),
    heroVideoUrl: null,
    sourceUrl: QUEST_TOURS_URL,
    bookingUrl: 'mailto:booking@quest-asia.com',
    sourceText: [
      ...questLines(html).filter(l2 => /kite safari|kitesurfing safari/i.test(l2)).slice(0, 2),
      `${t.name}: ${t.description}`,
      `${t.priceText}`,
      `Includes ${t.includes.join(', ')}${t.startEnd ? `. Tour starts & ends in ${t.startEnd}` : ''}`,
      `other tours on the page: ${tours.filter(x => x !== t).map(x => `${x.name} (${x.priceText})`).join('; ')}`,
    ].join('\n'),
  };
}

export async function fetchQuestSlots(name: RegExp, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const tours = parseQuestTours(await questPage());
  if (tours.length === 0) throw new Error('quest: no "<n> days ₹ <price>" tour blocks on /kitesurfing-tours (layout changed?)');
  const t = findQuestTour(tours, name);
  if (!t) throw new Error(`quest: tour ${name} no longer on /kitesurfing-tours (found: ${tours.map(x => x.name).join(', ')})`);
  const slots = buildQuestSlots(t);
  if (!slots.length) ctx?.note(`price not parsed: ${t.priceText}`);
  return slots;
}

// --- this listing --------------------------------------------------------------------------------
const ISLAND = /island\s+hop+ing/i;

export const QUEST_ISLAND_HOPPING: QuestListing = {
  name: ISLAND,
  title: 'Quest Island Hopping Kite Safari, Rameswaram',
  skillLevels: ['intermediate', 'advanced'],
  lead: t => `Quest Adventure Sports Academy, a kite and watersports school on the Gulf of Mannar in Tamil Nadu, runs this ${t.days}-day guided kite safari along the east coast of India: a picturesque downwinder that ends at a world-class kite spot, with evenings at a home stay${t.startEnd ? `; the tour starts and ends in ${t.startEnd} at the school's home stay Kathadi North` : ''}.`,
};

export const questIslandHoppingKiteSafariRameswaram: OfferAdapter = {
  key: 'quest-island-hopping-kite-safari-rameswaram',
  name: 'Quest Adventure Sports Academy - Island Hopping Kite Safari (Rameswaram)',
  kind: 'tour',
  operator: QUEST_OPERATOR,
  url: QUEST_TOURS_URL,
  slotMethod: 'price_table',
  instantBooking: false, // e-mail / WhatsApp; the Checkfront engine has no kite category
  fetchBudget: 2,
  confidence: 'medium', // undated price, basis inferred
  async fetchContent() {
    return questContent(await questPage(), QUEST_ISLAND_HOPPING);
  },
  fetchSlots: ctx => fetchQuestSlots(ISLAND, ctx),
};
