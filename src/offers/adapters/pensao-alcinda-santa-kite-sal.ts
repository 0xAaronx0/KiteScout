// ---------------------------------------------------------------------------
// Pensão Alcinda Bettencourt, Santa Maria (Sal, Cape Verde) - family guesthouse (double rooms + apartments) about
// 100 m from the beach, in the same building as the Santa Kite kitesurf / wingfoil / surf school (IKO, Core).
//
// Liveness (re-check 2026-10-12): Santa Kite's home page was edited 2025-11-29 together with a new price flyer
//   (media uploads 2025-11-29 "SANTA-KITE-FLYER-29-Nov-2025.pdf" + 2 flyer images, lesson/rental prices) for the
//   Dec-Apr wind season 2025/26; the Pensão home page was edited 2025-10-21 (WordPress REST `modified`); new photos
//   2025-10. Verdict LIVE (the 2025/26 season ended in 2026; 2026/27 not published yet). No 2026-dated review found.
// Data path (checked 2026-10-12): two WordPress installs under santakitecaboverde.com:
//   content  / (Santa Kite school: IKO instructors, Core gear, Kite Beach, Dec-Apr wind, transfer, rentals, the
//            "Accommodation on-site" block), /pensaoalcindabettencourt/ (guesthouse home), and the 3 room pages via
//            the public WP REST API /pensaoalcindabettencourt/wp-json/wp/v2/pages?slug=double-room,standard-apartment,
//            superior-apartment&_fields=link,modified,title,content (one request: room texts + "From N Euros" +
//            each page's `modified` date).
//   slots    the room pages' undated "From 34 / 43 / 46 Euros". GATE: used only when the room page was edited in the
//            last 15 months (an undated price on a page edited within the season cycle); the pages were last edited
//            2024-10-04, so on 2026-10-12 fetchSlots returns [] with a note ("price on request"). When fresh: one
//            undated slot per room type, EUR per unit per night (per night is inferred: the page prints only "From N
//            Euros"), 'on_request' (each page asks to "Request ... Availability and Pricing" by form).
// robots.txt (2026-10-12): santakitecaboverde.com/robots.txt is 404 (allow all).
// Requests per run: content 3, slots 1.
// Known limits: no booking engine (forms + WhatsApp); maps embeds are search queries, not coordinates; the Santa Kite
//   page prints the owner's bank details (not read; redacted in the test fixture).
// ---------------------------------------------------------------------------
import { fetchJson, fetchText } from '../http.js';
import { clean, collapse, imageCandidates, parse, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://santakitecaboverde.com';
export const PASK_KITE_URL = `${SITE}/`;
export const PASK_PENSAO_URL = `${SITE}/pensaoalcindabettencourt/`;
export const PASK_ROOMS_API = `${SITE}/pensaoalcindabettencourt/wp-json/wp/v2/pages?slug=double-room,standard-apartment,superior-apartment&_fields=link,modified,title,content`;
const FRESH_MONTHS = 15;
const ORDER = ['double-room', 'standard-apartment', 'superior-apartment'];

export interface PaskWpPage { link: string; modified: string; title: { rendered: string }; content: { rendered: string } }
export interface PaskRoom {
  slug: string; name: string; price: number | null; modified: string; occupancyMin: number | null; occupancyMax: number | null;
  sizeM2: number | null; text: string | null; features: string[]; link: string;
}

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function lines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, form')) el.remove();
  const out: string[] = [];
  for (const e of root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, span, div').filter(e => !e.querySelector('h1, h2, h3, h4, h5, h6, p, li, div'))) {
    const t = collapse(e.text);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

// --- pure parsers -----------------------------------------------------------------------------
/** The REST answer for the 3 room pages -> rooms in site order (double room, standard, superior apartment). */
export function parsePaskRooms(pages: PaskWpPage[]): PaskRoom[] {
  const out: PaskRoom[] = pages.map(p => {
    const ls = lines(p.content.rendered);
    const slug = p.link.replace(/\/$/, '').split('/').pop() ?? keyPart(p.title.rendered);
    const occ = ls.find(t => /^Occupancy:/i.test(t))?.replace(/^Occupancy:\s*/i, '') ?? '';
    const nums = (occ.match(/\d+/g) ?? []).map(Number);
    const size = ls.join(' ').match(/(\d+)\s*m²/);
    const view = ls.find(t => /^View:/i.test(t))?.replace(/^View:\s*/i, '') ?? null;
    const beds = ls.find(t => /double (comfortable )?bed|Bedroom 1:/i.test(t)) ?? null;
    const kitchen = ls.some(t => /In your private kitchenette/i.test(t)) ? 'Kitchenette' : ls.some(t => /In your private kitchen:/i.test(t)) ? 'Kitchen' : null;
    return {
      slug,
      name: clean(p.title.rendered),
      price: parseAmount(ls.find(t => /^From \d+ Euros?$/i.test(t)) ?? '') ?? null,
      modified: p.modified,
      occupancyMin: nums.length ? Math.min(...nums) : null,
      occupancyMax: nums.length ? Math.max(...nums) : null,
      sizeM2: size ? Number(size[1]) : null,
      text: ls.find(t => /^This apartment (consists|features)/i.test(t)) ?? null,
      features: [
        ...(size ? [`${size[1]} m²`] : []),
        ...(beds ? [beds.replace(/^Size: \d+ m²\s*/i, '').replace(/^Apartment Size: \d+ m²\s*/i, '')] : []),
        `Occupancy: ${occ || 'n/a'}`,
        ...(view ? [`View: ${view}`] : []),
        ...(kitchen ? [kitchen] : []),
        'Private bathroom', 'Fan', 'Mosquito net', 'Towels and bed linen',
        ...(ls.some(t => /^Breakfast not included$/i.test(t)) ? ['Breakfast not included'] : []),
      ],
      link: p.link,
    };
  });
  const rank = (slug: string) => (ORDER.includes(slug) ? ORDER.indexOf(slug) : ORDER.length);
  return out.sort((a, b) => rank(a.slug) - rank(b.slug));
}

/** An undated "From" price counts while its page was edited within the last FRESH_MONTHS months. */
export function paskFresh(modified: string, today: string): boolean {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - FRESH_MONTHS);
  return modified.slice(0, 10) >= d.toISOString().slice(0, 10);
}

export function buildPaskSlots(rooms: PaskRoom[], today: string): Slot[] {
  return rooms.filter(r => r.price !== null && paskFresh(r.modified, today)).map(r => ({
    key: keyPart(r.slug),
    startDate: null,
    endDate: null,
    unit: r.name,
    price: r.price,
    currency: 'EUR',
    priceUnit: 'per_night',
    priceBasis: 'room',
    occupancy: r.occupancyMin,
    availability: 'on_request',
    availabilityText: 'Request for availability and pricing (form)',
    spotsLeft: null,
  }));
}

export interface PaskPages { kite: string; pensao: string; rooms: PaskWpPage[] }

export function parsePensaoContent(p: PaskPages, today = todayIso()): OfferContent {
  const kite = lines(p.kite);
  const pensao = lines(p.pensao);
  const rooms = parsePaskRooms(p.rooms);
  const fresh = rooms.some(r => r.price !== null && paskFresh(r.modified, today));
  const welcome = kite.find(t => /^Sal Island experience and knowledge/i.test(t)) ?? null;
  const onsite = kite.find(t => /same building as Pensão Alcinda Bettencourt/i.test(t)) ?? null;
  const wind = kite.find(t => /almost guaranteed\s+[A-Z][a-z]+\s*[–-]\s*[A-Z][a-z]+/i.test(t)) ?? null;
  const windMonths = wind?.match(/guaranteed\s+([A-Z][a-z]+)\s*[–-]\s*([A-Z][a-z]+)/) ?? null;
  const transfer = kite.find(t => /Transfer to and from the kite spot/i.test(t)) ?? null;
  const pensaoIntro = pensao.find(t => /^Nestled in the tranquil Tankinho/i.test(t)) ?? null;
  const location = pensao.find(t => /^Our prime location near/i.test(t)) ?? null;
  const iko = /IKO certified instructors|IKO international/i.test(kite.join(' '));
  const core = /CORE Kiteboarding|Core Materials|brand new gear Core/i.test(kite.join(' '));
  const minFrom = rooms.filter(r => r.price !== null).map(r => r.price!).sort((a, b) => a - b)[0] ?? null;

  const contentRooms: ContentRoom[] = rooms.map(r => ({ name: r.name, description: r.text, features: r.features }));

  // guesthouse + room photos (24 max), then up to 6 school photos
  const seen = new Set<string>();
  const uniq = (list: string[]) => list.filter(u => { const k = u.replace(/^.*\//, ''); if (seen.has(k)) return false; seen.add(k); return true; });
  const photo = (u: string) => /\/uploads\/20\d\d\/\d\d\/.*\.jpe?g$/i.test(u);
  const stayImgs = uniq([
    ...imageCandidates(p.pensao, PASK_PENSAO_URL, null, 60).filter(photo),
    ...p.rooms.flatMap(r => imageCandidates(r.content.rendered, r.link, null, 30).filter(photo)),
  ]).slice(0, 24);
  const kiteImgs = uniq(imageCandidates(p.kite, PASK_KITE_URL, null, 80)
    .filter(u => photo(u) && !/flyer|KITE-LESSONS|KITE-RENTAL|WING-|flags|map-spots|ricardo|blue-eye|\/sal\.jpg/i.test(u))).slice(0, 6);
  const imageUrls = [...stayImgs, ...kiteImgs];
  const lastEdit = rooms.map(r => r.modified.slice(0, 4)).sort().reverse()[0] ?? null;

  const summary = [
    `Pensão Alcinda Bettencourt is a family-run guesthouse in the Tanquinho area of Santa Maria on Sal, Cape Verde, about 100 m from the beach, in the same building as the Santa Kite kitesurf and wingfoil school.`,
    `It has ${rooms.length ? rooms.map(r => `${r.name.toLowerCase()}s${r.sizeM2 ? ` (${r.sizeM2} m²)` : ''}`).join(', ').replace(/, ([^,]*)$/, ' and $1') : 'double rooms and apartments'}, with sea-view balconies or a terrace and a kitchen in the apartments; breakfast is not included.`,
    `Santa Kite teaches kitesurfing, wingfoiling and surfing${iko ? ' with IKO-certified instructors' : ''}${core ? ' and Core equipment' : ''} at Kite Beach, rents gear and includes transfers from Santa Maria in its lesson packages${windMonths ? `; the wind season runs ${windMonths[1]} to ${windMonths[2]}` : ''}.`,
    fresh && minFrom
      ? `Rooms start from EUR ${minFrom} per night; availability and prices are confirmed on request.`
      : `The room pages show undated "from" prices last edited${lastEdit ? ` in ${lastEdit}` : ' long ago'}, so stays are priced on request.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Pensão Alcinda Bettencourt (Santa Kite)',
    summary,
    continent: 'Africa',
    country: 'Cape Verde',
    region: 'Sal',
    spot: 'Santa Maria, Sal',
    itinerarySpots: [],
    durationDays: null,
    // Santa Kite: "From beginners to advanced wave riding we have you covered" (2025-11)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /KITE LESSONS/i.test(kite.join(' ')),
    equipmentRental: /KITE RENTALS/i.test(kite.join(' ')),
    beginnerFriendly: true,
    includedServices: ['Private bathroom', 'Towels and bed linen', 'Kitchen or kitchenette (apartments)'],
    optionalServices: [
      'Kitesurf lessons (Santa Kite, IKO; transfer to Kite Beach included)',
      'Kite, wingfoil and surf rental',
      'Wingfoil and surf lessons',
      'Wave kitesurfing coaching',
      'Downwinders',
      'Island tour by 4x4',
    ],
    accommodation: 'family guesthouse with double rooms and apartments',
    mealPlan: null, // "Breakfast not included"; apartments self-catering
    languages: ['en', 'de'],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: PASK_PENSAO_URL,
    bookingUrl: `${PASK_PENSAO_URL}#book`,
    sourceText: [
      `pensao: ${pensaoIntro ?? ''}`,
      `location: ${location ?? ''}`,
      ...rooms.map(r => `room ${r.name}: from ${r.price ?? '-'} EUR (page edited ${r.modified.slice(0, 10)}); ${r.features.join('; ')}${r.text ? ` | ${r.text}` : ''}`),
      `santa kite: ${welcome ?? ''}`,
      `on-site: ${onsite ?? ''}`,
      `wind: ${wind ?? ''}`,
      `transfer: ${transfer ?? ''}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const pensaoAlcindaSantaKiteSal: OfferAdapter = {
  key: 'pensao-alcinda-santa-kite-sal',
  name: 'Pensão Alcinda Bettencourt (Santa Kite) Sal',
  kind: 'accommodation',
  operator: {
    name: 'Pensão Alcinda Bettencourt / Santa Kite Cabo Verde',
    websiteUrl: PASK_PENSAO_URL,
    rootDomain: 'santakitecaboverde.com',
    contactEmail: 'pensaoalcindabettencourt@gmail.com',
    whatsapp: '+2389761373',
    phone: '+2389761373',
  },
  url: PASK_PENSAO_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'low',
  async fetchContent() {
    const kite = await fetchText(PASK_KITE_URL, { accept: 'text/html' });
    const pensao = await fetchText(PASK_PENSAO_URL, { accept: 'text/html' });
    const rooms = await fetchJson<PaskWpPage[]>(PASK_ROOMS_API);
    return parsePensaoContent({ kite, pensao, rooms });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    const rooms = parsePaskRooms(await fetchJson<PaskWpPage[]>(PASK_ROOMS_API));
    if (rooms.length === 0) throw new Error('pensao-alcinda: room pages missing from the WP REST answer');
    const slots = buildPaskSlots(rooms, todayIso());
    if (slots.length === 0) {
      ctx.note(`room prices are undated and the room pages were last edited ${rooms.map(r => r.modified.slice(0, 10)).sort().reverse()[0]}: offer stays "price on request"`);
    }
    return slots;
  },
};
