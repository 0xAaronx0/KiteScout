// ---------------------------------------------------------------------------
// Peahi Resort, Lo Stagnone (Marsala, Sicily, Italy) - rooms and villas of the ProKite Alby Rondina kite
// center, directly at its kite spot on the Lo Stagnone lagoon.
//
// Inclusion: Aaron's decision of 2026-10-12. The own site shows no explicit 2026/27 dates or prices (brief
//   rule 5(b) waived for this property); it is listed as "price on request". Kite link (rule 5(a)) on the own
//   site: "We will provide you with accommodation directly at our kite spot next to the lagoon ... close to the
//   kite center" (peahiresort.com), whose menu is the kite center's (lessons, rental, wing). Newest sign of
//   life: the accommodation page was edited 2026-01-14 (Yoast dateModified) with 2026/01 photos of the new
//   sauna villa; the kite center home was edited 2026-02-03.
//
// Data path (checked 2026-10-12), both sites WordPress (Kallyas theme), server-rendered, same operator:
//   content  www.peahiresort.com/ (English accommodation page: intro, 7 room/villa types as <h3> + text, one
//            image slider per type with originals in img.sp-image[data-src]),
//            www.prokitealbyrondina.com/ (kite center text, address, e-mail, Kallyas Google map
//            `new Zn_google_map(id, [lat, lng], ...)` = spotCoords),
//            www.prokitealbyrondina.com/lessons/ (lesson facts + price table, kept as optional services).
//   slots    none: neither site prints a room price. The "Ask for a quote" button opens the Beddy engine
//            (prokitealby.beddy.io), which sits behind Cloudflare Turnstile: NOT used (never bypass).
//            fetchSlots re-reads the accommodation page (memoised) and returns [] (offer = "price on
//            request"); it notes when an amount shows up there so the adapter can be extended.
//   Not used: bstoked / booksurfcamps / portals (hints only).
// robots.txt (2026-10-12): both hosts disallow only /wp-admin/ (admin-ajax allowed).
// Requests per run: content 3, slots 1 (0 extra when content ran in the same process).
// Known limits: no room count, no prices, no season dates; the e-mail and the map pin come from the kite
//   center's site (the accommodation page links there for contact).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, findPrices, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.peahiresort.com';
export const PEAHI_URL = `${SITE}/`;
export const PK_HOME_URL = 'https://www.prokitealbyrondina.com/';
export const PK_LESSONS_URL = 'https://www.prokitealbyrondina.com/lessons/';

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

const textOf = (el: { text: string } | null | undefined): string => collapse(el?.text ?? '');

/** findPrices misses a trailing euro sign ("90 €", "420,00 €": its `\b` after € never matches); catch those too */
function amounts(text: string): string[] {
  const out = findPrices(text).map(p => p.raw);
  for (const m of text.matchAll(/\d[\d.,]*\s?€/g)) if (!out.some(r => r.includes(m[0].trim()))) out.push(m[0]);
  return out;
}

// --- pure parsers -----------------------------------------------------------------------------
export interface PeahiRoom { name: string; text: string; images: string[] }

/** One Kallyas section per room/villa type: <h3> title, text, image slider (originals in data-src). */
export function parsePeahiRooms(html: string): PeahiRoom[] {
  const root = parse(html);
  const out: PeahiRoom[] = [];
  for (const sec of root.querySelectorAll('section.zn_section')) {
    const h3 = sec.querySelector('h3.dn-heading') ?? sec.querySelector('h3');
    const name = textOf(h3);
    if (!name) continue;
    const text = sec.querySelectorAll('.zn_text_box p, .zn_text_box').map(e => textOf(e)).find(Boolean) ?? '';
    const images = sec.querySelectorAll('img.sp-image')
      .map(i => i.getAttribute('data-src') ?? '')
      .filter(u => /\/wp-content\/uploads\/.+\.(jpe?g|png|webp)$/i.test(u));
    out.push({ name, text, images: [...new Set(images)] });
  }
  return out;
}

