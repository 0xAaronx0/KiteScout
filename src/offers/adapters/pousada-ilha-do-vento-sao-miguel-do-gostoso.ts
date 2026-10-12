// ---------------------------------------------------------------------------
// Pousada Ilha do Vento, São Miguel do Gostoso (Rio Grande do Norte, Brazil) - 12-apartment pousada with
// Greek-inspired architecture, 5 minutes on foot from Praia de Santo Cristo; it sits between the Dr Wind club, the
// Escola Gostoso kite school (5 minutes on foot) and the Kauli Seadi club (10 minutes).
//
// Inclusion (rule 5): kite link = /kitesurf-windsurf-wingfoil/ ("Estamos localizados estrategicamente entre o clube
//   do Dr Wind, a Escola Gostoso (5 minutos a pé) e o clube Kauli Seadi") + the site's JSON-LD ("Kite Surfer Room",
//   "Kite surfing nearby"). Current operation: home dateModified 2026-06-07, blog posts of 2026/08, a working
//   booking engine (HSystem, not read).
//
// Data path (checked 2026-10-12): ilhadovento.com.br (WordPress, CozyStay theme, Portuguese):
//   content  / (intro, services, address, Google Maps place link with the pin), /stay/ (the four room types as
//            CozyStay cards: name, subtitle, "A partir de R$..", size, guests, beds, photos), /kitesurf-windsurf-
//            wingfoil/ (spot, clubs and school nearby, wind season and strength).
//   slots    published "A partir de R$.." prices of the /stay/ room cards, one undated slot per room type,
//            per room per night (the site's own JSON-LD gives "unitText":"per night" and "Prices vary by season").
//            NOT used: the HSystem booking engine (hbook.hsystem.com.br/booking?companyId=68ecf6c0633349834df125cc);
//            its /Booking path is disallowed by robots.txt on the engine host.
// robots.txt (2026-10-12): "User-agent: * / Crawl-Delay: 20", nothing disallowed. http.ts does not read
//   Crawl-delay, so this adapter waits 20 s between its own live requests (local helper `page`, no wait on fixture
//   replay).
// Requests per run: content 3 (~40 s with the crawl delay), slots 0 extra (1 when run alone).
// Known limits: "from" prices without dates or season limits (availability unknown); the JSON-LD price ranges
//   (family R$390-500, honeymoon R$400-550, kite surfer R$300-450 per night) do not match the room cards exactly
//   and are kept in sourceText only; breakfast is not stated as included (breakfast in the room is an optional
//   service).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://ilhadovento.com.br';
export const IDV_PAGES = { home: `${SITE}/`, stay: `${SITE}/stay/`, kite: `${SITE}/kitesurf-windsurf-wingfoil/` } as const;
const CRAWL_DELAY_MS = 20_000; // ilhadovento.com.br robots.txt "Crawl-Delay: 20"

