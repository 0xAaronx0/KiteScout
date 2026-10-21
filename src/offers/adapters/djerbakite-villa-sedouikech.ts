// ---------------------------------------------------------------------------
// Djerbakite villa, Sedouikech (Djerba, Tunisia) - a newly built single-storey villa with pool for up to 8 guests,
// rented out by Djerbakite, the IKO kite and wingfoil school at Sedouikech on the Djerba lagoon ("5 min du Club
// Med"), with a return shuttle between the villa and the school's water-sports base.
//
// Inclusion (Aaron's relaxed liveness rule, 2026-10-14): the villa page itself was last edited 2024-07-15 (Yoast
//   dateModified; published 2024-06-20), but the school's site is maintained in 2026: the price page /prix/ was
//   edited 2026-03-24 (dateModified, checked here) and the footer reads "©2026"; the lead's research also found a
//   2026-05-06 blog post and a new camp page of May 2026 (not re-fetched). Kite link: the villa is the school's own
//   offer with its shuttle to the kite base.
//
// Data path (checked 2026-10-14): www.djerbakite.com (WordPress + Elementor, French, server-rendered):
//   content  /hebergement/ (intro, feature boxes "Chambres", "Salles de bain", ..., two photo carousels with lazy
//            `data-src`, the "Plan de Situation" Google Maps embed titled 33°44'47.5"N 10°56'08.0"E -> spotCoords,
//            "Réservez Maintenant + 216 97 402 893"), /prix/ (school price list: courses, rental, shuttle, storage;
//            "Le prix repose sur 1 personne"), /localisation-transport-sejour-kitesurf-djerba/ (school at
//            Sedouikech on the lagoon, 5 min from Club Med, IKO instructors, hotel shuttle).
//   slots    none: the villa page prints no price and has no booking engine (booking by phone). fetchSlots re-reads
//            the villa page (memoised) and returns [] (offer = "price on request"); it notes when a euro amount
//            shows up there.
// robots.txt (2026-10-14): only /wp-admin/ disallowed.
// Requests per run: content 3, slots 1 (0 extra when content ran in the same process).
// Known limits: no villa price, no season or availability; the school's course / rental / shuttle / storage prices
//   are optional services (per person, as printed on /prix/), not slots. The map pin is the villa page's own map
//   ("Plan de Situation"); the school's base is a separate place on the lagoon.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, findPrices, ldOfType, parse } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.djerbakite.com';
export const DJK_VILLA_URL = `${SITE}/hebergement/`;
export const DJK_PRICES_URL = `${SITE}/prix/`;
export const DJK_LOCATION_URL = `${SITE}/localisation-transport-sejour-kitesurf-djerba/`;

// --- local helpers ------------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share the villa page */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text lines of the page's main content (header menu, footer, scripts, styles dropped). */
export function djkLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  const main = root.querySelector('main') ?? root.querySelector('article') ?? root;
  return main.innerHTML
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|figure|table|span|a)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

/** Yoast WebPage dates of a page. */
export function djkDates(html: string): { published: string | null; modified: string | null } {
  const wp = ldOfType(html, 'WebPage')[0];
  const d = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : null);
  return { published: d(wp?.datePublished), modified: d(wp?.dateModified) };
}

