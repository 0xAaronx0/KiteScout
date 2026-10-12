// ---------------------------------------------------------------------------
// Palapas Ventana, La Ventana Bay (between La Ventana and El Sargento, Baja California Sur, Mexico) -
// family-run ocean adventure resort (Hatler family) with stand-alone palapa-roofed casitas, restaurant, pool
// and spa; for kiters: private launch with beach assistants, on-the-water kite storage, on-site kite school
// (partner ProKite South Padre), gear shop, compressed air and a daily downwinder.
//
// Data path (checked 2026-10-12): WordPress site (PageX builder) www.palapasventana.com, English.
//   content  / (resort intro, the 2026 trip calendar "January 2026: Winter Fun and Kiteboarding" ...
//            "December 2026: Mag Bay Whale Season + Whale Sharks!" in .pagex-accordion-item-title),
//            /resort/ (casita types, meals by season, kite support), /activities/kiteboarding/ (school,
//            package cards: <h6> title + .pagex-post-data items "Available / Duration / Includes / Price").
//   slots    none. Casita stays are booked by inquiry (contact form / contact@palapasventana.com) and the
//            site prints no casita rates -> fetchSlots returns [] ("price on request"). The only stay
//            package ("Learn to Kite Vacation", 5 nights) has no price; the priced card ("Jetski Support
//            Package", USD 1,395 cash) is lessons only -> content. The "Kiteboarding Liveaboard" card still
//            says "February 2024" and is left out.
// robots.txt (2026-10-12): "User-agent: * / Crawl-delay: 10", nothing disallowed -> this adapter waits 10 s
//   between its own requests (local helper; skipped on fixture replay). The home page embeds a Google Maps
//   iframe by place name only (no coordinates) -> no spotCoords.
// Requests per run: content 3, slots 0.
// Known limits: no prices, no availability (confidence 'low').
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.palapasventana.com';
export const PV_HOME_URL = `${SITE}/`;
export const PV_RESORT_URL = `${SITE}/resort/`;
export const PV_KITE_URL = `${SITE}/activities/kiteboarding/`;
const CONTACT_URL = `${SITE}/contact/`;
const CRAWL_DELAY_MS = 10_000; // www.palapasventana.com robots.txt "Crawl-delay: 10"

export interface PvCasita { name: string; guests: number | null; text: string }
export interface PvPackage { title: string; fields: Record<string, string> }

