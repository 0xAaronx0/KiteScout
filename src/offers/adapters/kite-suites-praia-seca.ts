// ---------------------------------------------------------------------------
// Kite Suites (Hospedagem e Gastronomia), Praia Seca, Araruama (Rio de Janeiro, Brazil) - three suites with breakfast
// facing the Lagoa de Araruama, a lagoon-front restaurant, heated pool, and kite lessons with the partner school Wind
// Hunter Kite Center.
//
// Inclusion: Aaron's approval of 2026-10-26 (research .research/r3/brasil-recife-rio.md, Rio de Janeiro section,
//   "BORDERLINE": no prices, request only; built as price on request). Kite link (rule 5): the home and /kitesurf/
//   ("Aulas em parceria com a Wind Hunter Kite Center"), kite day use on /servicos/, a kite equipment shop, and two
//   suites named after the lagoon's kite spots Arubinha and Coroinha (spot names: our reading, the site does not say so).
//
// Data path (site rebuilt between 2026-11-08 and 2026-11-09, checked 2026-11-10): static HTML on the house's own
//   domain, Portuguese only, photos under /assets/.
//   content  / (intro, kite school, shop, footer address), /acomodacoes/ (one article.card per suite: "SUÍTE", h2 name,
//            facts and amenities; gallery sections "Arubinha e Coroinha" - the two suites share one set, the page says
//            the photos show both - and "Suíte Lagoa"), /servicos/ (article.service-card: photo, h3, text; the page
//            says only the pool, restaurant, yoga, canoe and kite photos are real, the rest illustrative).
//   slots    one undated line "Suítes a partir de R$ 418,00" ("consulte ... tarifas e disponibilidade" next to it);
//            every button opens WhatsApp. fetchSlots re-reads /acomodacoes/ (memoised) and returns one undated slot
//            "from BRL 418 / night per room" for all suites (Aaron 2026-11-10: "dann bitte pro Nacht zeigen"; the page
//            names no unit, per night is our reading - Praia Seca pousadas list R$ 170-290 a night, a week at R$ 418
//            would be R$ 60 a night). Other amounts are noted, not priced.
//   Not used: /gastronomia/, /experiencias/ (tour ideas), /contato/, /kitesurf/ (lessons, Duotone shop, Windguru
//            embed: the home says the same), Instagram, YouTube.
// robots.txt (2026-11-10): allows everything. Until 2026-11-08 the site was a Locaweb "Criador de Sites" build
//   (cs-section blocks, photos on yata-apix-*.s3-object.locaweb.com.br). TLS: the chain ends in ISRG Root YR, which
//   Node does not bundle (the cron passes certs/isrg-root-yr.pem via NODE_EXTRA_CA_CERTS, test/lib/root-yr-ca.test.ts);
//   on 2026-11-10 the server also sends Root YR cross-signed by ISRG Root X1, so a plain Node fetch verified and the
//   fixtures were recorded with OFFERS_RECORD_DIR.
// Requests per run: content 3, slots 1 (0 extra when content ran in the same process).
// Flags: liveAvailability unset, instantBooking false (WhatsApp request only).
// Known limits: no coordinates or map on the site (the geocoder places "Praia Seca, Araruama"; the street address
//   Av. Praia dos Nobres 741 is in sourceText); the Suite Lagoa card gives no size, beds or capacity any more
//   ("consulte a equipe sobre a configuração"); lesson prices and levels are not published.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, findPrices, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://kitesuites.com.br';
export const KS_HOME_URL = `${SITE}/`;
export const KS_ROOMS_URL = `${SITE}/acomodacoes/`;
export const KS_SERVICES_URL = `${SITE}/servicos/`;
const WHATSAPP = '+5522999886066';

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