export function peahiFeatures(text: string): string[] {
  const t = text.toLowerCase();
  return [
    /double \/ twin|double\/twin/.test(t) ? 'Double or twin beds' : null,
    /double bed and one single/.test(t) ? 'Double bed + single bed' : null,
    /three bedrooms/.test(t) ? 'Three bedrooms' : null,
    /two bathrooms/.test(t) ? 'Two bathrooms' : null,
    /private bathroom/.test(t) ? 'Private bathroom with shower' : null,
    /air conditioning/.test(t) ? 'Air conditioning' : null,
    /\btv\b/.test(t) ? 'TV' : null,
    /balcony with sea view/.test(t) ? 'Balcony with sea view' : /balcony/.test(t) ? 'Balcony' : null,
    /ground floor/.test(t) ? 'Ground floor' : null,
    /kitchen/.test(t) ? 'Kitchen' : null,
    /living room/.test(t) ? 'Living room' : null,
    /garden/.test(t) ? 'Garden' : null,
    /sauna/.test(t) ? 'Private Finnish sauna' : null,
    /breakfast included/.test(t) ? 'Buffet breakfast included' : null,
  ].filter((x): x is string => !!x);
}

/** The intro paragraph under the "ACCOMMODATION" title. */
export function parsePeahiIntro(html: string): string {
  return parse(html).querySelectorAll('.zn_text_box p').map(p => textOf(p)).find(t => /accommodation directly at our kite spot/i.test(t)) ?? '';
}

/** Kallyas map: `new Zn_google_map('zn_google_map_x', [37.887818, 12.471306], ...)`. */
export function parsePkCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/new Zn_google_map\(\s*'[^']*'\s*,\s*\[\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\]/);
  if (!m) return null;
  const lat = Number(m[1]); const lng = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export interface PkCenter { intro: string; center: string; address: string; email: string | null }

export function parsePkCenter(homeHtml: string): PkCenter {
  const root = parse(homeHtml);
  const paras = root.querySelectorAll('.zn_text_box p, h1 + p').map(p => textOf(p)).filter(Boolean);
  const intro = paras.find(p => /lagoon of Lo Stagnone/i.test(p)) ?? '';
  const center = paras.filter(p => /not just a kite school|perfect conditions for kitesurfing/i.test(p)).join(' ');
  const address = root.querySelectorAll('.kl-contentmaps__panel-info-text > div').map(d => textOf(d))
    .filter(t => t && !/@|\+39/.test(t)).join(', ');
  const email = homeHtml.match(/mailto:([\w.+-]+@[\w.-]+\.[a-z]{2,})/i)?.[1] ?? null;
  return { intro, center, address, email };
}

export interface PkLessons { facts: string[]; prices: string[] }

export function parsePkLessons(html: string): PkLessons {
  const root = parse(html);
  const paras = root.querySelectorAll('.zn_text_box p, .zn_text_box li').map(p => textOf(p)).filter(Boolean);
  const facts = paras.filter(p => /1 on 1 lessons|Courses for all levels|Learning process usually|Cabrinha/i.test(p));
  const prices = root.querySelectorAll('table.tableizer-table tbody tr').map(tr => {
    const td = tr.querySelectorAll('td').map(c => textOf(c));
    return td[0] && td[1] ? `${td[0]}: ${td[1]}${td[2] ? ` (${td[2]})` : ''}` : '';
  }).filter(Boolean);
  return { facts, prices };
}

/** round-robin over the room sliders so the gallery shows every type early */
export function peahiImages(rooms: PeahiRoom[], max = 30): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < max && i < 40; i++) {
    for (const r of rooms) if (r.images[i] && !out.includes(r.images[i])) out.push(r.images[i]);
  }
  return out.slice(0, max);
}

export interface PeahiPages { peahi: string; pkHome: string; pkLessons: string }

