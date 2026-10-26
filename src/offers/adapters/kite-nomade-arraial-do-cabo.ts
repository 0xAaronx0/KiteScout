// ---------------------------------------------------------------------------
// Kite Nômade (Espaço Nômade), Pernambuca, Arraial do Cabo (Rio de Janeiro, Brazil) - kite pousada on the Lagoa
// de Araruama inside an environmental reserve: 4 bungalows + 6 suites with breakfast and its own kite school
// (courses with ABK-trained instructors and the ABK rider certificate), bar on site.
//
// Inclusion: Aaron's approval of 2026-10-26 (research .research/r3/brasil-recife-rio.md, Rio de Janeiro section).
//   Kite link (rule 5): /school/ (courses Iniciante 10 h, Regular 8 h, Intermediário, Avançado single lessons) and
//   the home page ("o local perfeito para o aprendizado e a prática do Kitesurf"). Current operation: room photos
//   uploaded 2024-03, home photos 2024-04, Trustindex Google badge (91 reviews, "verified" = rating above 4.5 in
//   the last 12 months), a review mentions new suites added; the site shows no explicit 2026 date.
//
// Data path (checked 2026-10-26): WordPress with a custom theme (kitenomade), Portuguese only:
//   content  / (intro, lagoon text, address, Google Maps embed "Kite Nômade School" !2d-42.2695 !3d-22.9154 ->
//            spotCoords), /bangalo/ (intro with breakfast and amenities, icon cards, one .galery-plugin block per
//            room type: h3 name, capacity/bed/kitchen text, slider photos 2024/03/*-scaled.jpg), /school/ (courses,
//            ABK instructors; the "NOSSA Equipe" block naming IKO instructors, kids from 7 and radio helmets is an
//            HTML comment, i.e. NOT shown on the live page, so we do not claim it), theme CSS desktop.css (the home section backgrounds: the only kiting photo of the
//            lagoon, IMG_1885, and the grounds photo kitenomade-espaco-site; theme /images/ banners are stock-like
//            ocean/palm shots and are not used).
//   slots    none. The /bangalo/ page embeds the Foco Multimídia booking widget (widgets.soufoco.com.br, establishment
//            4924; engine kitenomade.soufoco.com.br). Checked 2026-10-26 with our honest UA and no Origin header:
//            api-motor.focoapi.com.br/widgets/4924 answers (widget config only, no prices); the price search
//            api-motor.focoapi.com.br/sales/search answers 401 from its SiteOriginMiddleware (it needs the
//            operator's own Origin, which we never spoof); the datepicker endpoint returns a JSON URL on
//            json-server.motor-reserva.com.br, which is behind a Cloudflare challenge (403, BLOCKED, not retried).
//            So there is no token-free price path: fetchSlots re-reads /bangalo/ (memoised) and returns []
//            ("price on request"); it notes when an amount appears on the page or the Foco widget disappears.
//   Not used: portals and OTAs (hotel portals list it), Instagram/Facebook.
// robots.txt (2026-10-26): kitenomade.com.br disallows only /wp-admin/; api-motor.focoapi.com.br "Disallow:" (empty).
// Requests per run: content 4 (home, /bangalo/, /school/, desktop.css), slots 1 (0 extra when content ran in the
//   same process).
// Flags: liveAvailability unset (no inventory read); instantBooking false: the Foco engine is an online booking
//   engine (instant booking inferred from the engine type), but we cannot read or verify its checkout without
//   spoofing Origin, and the room page's own button opens WhatsApp ("Faça sua reserva").
// Known limits: no prices anywhere on the site (rooms or courses); course prices only by WhatsApp; room texts are
//   Portuguese, so room descriptions are built from the parsed facts (floor, view, guests, beds, kitchen).
// Doubt: the address is "Pernambuca, Arraial do Cabo/RJ" on the own site, while some portals list it as
//   Araruama/Iguabinha; we follow the own site.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, findPrices, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://kitenomade.com.br';
export const KN_HOME_URL = `${SITE}/`;
export const KN_ROOMS_URL = `${SITE}/bangalo/`;
export const KN_SCHOOL_URL = `${SITE}/school/`;
export const KN_CSS_URL = `${SITE}/wp-content/themes/kitenomade/css/desktop.css`;
/** Foco Multimídia booking engine of the pousada (establishment 4924); a JS app we cannot read without Origin. */
export const KN_ENGINE_URL = 'https://kitenomade.soufoco.com.br/';

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share it */
function page(url: string, accept = 'text/html'): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** visible text lines of a page (scripts, styles, menus, footer, review/weather/WhatsApp widgets dropped) */
function bodyLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('title, script, style, noscript, svg, header, footer, nav, pre, .joinchat, #footer, .menu-header, .menuresponsive, .tempo')) el.remove();
  // the whole root, not <body>: the parser closes <body> early on these pages (most content lands after it);
  // <pre class="ti-widget"> is the Trustindex review widget (raw HTML inside <pre>)
  return root.structuredText.split('\n').map(l => collapse(l)).filter(l => l && !/^<!DOCTYPE/i.test(l));
}
const bodyText = (html: string): string => bodyLines(html).join(' ');