/** visible text lines (head, scripts, styles and the site chrome dropped) */
function lines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('head, script, style, noscript, svg, nav, header, footer')) el.remove();
  return root.structuredText.split('\n').map(l => collapse(l)).filter(l => l && !/^<!DOCTYPE/i.test(l));
}
const textOf = (html: string): string => lines(html).join(' ');
const plain = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** a photo of the house under /assets/ (logos and icons out) */
function imgUrl(img: { getAttribute(n: string): string | undefined }): string | null {
  const raw = img.getAttribute('data-src') || img.getAttribute('src') || '';
  let u: URL;
  try { u = new URL(raw, KS_HOME_URL); } catch { return null; }
  return u.hostname === 'kitesuites.com.br' && /^\/assets\/[\w.-]+\.(?:jpe?g|webp)$/i.test(u.pathname) && !/logo|icon/i.test(u.pathname) ? u.href : null;
}
const imagesIn = (el: { querySelectorAll(s: string): Array<{ getAttribute(n: string): string | undefined }> }) =>
  [...new Set(el.querySelectorAll('img').map(imgUrl).filter((u): u is string => !!u))];

// --- pure parsers -----------------------------------------------------------------------------
export interface KsRoom {
  name: string;
  text: string;
  sizeM2: number | null;
  maxGuests: number | null;
  beds: string | null;
  amenities: string[];
  images: string[];
}

const AMENITY_EN: Array<[RegExp, string]> = [
  [/caf[ée] da manh[ãa]/i, 'Breakfast'], [/frigobar/i, 'Minibar'], [/ar-condicionado/i, 'Air conditioning'],
  [/\btv\b/i, 'TV'], [/wi-?fi/i, 'Wi-Fi'],
];

/**
 * /acomodacoes/: one article.card per suite ("SUÍTE", h2 short name, facts paragraph, amenities line). The name keeps
 * the stored "Suite <name>" (room prices and photos are carried over by name). Photos come from the gallery sections
 * whose heading names the suite: "Arubinha e Coroinha" goes to both, as the page says.
 */
export function parseKsRooms(roomsHtml: string): KsRoom[] {
  const root = parse(roomsHtml);
  const galleries = root.querySelectorAll('section[id^="galeria"]').map(sec => ({ title: plain(collapse(sec.querySelector('h2')?.text ?? '')), images: imagesIn(sec) }));
  const out: KsRoom[] = [];
  for (const card of root.querySelectorAll('article.card')) {
    if (plain(collapse(card.querySelector('.number')?.text ?? '')) !== 'suite') continue;
    const short = collapse(card.querySelector('h2')?.text ?? '');
    if (!short) continue;
    const text = card.querySelectorAll('p').map(p => collapse(p.text)).filter(Boolean).join(' ');
    const word = new RegExp(`\\b${plain(short)}\\b`);
    out.push({
      name: `Suite ${short}`,
      text,
      sizeM2: Number(text.match(/(\d+)\s?m²/)?.[1]) || null,
      maxGuests: Number(text.match(/até\s+(\d+)\s+pessoas/i)?.[1]) || null,
      beds: /cama queen ou duas de solteiro, com possibilidade de mais uma cama de solteiro/i.test(text) ? 'queen bed or two single beds, plus one single bed' : null,
      amenities: AMENITY_EN.filter(([re]) => re.test(text)).map(([, en]) => en),
      images: [...new Set(galleries.filter(g => word.test(g.title)).flatMap(g => g.images))],
    });
  }
  return out;
}

function roomDescription(r: KsRoom): string {
  return [
    r.sizeM2 ? `${r.sizeM2} m2` : null,
    /vista (?:maravilhosa )?para a lagoa/i.test(r.text) ? 'lagoon view' : null,
    r.maxGuests ? `up to ${r.maxGuests} guests` : null,
    r.beds,
    /consulte a equipe sobre a configura/i.test(r.text) ? 'private suite, layout and capacity on request' : null,
  ].filter((x): x is string => !!x).join(', ');
}

export interface KsService { name: string; text: string; image: string | null }

/** /servicos/: article.service-card (photo, h3 name, paragraph). */
export function parseKsServices(servicesHtml: string): KsService[] {
  return parse(servicesHtml).querySelectorAll('article.service-card').map(card => ({
    name: collapse(card.querySelector('h3')?.text ?? ''),
    text: card.querySelectorAll('p').map(p => collapse(p.text)).filter(Boolean).join(' '),
    image: imagesIn(card)[0] ?? null,
  })).filter(s => s.name);
}
/** the services whose photos /servicos/ calls real ("As fotos da piscina, do restaurante, da yoga, da canoa havaiana e
 *  do kitesurf são reais"); the others are illustrative and never go into the gallery */