export function parsePeahiContent(p: PeahiPages): OfferContent {
  const types = parsePeahiRooms(p.peahi);
  const intro = parsePeahiIntro(p.peahi);
  const center = parsePkCenter(p.pkHome);
  const lessons = parsePkLessons(p.pkLessons);
  const coords = parsePkCoords(p.pkHome);
  const quoteUrl = parse(p.peahi).querySelectorAll('a').map(a => a.getAttribute('href') ?? '').find(h => /beddy\.io/.test(h)) ?? null;
  const menu = parse(p.peahi).querySelectorAll('a').map(a => textOf(a).toLowerCase());

  const rooms: ContentRoom[] = types.map(r => ({ name: r.name, description: r.text || null, features: peahiFeatures(r.text) }));
  const villas = types.filter(r => /villa/i.test(r.name)).length;
  const sauna = types.some(r => /sauna/i.test(r.name));

  const summary = [
    'Peahi Resort is the accommodation of the ProKite Alby Rondina kite center at the Lo Stagnone lagoon near Marsala in western Sicily, directly at the kite spot and close to the center and its parking lot.',
    `It has newly built double/twin, triple and deluxe rooms (some with balcony and sea view; private bathroom, air conditioning, buffet breakfast included)${villas ? ` and two-storey villas with three bedrooms, two bathrooms, kitchen and garden${sauna ? ', one type with a private Finnish sauna' : ''}` : ''}; a restaurant and bar in front serve dinner.`,
    'The kite center gives private and semi-private lessons (at most 2 students per instructor, Cabrinha gear, radio communication) in the shallow flat water of the lagoon and rents kite and wing gear.',
    'Stays are booked by quote request; the site publishes no room prices.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Peahi Resort',
    summary,
    continent: 'Europe',
    country: 'Italy',
    region: 'Lo Stagnone, Sicily',
    spot: 'Lo Stagnone',
    // Kallyas Google map on the kite center's home page (checked 2026-10-12)
    spotCoords: coords,
    itinerarySpots: [],
    durationDays: null,
    // lessons: "Courses for all levels; from complete beginners to advanced freestyle lesson"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: lessons.prices.length > 0 || menu.includes('kite lessons'),
    equipmentRental: menu.includes('kite rental'),
    beginnerFriendly: /complete beginners|perfect for learning/i.test(`${lessons.facts.join(' ')} ${center.intro}`),
    includedServices: types.some(r => /breakfast included/i.test(r.text)) ? ['Buffet breakfast (rooms)'] : [],
    optionalServices: [
      'Dinner at the restaurant & bar in front of the rooms',
      ...lessons.prices.map(l => `Kite lessons - ${l}`),
      menu.includes('kite rental') ? 'Kite rental' : null,
      menu.includes('wing lessons') ? 'Wing foil lessons' : null,
      menu.includes('wing rental') ? 'Wing foil rental' : null,
    ].filter((x): x is string => !!x),
    accommodation: 'rooms and three-bedroom villas at the kite center',
    mealPlan: 'breakfast',
    languages: [],
    rooms,
    imageUrls: peahiImages(types),
    heroVideoUrl: null,
    sourceUrl: PEAHI_URL,
    bookingUrl: quoteUrl ? quoteUrl.replace(/&#0?38;|&amp;/g, '&') : PEAHI_URL,
    sourceText: [
      `accommodation: ${intro}`,
      `types: ${types.map(r => `${r.name}: ${r.text}`).join(' | ')}`,
      `kite center: ${center.intro} ${center.center}`,
      `address: ${center.address}; e-mail ${center.email ?? '-'}; map ${coords ? `${coords.lat},${coords.lng}` : '-'}`,
      `lessons: ${lessons.facts.join(' ')}`,
      `lesson prices: ${lessons.prices.join(' | ')}`,
    ].join('\n'),
  };
}

/** No published room price: [] (price on request). Returns the amounts if the page starts printing some. */
export function peahiVisiblePrices(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, form, .znpb-footer-smart-area')) el.remove();
  return amounts(collapse((root.querySelector('.zn_pb_wrapper') ?? root).text));
}

// --- adapter ----------------------------------------------------------------------------------
export const peahiResortStagnone: OfferAdapter = {
  key: 'peahi-resort-stagnone',
  name: 'Peahi Resort Lo Stagnone',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'ProKite Alby Rondina',
    websiteUrl: SITE,
    rootDomain: 'peahiresort.com',
    contactEmail: 'info@prokitealbyrondina.com',
    whatsapp: '+393475373881',
    phone: '+393475373881',
  },
  url: PEAHI_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'low', // Aaron 2026-10-12: listed without 2026/27 proof, no prices on the site, Beddy blocked
  async fetchContent() {
    const [peahi, pkHome, pkLessons] = [await page(PEAHI_URL), await page(PK_HOME_URL), await page(PK_LESSONS_URL)];
    return parsePeahiContent({ peahi, pkHome, pkLessons });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const html = await page(PEAHI_URL);
    if (parsePeahiRooms(html).length === 0) throw new Error('peahi-resort: room sections missing on peahiresort.com (layout changed?)');
    const prices = peahiVisiblePrices(html);
    if (prices.length) ctx.note(`prices appeared on peahiresort.com (${prices.slice(0, 5).join(', ')}): extend the adapter`);
    return [];
  },
};