const https = (u: string) => u.replace(/^http:\/\//, 'https://');

// --- pure parsers -----------------------------------------------------------------------------
export interface KnRoom { name: string; text: string; images: string[] }

/** /bangalo/: one `.galery-plugin` block per room type (h3 name, description paragraph, slider photos). */
export function parseKnRooms(roomsHtml: string): KnRoom[] {
  return parse(roomsHtml).querySelectorAll('.galery-plugin').map(block => {
    const name = collapse(block.querySelector('h3')?.text ?? '');
    const p = block.querySelector('p.wp-block-paragraph');
    const text = collapse((p?.innerHTML ?? '').replace(/<\/?br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' '));
    const images = block.querySelectorAll('img.sp-image').map(i => i.getAttribute('data-src') ?? '')
      .filter(u => /\/wp-content\/uploads\//.test(u)).map(https);
    return { name, text: collapse(parse(`<p>${text}</p>`).text), images: [...new Set(images)] };
  }).filter(r => r.name);
}

/** Units per room heading: "Suítes 1, 2 e 3" = 3, "Bangalô Lua" = 1. */
export function knUnits(name: string): number {
  const nums = name.match(/\d+/g);
  return nums && /^Suítes?\b/i.test(name) ? nums.length : 1;
}

/** English facts from the Portuguese room text (floor, view, guests, beds, kitchen). */
export function knRoomFacts(r: KnRoom): { description: string; features: string[]; maxGuests: number | null } {
  const t = r.text;
  const floor = /Anda(?:r)? superior/i.test(t) ? 'upper floor' : /Andar térreo/i.test(t) ? 'ground floor' : null;
  const view = /vista (?:para a|da) lagoa/i.test(t) && /reserva/i.test(t) ? 'lagoon and nature reserve view'
    : /vista (?:para o|do) jardim/i.test(t) ? 'garden view' : /vista (?:para a|da) lagoa/i.test(t) ? 'lagoon view' : null;
  const guests = Number(t.match(/[Aa]comoda até (\d+) pessoas/)?.[1]) || (/1 casal .* ou 2 pessoas/i.test(t) ? 2 : null);
  let beds: string | null = null;
  if (/cama queen ou king ou 2 pessoas em camas de solteiro/i.test(t)) beds = 'queen or king bed, or two single beds';
  else if (/1 cama King e 1 cama de solteiro King/i.test(t)) beds = 'king bed + king single bed';
  else if (/cama queen \+ cama de solteiro King/i.test(t)) beds = 'queen bed + king single bed';
  else if (/cama queen \+ cama de solteiro/i.test(t)) beds = 'queen bed + single bed';
  const kitchen = /não possui cozinha/i.test(t) ? false : /possui cozinha/i.test(t) ? true : null;
  const units = knUnits(r.name);
  const parts = [
    units > 1 ? `${units} units` : null, floor, view, guests ? `up to ${guests} guests` : null, beds,
    kitchen === true ? 'kitchen' : kitchen === false ? 'no kitchen' : null,
  ].filter((x): x is string => !!x);
  const features = [view, kitchen === true ? 'Kitchen' : null].filter((x): x is string => !!x)
    .map(f => f[0].toUpperCase() + f.slice(1));
  return { description: parts.join(', '), features, maxGuests: guests };
}

/** Amenity icon cards on /bangalo/ ("Cama de casal", "Ar-condicionado Split", ...). */
export function parseKnAmenities(roomsHtml: string): string[] {
  return parse(roomsHtml).querySelectorAll('.bangalo-card .bangalo-text').map(e => collapse(e.text)).filter(Boolean);
}

export interface KnCourse { name: string; text: string }

/** /school/ course cards: h-heading name + text (Iniciante, Regular, Intermediário, Avançado). */
export function parseKnCourses(schoolHtml: string): KnCourse[] {
  const lines = bodyLines(schoolHtml);
  const out: KnCourse[] = [];
  for (const name of ['Iniciante', 'Regular', 'Intermediário', 'Avançado']) {
    const i = lines.indexOf(name);
    if (i >= 0 && lines[i + 1]) out.push({ name, text: lines[i + 1] });
  }
  return out;
}

/** Google Maps embed of the home page ("Kite Nômade School"): !2d<lng>!3d<lat>. */
export function knCoords(homeHtml: string): { lat: number; lng: number } | null {
  const m = homeHtml.match(/google\.com\/maps\/embed\?pb=[^"']*?!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)[^"']*?Kite(?:%20|\s|\+)N/i);
  return m ? { lat: Number(Number(m[2]).toFixed(4)), lng: Number(Number(m[1]).toFixed(4)) } : null;
}

/** Owner photos set as CSS section backgrounds (uploads only; the theme banners and the stock board photo are skipped). */
export function knCssPhotos(css: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
    const u = https(m[1]);
    if (!/kitenomade\.com\.br\/wp-content\/uploads\//.test(u)) continue;
    if (/imagem-home|onda|logo|favicon|icon/i.test(u)) continue; // imagem-home.png = stock binding close-up
    if (!out.includes(u)) out.push(u);
  }
  // the lagoon kiting photo first (best hero), then the grounds
  return out.sort((a, b) => Number(/IMG_\d+/i.test(b)) - Number(/IMG_\d+/i.test(a)));
}

/** Gallery: the CSS owner photos, then the room galleries round-robin (first photo of each room, then the second ...). */
export function knImages(css: string, rooms: KnRoom[], max = 12): string[] {
  const out = [...knCssPhotos(css)];
  const longest = Math.max(0, ...rooms.map(r => r.images.length));
  for (let i = 0; i < longest; i++) for (const r of rooms) if (r.images[i] && !out.includes(r.images[i])) out.push(r.images[i]);
  return out.slice(0, max);
}

/** The Foco booking widget on /bangalo/ (establishment id), or null when it is gone. */
export function knFocoWidget(roomsHtml: string): string | null {
  return roomsHtml.match(/id="motor-reserva-widget-search"[^>]*establishment-id="(\d+)"/)?.[1] ?? null;
}

/** Amounts printed on /bangalo/ (none today); returned so fetchSlots can flag them. */
export function knVisiblePrices(roomsHtml: string): string[] {
  return findPrices(bodyText(roomsHtml)).map(p => p.raw);
}

export interface KnPages { home: string; rooms: string; school: string; css: string }

export function parseKiteNomadeContent(p: KnPages): OfferContent {
  const roomBlocks = parseKnRooms(p.rooms);
  const amenities = parseKnAmenities(p.rooms);
  const courses = parseKnCourses(p.school);
  const home = bodyText(p.home);
  const roomsText = bodyText(p.rooms);
  const school = bodyText(p.school);
  const coords = knCoords(p.home);

  const rooms: ContentRoom[] = roomBlocks.map(r => {
    const f = knRoomFacts(r);
    return { name: r.name, description: f.description || null, features: f.features };
  });
  const bungalows = roomBlocks.filter(r => /^Bangal/i.test(r.name)).reduce((n, r) => n + knUnits(r.name), 0);
  const suites = roomBlocks.filter(r => /^Suítes?/i.test(r.name)).reduce((n, r) => n + knUnits(r.name), 0);
  const breakfast = /café da manhã incluso/i.test(roomsText);
  const petFriendly = /Pet Friendly/i.test(roomsText);
  const beginnerHours = courses.find(c => c.name === 'Iniciante')?.text.match(/(\d+) horas/)?.[1] ?? null;
  const regularHours = courses.find(c => c.name === 'Regular')?.text.match(/(\d+) horas/)?.[1] ?? null;

  const AMENITY_EN: Record<string, string> = {
    'Cama de casal': 'Double bed', 'Ar-condicionado Split': 'Air conditioning', 'TV LED': 'TV',
    'Banheiro com ducha quente': 'Private bathroom with hot shower', 'Frigobar para guardar seu mantimento': 'Minibar',
    'Cooktop, Forno elétrico e Micro-Ondas': 'Cooktop, electric oven and microwave (bungalows)',
  };

  const summary = [
    `Kite Nômade is a kite pousada at Pernambuca (Arraial do Cabo, Rio de Janeiro state, Brazil) on the shallow, warm Lagoa de Araruama, inside an environmental reserve, with ${bungalows || 4} bungalows and ${suites || 6} suites.`,
    `Rooms have air conditioning, a minibar and a balcony or veranda with lagoon, reserve or garden view; most bungalows have a kitchen${breakfast ? ', and breakfast is included' : ''}${petFriendly ? '; pets are welcome' : ''}.`,
    `Its own kite school teaches with ABK-trained instructors and ends with the ABK rider certificate${beginnerHours ? ` (a ${beginnerHours}-hour beginner course${regularHours ? `, an ${regularHours}-hour course for people with water-sports experience` : ''}, intermediate training and single lessons for advanced riders)` : ''}, and a bar serves açaí, snacks and drinks.`,
    'The site publishes no prices: stays are booked through its online booking engine or by WhatsApp, so the listing is price on request.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Kite Nômade',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Arraial do Cabo, Rio de Janeiro',
    spot: 'Lagoa de Araruama, Arraial do Cabo',
    // Google Maps embed "Kite Nômade School" on the home page (!2d-42.2695 !3d-22.9154, 2026-10-26)
    spotCoords: coords,
    itinerarySpots: [],
    durationDays: null,
    // Iniciante (from zero), Regular, Intermediário, Avançado (/school/)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: courses.length > 0,
    equipmentRental: null, // the site names no rental
    beginnerFriendly: /nível independente|velejador independente/i.test(school) || null,
    includedServices: [
      breakfast ? 'Breakfast' : null,
      ...amenities.map(a => AMENITY_EN[a] ?? null),
    ].filter((x): x is string => !!x),
    optionalServices: [
      ...courses.map(c => {
        const h = c.text.match(/(\d+) horas/)?.[1];
        const en: Record<string, string> = {
          Iniciante: `Kite course Iniciante (beginner${h ? `, ${h} hours` : ''}, ABK certificate)`,
          Regular: `Kite course Regular (with water-sports experience${h ? `, ${h} hours` : ''})`,
          'Intermediário': 'Kite training Intermediário (started elsewhere, not yet independent)',
          'Avançado': 'Advanced kite lessons (single lessons)',
        };
        return `${en[c.name] ?? c.name} (price on request)`;
      }),
      'Bar (açaí, juices, sandwiches, crepes, drinks)',
    ].filter((x): x is string => !!x),
    accommodation: 'lagoon-side bungalows and suites in a nature reserve',
    mealPlan: breakfast ? 'breakfast' : null,
    languages: ['pt'], // the site is Portuguese only; it names no lesson languages
    rooms,
    imageUrls: knImages(p.css, roomBlocks),
    heroVideoUrl: null,
    sourceUrl: KN_ROOMS_URL,
    bookingUrl: KN_ENGINE_URL,
    sourceText: [
      `home: ${home}`,
      `rooms page: ${roomsText}`,
      `rooms: ${roomBlocks.map(r => `${r.name}: ${r.text} [${r.images.length} photos]`).join(' | ')}`,
      `amenities: ${amenities.join(', ')}`,
      `school: ${school}`,
      `map pin: ${coords ? `${coords.lat},${coords.lng}` : '-'}`,
      `booking engine: Foco Multimídia establishment ${knFocoWidget(p.rooms) ?? '-'} (${KN_ENGINE_URL}), prices not readable without Origin`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const kiteNomadeArraialDoCabo: OfferAdapter = {
  key: 'kite-nomade-arraial-do-cabo',
  name: 'Kite Nômade Arraial do Cabo',
  kind: 'accommodation',
  disciplines: ['kitesurf'], // no wing foil on the site
  operator: {
    name: 'Kite Nômade',
    websiteUrl: SITE,
    rootDomain: 'kitenomade.com.br',
    contactEmail: 'contato@kitenomade.com.br',
    whatsapp: '+5522981582627',
    phone: '+5522981582627',
  },
  url: KN_ROOMS_URL,
  slotMethod: 'price_table',
  instantBooking: false, // Foco engine unreadable without spoofing Origin (see header); liveAvailability unset
  fetchBudget: 6,
  confidence: 'low', // no prices on the site, the engine's prices are not readable for us
  async fetchContent() {
    const home = await page(KN_HOME_URL);
    const rooms = await page(KN_ROOMS_URL);
    const school = await page(KN_SCHOOL_URL);
    const css = await page(KN_CSS_URL, 'text/css,*/*;q=0.1');
    return parseKiteNomadeContent({ home, rooms, school, css });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const html = await page(KN_ROOMS_URL);
    if (parseKnRooms(html).length === 0) throw new Error('kite-nomade: room blocks missing on /bangalo/ (layout changed?)');
    const prices = knVisiblePrices(html);
    if (prices.length) ctx.note(`prices appeared on /bangalo/ (${prices.slice(0, 5).join(', ')}): extend the adapter`);
    if (!knFocoWidget(html)) ctx.note('the Foco booking widget is gone from /bangalo/: check the booking path');
    return [];
  },
};