const memo = new Map<string, { at: number; p: Promise<string> }>();
let lastLive = 0;
let queue: Promise<unknown> = Promise.resolve();
/** Memoised fetch, serialised with the robots.txt crawl delay (skipped on fixture replay). */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const run = async () => {
    if (!process.env.OFFERS_FIXTURE_DIR && lastLive) {
      const wait = lastLive + CRAWL_DELAY_MS - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
    try { return await fetchText(url, { accept: 'text/html' }); } finally { lastLive = Date.now(); }
  };
  const p = queue.catch(() => undefined).then(run);
  queue = p;
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Block-level visible lines (scripts, styles, navigation and forms dropped), de-duplicated. */
function blockLines(html: string): string[] {
  const seen = new Set<string>();
  return html
    .replace(/<(script|style|noscript|select|svg|header|footer|nav|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|button)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(l => l && !/^<script/.test(l) && !seen.has(l) && (seen.add(l), true));
}

/** JSON-LD blocks; this site writes `type=application/ld+json` without quotes (parse.ts jsonLd() misses them). */
export function idvJsonLd(html: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { out.push(JSON.parse(m[1]) as Record<string, unknown>); } catch { /* skip */ }
  }
  return out;
}

export interface IdvRoom { name: string; subtitle: string; fromPrice: number | null; priceText: string; facts: string[]; excerpt: string; photos: string[] }

/** /stay/ CozyStay room cards (.cs-room-item). */
export function parseIdvRooms(stayHtml: string): IdvRoom[] {
  return parse(stayHtml).querySelectorAll('.cs-room-item').map(card => {
    const priceText = collapse(card.querySelector('.overlay-label-text')?.text ?? '');
    const photos: string[] = [];
    for (const img of card.querySelectorAll('img')) {
      // srcset: the entry without a -WxH suffix is the original upload
      const set = (img.getAttribute('srcset') ?? '').split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
      const orig = set.find(u => !/-\d+x\d+\.(?:jpe?g|webp|png)$/i.test(u)) ?? (img.getAttribute('src') ?? '').replace(/\?.*$/, '');
      if (orig && !photos.includes(orig)) photos.push(orig);
    }
    return {
      name: clean(card.querySelector('.item-title')?.text ?? ''),
      subtitle: clean(card.querySelector('.item-subtitle')?.text ?? ''),
      fromPrice: /R\$/.test(priceText) ? parseAmount(priceText) : null,
      priceText,
      facts: card.querySelectorAll('.csrbi-text').map(e => clean(e.text)).filter(Boolean),
      excerpt: clean(card.querySelector('.item-excerpt')?.text ?? ''),
      photos,
    };
  }).filter(r => r.name);
}

/** Google Maps place link of the home page (!3d<lat>!4d<lng>). */
export function idvCoords(homeHtml: string): { lat: number; lng: number } | null {
  const m = homeHtml.match(/google\.com\/maps\/place\/Pousada\+Ilha\+do\+Vento\/[^"'\s>]*?!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
}

const ROOM_EN: Array<[RegExp, string]> = [
  [/Suite Luxo/i, 'Honeymoon suite with a bathtub, Greek-style decor and garden view'],
  [/Suite Master/i, 'Suite with a private terrace'],
  [/Suite Jardim/i, 'Garden suite with a private veranda and hammock; queen bed plus bunk or single bed'],
  [/Master Fam/i, 'Family apartment with living room and suite, king bed and two single beds, for up to 5 people'],
];

function factsEn(facts: string[]): string[] {
  return facts.map(f => f
    .replace(/^(\d+) (?:Hospedes|Guests)$/i, 'Up to $1 guests')
    .replace(/^1 (?:Banheiro|Bathrooms?)$/i, 'Private bathroom')
    .replace(/^Ar condicionado$/i, 'Air conditioning')
    .replace(/^WIFI$/i, 'Wi-Fi')
    .replace(/(\d+) m2$/, '$1 m2'))
    .filter(f => !/Cama|Queen|King|beliche|solteiro/i.test(f));
}

export interface IdvPages { home: string; stay: string; kite: string }

export function parseIdvContent(p: IdvPages): OfferContent {
  const home = blockLines(p.home);
  const kite = blockLines(p.kite);
  const rooms = parseIdvRooms(p.stay);
  const ld = idvJsonLd(p.home);
  const lodging = ld.find(o => o['@type'] === 'LodgingBusiness');
  const faq = ld.find(o => o['@type'] === 'FAQPage');
  const nUnits = blockLines(p.stay).join(' ').match(/total de (\d+) apartamentos/)?.[1] ?? null;
  const kiteText = kite.join(' ');
  const clubs = kiteText.match(/entre o clube do Dr Wind\s*, a Escola Gostoso \(5 minutos a pé\) e o clube Kauli Seadi \(10 minutos a pé\)/) ? true : /Escola Gostoso/.test(kiteText);
  const season = kiteText.match(/meses melhores[^.]*?são de ([a-zçã]+) a ([a-zçã]+)/i);
  const PT: Record<string, string> = { setembro: 'September', março: 'March', marco: 'March', agosto: 'August', outubro: 'October', fevereiro: 'February', abril: 'April' };

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: ROOM_EN.find(([re]) => re.test(r.name))?.[1] ?? null,
    features: factsEn(r.facts),
  }));

  const imgs: string[] = [];
  for (const r of rooms) for (const u of r.photos) if (!imgs.includes(u)) imgs.push(u);
  for (const m of p.home.matchAll(/https:\/\/ilhadovento\.com\.br\/wp-content\/uploads\/[^"'\s)?,]+\.(?:jpe?g|webp)/gi)) {
    const u = m[0];
    if (/-\d+x\d+\.(?:jpe?g|webp)$/i.test(u) || /logo|icon|og-image/i.test(u) || imgs.includes(u)) continue;
    imgs.push(u);
  }

  const summary = [
    `Pousada Ilha do Vento is a pousada with ${nUnits ?? 12} apartments in Greek-inspired architecture in São Miguel do Gostoso (Rio Grande do Norte, Brazil), 5 minutes on foot from Praia de Santo Cristo, with a pool, a heated hot tub in the garden and daily housekeeping.`,
    clubs ? 'It sits between the Dr Wind club, the Escola Gostoso kite school (5 minutes on foot) and the Kauli Seadi club (10 minutes), at the Ponta de Santo Cristo kite beach.' : null,
    season ? `The site gives ${PT[season[1].toLowerCase()] ?? season[1]} to ${PT[season[2].toLowerCase()] ?? season[2]} as the best wind months, with a thermal wind of 20 to 30 knots from late morning.` : null,
    `${rooms.length} room types, from a garden suite to a family apartment with living room, start at R$${Math.min(...rooms.map(r => r.fromPrice ?? Infinity))} per night as published on the site.`,
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'Pousada Ilha do Vento',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'São Miguel do Gostoso, Rio Grande do Norte',
    spot: 'São Miguel do Gostoso',
    // Google Maps place link on the home page (!3d / !4d, 2026-10-12)
    spotCoords: idvCoords(p.home),
    itinerarySpots: [],
    durationDays: null,
    // kite page: "As melhores condições do mundo para iniciantes e intermediarios"
    skillLevels: /iniciantes e intermediarios/i.test(kiteText) ? ['beginner', 'intermediate'] : [],
    kiteLessons: null, // lessons at Escola Gostoso next door (not run by the pousada)
    equipmentRental: null,
    beginnerFriendly: /iniciantes/i.test(kiteText) ? true : null,
    includedServices: ['Wi-Fi', 'Daily housekeeping', 'Pool and garden hot tub', 'Air conditioning'],
    optionalServices: ['Breakfast in the room', 'Airport transfer', 'Laundry', 'Massages', 'Honeymoon package', 'Kite, windsurf and wing foil lessons at Escola Gostoso, Dr Wind and Kauli Seadi clubs nearby'],
    accommodation: 'pousada suites and apartments',
    mealPlan: null,
    languages: ['pt', 'en'],
    rooms: contentRooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: IDV_PAGES.stay,
    bookingUrl: 'https://hbook.hsystem.com.br/booking?companyId=68ecf6c0633349834df125cc',
    sourceText: [
      `home: ${home.join(' ').slice(0, 4000)}`,
      `kite page: ${kiteText.replace(/\s*Discover More[\s\S]*$/, '')}`,
      `rooms: ${rooms.map(r => `${r.name} (${r.subtitle}): ${r.priceText}; ${r.facts.join(', ')}; ${r.excerpt}`).join(' | ')}`,
      `json-ld lodging: ${lodging ? JSON.stringify({ description: lodging.description, priceRange: lodging.priceRange, amenityFeature: lodging.amenityFeature }) : '-'}`,
      `json-ld faq: ${faq ? JSON.stringify(faq.mainEntity) : '-'}`,
      `json-ld rooms: ${JSON.stringify(ld.find(o => o['@type'] === 'ItemList')?.itemListElement ?? null)}`,
    ].join('\n'),
  };
}

/** One undated slot per room type: the published "A partir de R$.." price, per room per night. */
export function buildIdvSlots(rooms: IdvRoom[]): Slot[] {
  const key = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return rooms.filter(r => r.fromPrice !== null).map(r => ({
    key: key(r.name),
    startDate: null,
    endDate: null,
    unit: r.name,
    price: r.fromPrice,
    currency: 'BRL',
    priceUnit: 'per_night',
    priceBasis: 'room',
    occupancy: null,
    availability: 'unknown',
    availabilityText: `${r.priceText} (published room price; the site's JSON-LD: per night, prices vary by season)`,
    spotsLeft: null,
  } satisfies Slot));
}

// --- adapter ----------------------------------------------------------------------------------
export const pousadaIlhaDoVentoSaoMiguelDoGostoso: OfferAdapter = {
  key: 'pousada-ilha-do-vento-sao-miguel-do-gostoso',
  name: 'Pousada Ilha do Vento São Miguel do Gostoso',
  kind: 'accommodation',
  operator: {
    name: 'Pousada Ilha do Vento',
    websiteUrl: SITE,
    rootDomain: 'ilhadovento.com.br',
    contactEmail: 'ilhadovento@gmail.com',
    phone: '+5584994289909',
    whatsapp: '+5584994289909',
  },
  url: IDV_PAGES.stay,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'medium', // undated "from" prices; the booking engine (HSystem) is not read
  async fetchContent() {
    const home = await page(IDV_PAGES.home);
    const stay = await page(IDV_PAGES.stay);
    const kite = await page(IDV_PAGES.kite);
    return parseIdvContent({ home, stay, kite });
  },
  async fetchSlots(ctx) {
    const rooms = parseIdvRooms(await page(IDV_PAGES.stay));
    if (rooms.length === 0) throw new Error('ilha-do-vento: no room cards on /stay/ (layout changed?)');
    const slots = buildIdvSlots(rooms);
    if (slots.length < rooms.length) ctx.note(`${rooms.length - slots.length} room card(s) without a price`);
    return slots;
  },
};