const REAL_PHOTO = /piscina|restaurante|yoga|canoa|kitesurf/i;

const SERVICE_EN: Array<[RegExp, string]> = [
  [/piscina/i, 'Heated pool'],
  [/restaurante/i, 'Restaurant facing the lagoon (breakfast, lunch, snacks, drinks), open to visitors'],
  [/vesti[áa]rio/i, 'Changing rooms'],
  [/guardaria/i, 'Kite equipment storage'],
  [/yoga/i, 'Yoga (by schedule)'],
  [/canoa/i, 'Hawaiian outrigger canoe (by schedule)'],
  [/caiaque|stand up/i, 'Kayak and stand up paddle'],
  [/day use/i, 'Kite day use with shore support for rigging, launch and landing'],
];

/** Address line in the footer ("Av. Praia dos Nobres, 741, Praia Seca, Araruama - RJ"). */
export function ksAddress(html: string): string | null {
  const root = parse(html);
  for (const el of root.querySelectorAll('head, script, style')) el.remove();
  const line = root.structuredText.split('\n').map(l => collapse(l)).find(l => /Praia dos Nobres/i.test(l));
  return line ? line.replace(/\s*[–—]\s*/g, ' - ') : null;
}

/** Amounts printed on /acomodacoes/ (since 2026-11-09 one undated "a partir de" line). */
export function ksVisiblePrices(roomsHtml: string): string[] {
  return findPrices(textOf(roomsHtml)).map(p => p.raw);
}

/** "Suítes a partir de R$ 418,00" -> 418; null when the line is gone */
export function ksFromPrice(roomsHtml: string): number | null {
  const m = textOf(roomsHtml).match(/Su[ií]tes a partir de (R\$\s?\d[\d.,]*)/i);
  return m ? findPrices(m[1])[0]?.amount ?? null : null;
}

/** the "from" rate as one undated slot for every suite: "from" on each room, confirmed on request */
export function ksSlots(roomsHtml: string): Slot[] {
  const price = ksFromPrice(roomsHtml);
  if (price === null) return [];
  return [{
    key: 'suites-from', startDate: null, endDate: null, unit: 'Suite', rooms: parseKsRooms(roomsHtml).map(r => r.name),
    price, currency: 'BRL', priceUnit: 'per_night', priceBasis: 'room', occupancy: null,
    availability: 'on_request', availabilityText: 'rates and availability on request', spotsLeft: null,
    undated: true, priceIsMinimum: true,
  }];
}

export interface KsPages { home: string; rooms: string; services: string }