// --- local helpers ----------------------------------------------------------------------------
let lastSiteFetch = 0;
let siteQueue: Promise<unknown> = Promise.resolve();
/** Fetch serialised with the robots.txt crawl delay (skipped on fixture replay). */
function page(url: string): Promise<string> {
  const run = async () => {
    if (!process.env.OFFERS_FIXTURE_DIR) {
      const wait = lastSiteFetch + CRAWL_DELAY_MS - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
    try { return await fetchText(url, { accept: 'text/html' }); } finally { lastSiteFetch = Date.now(); }
  };
  const p = siteQueue.catch(() => undefined).then(run);
  siteQueue = p;
  return p;
}

/** Text blocks (h1-h6, p, li) in document order, without chrome. */
function blocks(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, form')) el.remove();
  const out: string[] = [];
  for (const el of root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li')) {
    const t = collapse(el.text);
    if (t && out[out.length - 1] !== t) out.push(t);
  }
  return out;
}

/** Content photos: the shared helper scopes to <main>/<article>, which holds one image on the home page here -> wrap <body>. */
function photos(html: string, base: string): string[] {
  const body = parse(html).querySelector('body');
  return imageCandidates(body ? `<main>${body.innerHTML}</main>` : html, base, null, 80);
}

// --- pure parsers -----------------------------------------------------------------------------
/** Casita types on /resort/: "Specialty Casita: up to 4 people, private bathroom with sink and shower." */
export function parsePvCasitas(resortHtml: string): PvCasita[] {
  return blocks(resortHtml)
    .map(b => b.match(/^([A-Z][\w ]*Casita):\s*(.+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map(m => ({ name: m[1], guests: Number(m[2].match(/up to (\d+)/i)?.[1]) || null, text: m[2].replace(/\.$/, '') }));
}

/** Package cards on /activities/kiteboarding/: <h6> title followed by "Label:" / value items. */
export function parsePvPackages(kiteHtml: string): PvPackage[] {
  const root = parse(kiteHtml);
  const out: PvPackage[] = [];
  for (const el of root.querySelectorAll('h6, .pagex-post-data-item')) {
    if (el.tagName === 'H6') { out.push({ title: collapse(el.text).replace(/:$/, ''), fields: {} }); continue; }
    const cur = out[out.length - 1];
    const label = collapse(el.querySelector('.pagex-post-data-prefix')?.text ?? '').replace(/:$/, '');
    const value = collapse(el.querySelector('.pagex-post-data-value')?.text ?? '');
    if (cur && label) cur.fields[label] = value;
  }
  return out.filter(p => Object.keys(p.fields).length > 0);
}

/** The home page's trip calendar ("January 2026: Winter Fun and Kiteboarding"). */
export function parsePvCalendar(homeHtml: string): string[] {
  return parse(homeHtml).querySelectorAll('.pagex-accordion-item-title').map(e => collapse(e.text)).filter(t => /^[A-Z][a-z]+ 20\d\d:/.test(t));
}

export interface PvPages { home: string; resort: string; kite: string }

export function parsePalapasContent(p: PvPages): OfferContent {
  const home = blocks(p.home);
  const resort = blocks(p.resort);
  const kite = blocks(p.kite);
  const casitas = parsePvCasitas(p.resort);
  const packages = parsePvPackages(p.kite);
  const calendar = parsePvCalendar(p.home);
  const welcome = home.find(b => /Welcome to Palapas Ventana/i.test(b)) ?? '';
  const intro = resort.find(b => /palapa roofs of our quaint casitas/i.test(b)) ?? '';
  const meals = resort.find(b => /winter season \(November-March\) breakfast and lunch are included/i.test(b)) ?? '';
  const kiteSupport = resort.find(b => /launch your kite/i.test(b)) ?? '';
  const kiteVacation = kite.find(b => /private launch/i.test(b)) ?? '';
  const school = kite.find(b => /ProKite South Padre/i.test(b)) ?? '';
  const year = new Date().getUTCFullYear();
  // a card whose "Available" names only past years (the liveaboard still says "February 2024") is stale
  const current = packages.filter(pk => !(pk.fields.Available ?? '').match(/\b20\d\d\b/g)?.every(y => Number(y) < year));
  const pkgLines = current
    .filter(pk => !/^Kiteboarding Lessons$/i.test(pk.title))
    .map(pk => `${pk.title} (${[pk.fields.Available, pk.fields.Duration, pk.fields.Includes].filter(Boolean).join('; ')})${/\$\s?\d/.test(pk.fields.Price ?? '') ? `: ${pk.fields.Price}` : ': price on request'}`);
  const jetski = current.find(pk => /jet\s?ski/i.test(pk.title) && /\$\s?\d/.test(pk.fields.Price ?? ''));
  const jetskiPrice = jetski?.fields.Price?.match(/\$\s?([\d,]+(?:\.\d\d)?)\s*CASH/i)?.[1]?.replace(/\.00$/, '') ?? null;

  const rooms: ContentRoom[] = casitas.map(c => ({
    name: c.name,
    description: `Stand-alone palapa-roofed casita with a porch, rocking chairs and hammock: ${c.text}.`,
    features: [c.guests ? `Up to ${c.guests} guests` : null, /shared bathroom/i.test(c.text) ? 'Shared bathroom facilities' : /private bathroom/i.test(c.text) ? 'Private bathroom' : null]
      .filter((x): x is string => !!x),
  }));

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const [html, base] of [[p.resort, PV_RESORT_URL], [p.kite, PV_KITE_URL], [p.home, PV_HOME_URL]] as const) {
    for (const u of photos(html, base)) {
      // the home page also shows the resort's fishing / diving / whale trips: not this offer
      if (!/palapasventana\.com\/wp-content\/uploads\//.test(u) || /logo|icon|favicon|flag|poster|partner|captain|fish|whale|div(e|ing)|scuba|spear|snorkel|food|-300\.(jpe?g|webp)$|\.svg|\.png$|\.gif$/i.test(u)) continue;
      const k = u.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '').toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); imageUrls.push(u);
    }
  }

  const summary = [
    'Palapas Ventana is a family-run ocean adventure resort on La Ventana Bay in the Sea of Cortez, between La Ventana and El Sargento in Baja California Sur, Mexico, about 35 minutes from La Paz, with stand-alone palapa-roofed casitas, a pool, jacuzzi, spa and the El Anzuelo restaurant.',
    `Specialty casitas sleep up to ${casitas.find(c => /specialty/i.test(c.name))?.guests ?? 4} with a private bathroom, regular casitas up to ${casitas.find(c => /regular/i.test(c.name))?.guests ?? 2} with shared bathrooms; breakfast and lunch are included from November to March and all meals from April to October, and stays are booked by inquiry.`,
    `For kiters there is a private launch with a launch and landing assistant, on-the-water kite storage, an on-site kite school with partner ProKite South Padre, a gear shop, compressed air and one daily downwinder${jetskiPrice ? `; a 9-hour jet-ski-assisted lesson package costs USD ${jetskiPrice} (cash)` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Palapas Ventana',
    summary,
    continent: 'North America',
    country: 'Mexico',
    region: 'Baja California Sur',
    spot: 'La Ventana',
    itinerarySpots: [],
    durationDays: null,
    // kite page: "train clients with little to no experience starting from the ground up" + "Already a kiter" (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /kiteboarding lessons/i.test(school) || /kite school/i.test(kiteVacation),
    equipmentRental: null, // lessons include gear; the site lists no separate rental
    beginnerFriendly: /little to no experience/i.test(school) ? true : null,
    includedServices: [
      'Breakfast and lunch (November-March) / all meals (April-October)',
      'Kite launch and landing assistance, on-the-water kite storage, one daily downwinder',
      'Snorkeling gear, bikes and kayaks',
      'Wi-Fi, pool and jacuzzi',
    ],
    optionalServices: [
      ...pkgLines,
      'Kite trips to Cerralvo Island and to the Pacific side',
      'Fishing, spearfishing, scuba diving and whale trips',
      'Spa',
      'Shuttle service',
    ],
    accommodation: 'stand-alone beachfront casitas',
    mealPlan: 'breakfast and lunch (Nov-Mar), full board (Apr-Oct)',
    languages: ['en', 'es'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: PV_RESORT_URL,
    bookingUrl: CONTACT_URL,
    sourceText: [
      `home: ${welcome}`,
      `calendar: ${calendar.join(' | ')}`,
      `resort: ${[intro, ...casitas.map(c => `${c.name}: ${c.text}`), meals, kiteSupport].filter(Boolean).join(' | ')}`,
      `kite: ${[school, kiteVacation].filter(Boolean).join(' | ')}`,
      `packages: ${packages.map(pk => `${pk.title}: ${Object.entries(pk.fields).map(([k, v]) => `${k} ${v}`).join('; ')}`).join(' || ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const palapasVentanaLaVentana: OfferAdapter = {
  key: 'palapas-ventana-la-ventana',
  name: 'Palapas Ventana La Ventana',
  kind: 'accommodation',
  operator: {
    name: 'Palapas Ventana',
    websiteUrl: SITE,
    rootDomain: 'palapasventana.com',
    contactEmail: 'contact@palapasventana.com',
    phone: '+526121119188',
    whatsapp: '+526121119188',
  },
  url: PV_RESORT_URL,
  slotMethod: 'price_table',
  fetchBudget: 3,
  confidence: 'low',
  async fetchContent() {
    const home = await page(PV_HOME_URL);
    const resort = await page(PV_RESORT_URL);
    const kite = await page(PV_KITE_URL);
    return parsePalapasContent({ home, resort, kite });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    ctx.note('no slot source: casitas are booked by inquiry and the site prints no casita rates (checked 2026-10-12)');
    return [];
  },
};