/** "33°44'47.5"N 10°56'08.0"E" in the Google Maps embed (title or q=) -> decimal degrees. */
export function djkMapCoords(html: string): { lat: number; lng: number } | null {
  const iframe = parse(html).querySelectorAll('iframe').find(f => /maps\.google\.com\/maps\?q=/.test(f.getAttribute('src') ?? ''));
  if (!iframe) return null;
  let q = '';
  try { q = decodeURIComponent((iframe.getAttribute('src') ?? '').match(/[?&]q=([^&]+)/)?.[1] ?? ''); } catch { q = ''; }
  const src = `${q} ${clean(iframe.getAttribute('title') ?? '')}`;
  const m = src.match(/(\d{1,2})°\s*(\d{1,2})['’]\s*([\d.]+)["”]\s*([NS])\s*(\d{1,3})°\s*(\d{1,2})['’]\s*([\d.]+)["”]\s*([EW])/);
  if (!m) return null;
  const dms = (d: string, mi: string, s: string, h: string) => (+d + +mi / 60 + +s / 3600) * (/[SW]/.test(h) ? -1 : 1);
  const round = (x: number) => Math.round(x * 1e6) / 1e6;
  return { lat: round(dms(m[1], m[2], m[3], m[4])), lng: round(dms(m[5], m[6], m[7], m[8])) };
}

/** Villa feature boxes: heading line followed by its text ("Chambres" -> "3 grandes chambres, dont 1 suite parentale"). */
export const DJK_FEATURES: Array<[string, string]> = [
  ['Chambres', 'Bedrooms'], ['Salles de bain', 'Bathrooms'], ['Salon & Salle à manger', 'Living and dining room'],
  ['Cuisine', 'Kitchen'], ['Climatisation', 'Air conditioning'], ['Piscine', 'Pool'], ['Jardin & Terrasse', 'Garden and terrace'],
  ['Stationnement', 'Parking'], ['Nettoyage', 'Cleaning'],
];
export function djkVillaFeatures(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [fr] of DJK_FEATURES) {
    const i = lines.findIndex(l => l === fr);
    if (i >= 0 && lines[i + 1]) out[fr] = lines[i + 1];
  }
  return out;
}

/** French feature texts as printed (2026-10-14) -> English; an unknown wording is kept in French. */
const DJK_FEATURE_EN: Record<string, string> = {
  '3 grandes chambres, dont 1 suite parentale': '3 large bedrooms, one of them a master suite',
  '2 salles d’eau avec douche et 1 salle d’eau': '2 shower rooms and 1 further washroom',
  'Espace lumineux avec grandes baies vitrées donnant sur la piscine': 'Bright space with large windows onto the pool',
  'Cuisine ouverte entièrement équipée': 'Open, fully equipped kitchen',
  'Chambres et salon climatisés': 'Air-conditioned bedrooms and living room',
  'Piscine 10m x 4m': 'Pool 10 x 4 m',
  'Grand jardin arboré et terrasse piscine de 200m² avec 2 grands parasols (3m x 3m) et 6 transats': 'Large garden with trees, 200 m² pool terrace with 2 large parasols (3 x 3 m) and 6 sun loungers',
  'Aire de stationnement intérieure pour 3 à 4 véhicules': 'Parking inside the grounds for 3 to 4 cars',
  'Villa nettoyée et désinfectée après chaque départ avec des produits non toxiques': 'Cleaned and disinfected after each stay with non-toxic products',
};
export const djkFeatureEn = (fr: string): string => DJK_FEATURE_EN[fr.replace(/'/g, '’')] ?? DJK_FEATURE_EN[fr] ?? fr;

/** Photos of the villa carousels (lazy `data-src`), page order, de-duplicated. */
export function djkImages(html: string): string[] {
  const out: string[] = [];
  for (const img of parse(html).querySelectorAll('img.swiper-slide-image')) {
    const u = img.getAttribute('data-src') ?? img.getAttribute('src') ?? '';
    if (!/^https:\/\/www\.djerbakite\.com\/wp-content\/uploads\/.+\.(?:jpe?g|png|webp)$/i.test(u) || out.includes(u)) continue;
    out.push(u);
  }
  return out;
}

export interface DjkPriceRow { section: string; label: string; quantity: string; price: string }
/** /prix/ table: section rows (colspan 3, bold) + "Descriptif | Quantité | Prix en Euro" rows. */
export function parseDjkPrices(html: string): DjkPriceRow[] {
  const table = parse(html).querySelectorAll('table').find(t => /Prix en Euro/i.test(t.text));
  if (!table) return [];
  const out: DjkPriceRow[] = [];
  let section = '';
  for (const tr of table.querySelectorAll('tr')) {
    const tds = tr.querySelectorAll('td');
    if (tds.length === 1) { const s = clean(tds[0].text); if (s) section = s; continue; }
    if (tds.length !== 3) continue;
    out.push({ section, label: clean(tds[0].text), quantity: clean(tds[1].text), price: clean(tds[2].text) });
  }
  return out;
}

/** The school services a villa guest would book, in English, with the printed EUR price (per person). */
export function djkOptionalServices(rows: DjkPriceRow[]): string[] {
  const pick: Array<[RegExp, (r: DjkPriceRow) => string]> = [
    [/^Stage Kitesurf objectif « (.+) »$/, r => `Kitesurf course "${r.label.match(/« (.+) »/)![1]}" (${r.quantity}): EUR ${r.price}`],
    [/^Coaching « Cours-privé » Kite$/, r => `Private kite coaching (${r.quantity}): EUR ${r.price}`],
    [/^Stage WingFoil objectif « (.+) »$/, r => `Wingfoil course "${r.label.match(/« (.+) »/)![1]}" (${r.quantity}): EUR ${r.price}`],
    [/^KiteSurf Twin\|strapless/, r => `Kitesurf rental, board + kite + accessories (${r.quantity}): EUR ${r.price}`],
    [/^Kite \(Toutes tailles\)$/, r => `Kite rental, all sizes (${r.quantity.replace(/semaine/i, 'week')}): EUR ${r.price}`],
    [/^Service Navette/, r => `Shuttle hotel / villa - water-sports base (return): EUR ${r.price}`],
    [/^Service Entreposage de matériel$/, r => `Equipment storage (${r.quantity.replace(/Semaine/i, 'week')}): EUR ${r.price}`],
    [/^Service Entreposage \+ Navette$/, r => `Equipment storage + shuttle (${r.quantity.replace(/Semaine/i, 'week')}): EUR ${r.price}`],
  ];
  const out: string[] = [];
  for (const r of rows) {
    if (!/^\d+$/.test(r.price)) continue;
    const hit = pick.find(([re]) => re.test(r.label));
    if (hit) out.push(hit[1](r));
  }
  return out;
}

export interface DjkPages { villa: string; prices: string; location: string }

export function parseDjerbakiteVillaContent(p: DjkPages): OfferContent {
  const lines = djkLines(p.villa);
  const features = djkVillaFeatures(lines);
  const intro = lines.find(l => /^Vous êtes kitesurfer et cherchez un hébergement/i.test(l)) ?? '';
  const guests = Number(intro.match(/jusqu.(\d+) personnes/i)?.[1]) || null;
  const phone = lines[lines.findIndex(l => /^Réservez Maintenant$/i.test(l)) + 1]?.match(/^\+\s*216[\d\s]+$/)?.[0].replace(/\s+/g, '') ?? null;
  const coords = djkMapCoords(p.villa);
  const villaDates = djkDates(p.villa);
  const priceDates = djkDates(p.prices);
  const priceRows = parseDjkPrices(p.prices);
  const optional = djkOptionalServices(priceRows);
  const locLines = djkLines(p.location);
  const loc = locLines.join(' ');
  const school = loc.match(/est située à (\w+), dans un cadre exceptionnel qu.est la lagune de Djerba à (\d+) min du Club Med/i);
  const iko = /moniteurs expérimentés diplômés IKO/i.test(loc);
  const shuttle = /navette aller-retour entre la villa et notre base nautique/i.test(intro);
  const featureEn = DJK_FEATURES.filter(([fr]) => features[fr]).map(([fr, en]) => `${en}: ${djkFeatureEn(features[fr])}`);

  const summary = [
    `A newly built single-storey villa for up to ${guests ?? 8} guests, rented out by Djerbakite, the kite and wingfoil school${school ? ` at ${school[1]} on the Djerba lagoon, ${school[2]} minutes from Club Med` : ' on the Djerba lagoon'}${iko ? ', whose instructors are IKO-certified' : ''}.`,
    `It has three large bedrooms (one master suite), two shower rooms plus a third washroom, an open fully equipped kitchen, air conditioning, a 10 x 4 m pool, a large garden with a 200 m² pool terrace and parking for 3 to 4 cars.`,
    `${shuttle ? 'The school runs a return shuttle between the villa and its water-sports base; ' : ''}the villa page prints no price, so stays are booked on request by phone.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Djerbakite Villa with Pool',
    summary,
    continent: 'Africa',
    country: 'Tunisia',
    region: 'Djerba, Medenine',
    spot: 'Sedouikech, Djerba',
    // villa page "Plan de Situation" Google Maps embed 33°44'47.5"N 10°56'08.0"E (2026-10-14)
    spotCoords: coords,
    itinerarySpots: [],
    durationDays: null,
    // location page: "adaptée à la pratique du kitesurf ... pour tous les niveaux"; courses from discovery to perfection
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: priceRows.some(r => /^Stage Kitesurf/i.test(r.label)),
    equipmentRental: priceRows.some(r => /^KiteSurf Twin|^Kite \(/i.test(r.label)),
    beginnerFriendly: /pour tous les niveaux|initiation/i.test(loc),
    includedServices: [
      'Whole villa for up to 8 guests',
      'Air conditioning',
      'Private pool and garden',
      'Parking for 3 to 4 cars',
      'Cleaning and disinfection after each stay',
    ],
    optionalServices: optional,
    accommodation: 'private villa with pool (3 bedrooms, up to 8 guests)',
    mealPlan: 'self_catering',
    languages: ['fr', 'en'], // site in French and English (/en/)
    rooms: [{
      name: 'Villa (up to 8 guests)',
      description: 'Contemporary single-storey villa in a quiet residential area, rented as a whole; shuttle to the Djerbakite water-sports base.',
      features: [...featureEn, `Price on request${phone ? ` (booking by phone ${phone})` : ''}`],
    }],
    imageUrls: djkImages(p.villa).slice(0, 40),
    heroVideoUrl: null,
    sourceUrl: DJK_VILLA_URL,
    bookingUrl: DJK_VILLA_URL,
    sourceText: [
      `villa page (published ${villaDates.published ?? '-'}, modified ${villaDates.modified ?? '-'}): ${intro}`,
      `features: ${DJK_FEATURES.filter(([fr]) => features[fr]).map(([fr]) => `${fr}: ${features[fr]}`).join(' | ')}`,
      `booking phone: ${phone ?? '-'}; map: ${coords ? `${coords.lat},${coords.lng}` : '-'}`,
      `school location: ${locLines.find(l => /est située à/i.test(l)) ?? ''} ${school ? `${school[1]}, ${school[2]} min from Club Med` : ''}`.trim(),
      `price list (modified ${priceDates.modified ?? '-'}; "Le prix repose sur 1 personne"): ${priceRows.map(r => `${r.label} ${r.quantity} ${r.price}`).join('; ')}`,
    ].join('\n'),
  };
}

// --- adapter ------------------------------------------------------------------------------------------
export const djerbakiteVillaSedouikech: OfferAdapter = {
  key: 'djerbakite-villa-sedouikech',
  name: 'Djerbakite Villa Sedouikech',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Djerbakite',
    websiteUrl: SITE,
    rootDomain: 'djerbakite.com',
    contactEmail: 'contact@djerbakite.com',
    whatsapp: '+216555510396',
    phone: '+21697402893', // villa page "Réservez Maintenant + 216 97 402 893"
  },
  url: DJK_VILLA_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'low', // no villa price on the site; villa page last edited 2024-07 (school site edited 2026)
  async fetchContent() {
    const villa = await page(DJK_VILLA_URL);
    if (!/villa/i.test(villa)) throw new Error('djerbakite-villa: villa text missing on /hebergement/ (layout changed?)');
    const prices = await page(DJK_PRICES_URL);
    const location = await page(DJK_LOCATION_URL);
    return parseDjerbakiteVillaContent({ villa, prices, location });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const villa = await page(DJK_VILLA_URL);
    if (!/villa/i.test(villa)) throw new Error('djerbakite-villa: villa text missing on /hebergement/ (layout changed?)');
    const prices = findPrices(djkLines(villa).join(' '));
    if (prices.length) ctx.note(`prices appeared on the villa page (${prices.slice(0, 5).map(x => x.raw).join(', ')}): extend the adapter`);
    return [];
  },
};