export function parseKiteSuitesContent(p: KsPages): OfferContent {
  const siteRooms = parseKsRooms(p.rooms);
  const services = parseKsServices(p.services);
  const home = textOf(p.home);
  const school = /Wind Hunter Kite Center/i.test(home) ? 'Wind Hunter Kite Center' : null;
  const lessons = /aulas (?:de kitesurf|em parceria)/i.test(home);
  const shop = /loja de (?:kitesurf|equipamentos)/i.test(home);
  const hasPool = services.some(s => /piscina/i.test(s.name));
  const amenities = [...new Set(siteRooms.flatMap(r => r.amenities))];

  const rooms: ContentRoom[] = siteRooms.map(r => ({
    name: r.name,
    description: roomDescription(r) || null,
    features: r.amenities.filter(a => a !== 'Breakfast'),
  }));

  // a real kite photo first, then the suites round-robin (first photo of each suite, then the second ...), then the
  // other services with real photos
  const imageUrls: string[] = [];
  const add = (u: string | null | undefined) => { if (u && !imageUrls.includes(u)) imageUrls.push(u); };
  add(services.find(s => /kitesurf/i.test(s.name))?.image);
  const longest = Math.max(0, ...siteRooms.map(r => r.images.length));
  for (let i = 0; i < longest; i++) for (const r of siteRooms) add(r.images[i]);
  for (const s of services) if (REAL_PHOTO.test(s.name)) add(s.image);

  const n = siteRooms.length;
  const view = siteRooms.filter(r => /vista para a lagoa/i.test(r.text));
  const sizes = [...new Set(view.map(r => r.sizeM2))], guests = [...new Set(view.map(r => r.maxGuests))];
  const summary = [
    `Kite Suites is a small guesthouse with a restaurant at Praia Seca (Araruama, Rio de Janeiro state, Brazil), facing the Lagoa de Araruama, with ${n || 3} suites: ${siteRooms.map(r => r.name).join(', ')}.`,
    view.length && sizes.length === 1 && guests.length === 1 && sizes[0] && guests[0]
      ? `${view.map(r => r.name).join(' and ')} have about ${sizes[0]} m2 with a lagoon view for up to ${guests[0]} guests, with air conditioning, a minibar, TV and Wi-Fi.` : '',
    `Breakfast is included${hasPool ? '; there is a heated pool' : ''}, and the lagoon-front restaurant is open to visitors.`,
    lessons ? `Kite lessons are given by the partner school ${school ?? 'of the house'} at Praia Seca${shop ? '; the house also has kite day use with shore support and an equipment shop' : ''}.` : '',
    'Stays and lessons are requested by WhatsApp; rates and availability are confirmed on request.',
  ].filter(Boolean).join(' ');

  const address = ksAddress(p.home);
  return {
    kind: 'accommodation',
    title: 'Kite Suites',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Araruama, Rio de Janeiro',
    spot: 'Praia Seca, Araruama',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [], // the site names no levels
    kiteLessons: lessons || null,
    equipmentRental: null,
    beginnerFriendly: null,
    includedServices: amenities,
    optionalServices: [
      lessons ? `Kite lessons with the partner school ${school ?? 'of the house'} (booked by WhatsApp, price on request)` : null,
      ...SERVICE_EN.filter(([re]) => services.some(s => re.test(s.name))).map(([, en]) => en),
      shop ? 'Kite equipment shop' : null,
    ].filter((x): x is string => !!x),
    accommodation: 'lagoon-front guesthouse suites',
    mealPlan: amenities.includes('Breakfast') ? 'breakfast' : null,
    languages: ['pt'], // the site is Portuguese only
    rooms,
    imageUrls: imageUrls.slice(0, 12),
    heroVideoUrl: null,
    sourceUrl: KS_ROOMS_URL,
    bookingUrl: `https://wa.me/${WHATSAPP.slice(1)}`,
    sourceText: [
      `home: ${home}`,
      `address: ${address ?? '-'}`,
      `rooms: ${siteRooms.map(r => `${r.name}: ${r.text} [${r.images.length} photos]`).join(' | ')} | ${textOf(p.rooms).match(/Suítes a partir de[^.]*\.[^.]*\./)?.[0] ?? ''}`,
      `services: ${services.map(s => `${s.name}: ${s.text}`).join(' | ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const kiteSuitesPraiaSeca: OfferAdapter = {
  key: 'kite-suites-praia-seca',
  name: 'Kite Suites Praia Seca',
  kind: 'accommodation',
  disciplines: ['kitesurf'], // no wing foil on the site
  operator: {
    name: 'Kite Suites',
    websiteUrl: SITE,
    rootDomain: 'kitesuites.com.br',
    whatsapp: WHATSAPP,
    phone: WHATSAPP,
  },
  url: KS_ROOMS_URL,
  slotMethod: 'price_table',
  instantBooking: false, // WhatsApp request only; liveAvailability unset
  fetchBudget: 4,
  confidence: 'low', // one undated "from" amount, unit read as per night, request only
  async fetchContent() {
    const home = await page(KS_HOME_URL);
    const rooms = await page(KS_ROOMS_URL);
    const services = await page(KS_SERVICES_URL);
    return parseKiteSuitesContent({ home, rooms, services });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const html = await page(KS_ROOMS_URL);
    if (parseKsRooms(html).length === 0) throw new Error('kite-suites: suite sections missing on /acomodacoes (layout changed?)');
    const slots = ksSlots(html);
    const prices = ksVisiblePrices(html);
    if (prices.length > slots.length) ctx.note(`more amounts on /acomodacoes than the "a partir de" line (${prices.slice(0, 5).join(', ')}): extend the adapter`);
    return slots;
  },
};
