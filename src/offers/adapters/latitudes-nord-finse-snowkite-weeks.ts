// ---------------------------------------------------------------------------
// Latitudes Nord (Michael "Mika" Charavin, French polar guide and snowkite instructor) - guided SNOWKITE trips
// (kiting on snow with skis, not on water) in Norway and Iceland, groups of 3 to 4. Five adapters share the parser in
// this file (the Finse camp); the four tours are thin files that import lnAdapter + LN_PRODUCTS from here:
//   camp  latitudes-nord-finse-snowkite-weeks           Finse (Hardangervidda / Skarvheimen), Norway: a "Découverte"
//                                                        week and a "Perfectionnement" week, day tours from a base
//   tour  latitudes-nord-snowkite-light-ryfylke-setesdal hut-to-hut snowkite touring on the Ryfylke and Setesdal heiane
//   tour  latitudes-nord-snowkite-cap-nord               road trip Alta - Magerøya (North Cape) - Porsanger - Kvaløya
//   tour  latitudes-nord-snowkite-nordkinn-varanger      road trip on the Nordkinn and Varanger peninsulas
//   tour  latitudes-nord-snowkite-iceland-volcanoes      4x4 road trip: Snæfellsnes, Langjökull / Kerlingarfjöll,
//                                                        Fjallabak, Eyjafjallajökull / Mýrdalsjökull
//
// Data path (checked 2026-10-19): ONE listing page, /prochains-voyages ("Séjours encadrés"; plain server-rendered HTML).
//   Seasons are <li class="type-text"> blocks ("Voyages Hiver 2026", "Voyages Printemps 2026", "Voyages Hiver 2027")
//   with one table row per trip: vignette /ups/images/journey/<id>/..., the title + "Du 24 février au 08 mars 2026",
//   the country and the trip sheet PDF /ups/files/journey/<id>/<name> <year>.pdf. A product is matched by its journey id
//   (45, 28, 46, 48; Finse 47 + 14) or, if the id changes, by its title. The markup is malformed (an unclosed img tag in
//   every row), so rows are cut out of the raw HTML instead of a DOM parse.
//   Prices, levels, group size and route are only in the PDFs (Word exports; we do not parse PDFs at run time): they
//   were read by hand on 2026-10-19 (pdftotext of honest-UA downloads) into LN_PDF below and are released for a slot
//   only while the row links the SAME PDF path; a new PDF gives price null + a note (re-read it).
// Slots: one per listed date that has not started (all four tours list only 2026 dates -> [] and the summary says the
//   next dates are not published yet; Finse lists Feb 2027 -> 2 slots). EUR per person ("2500 € / personne", base 4
//   participants), priceUnit 'package'; availability 'on_request' (booking by e-mail / phone, no engine).
// Photos (2026-10-21): the listing has ONE vignette per trip (all the live listings had 1-2 photos). The operator's
//   own "Carnets d'expéditions & photographies" (/carnets-et-photos/<slug>, plain HTML, 25-45 photos of 1920x1080
//   each in <li class="type-image"> with a French caption) hold the trip reports of the same products, so
//   fetchContent reads the report of THAT trip/region and adds a hand-picked subset (LN_STORIES: picked by caption
//   and by looking at the photos, best-first, ~10 per trip so the vision QC sees all of them; a pick is released
//   only while the page still shows it):
//     Finse        "Snowkite dans les massifs du Skarvheimen & du Hardanger" (story 13: Finse base camp, riders on the
//                   Hardangerjøkulen and the Finse lake, the Finsehytta hut, the village)
//     Ryfylke LIGHT "Nomads of the wind !" (story 36: hut-to-hut snowkite raid on the Setesdal / Ryfylke / Bykle
//                   heiane - Blåsjø, Vassdalstjørn, Jonstølen and Storsteinen huts; the site files it under Iceland
//                   but the captions are all southern Norway)
//     Varanger     "Snowkite en Péninsule du Varanger" (journey 38 images: the 2018 Varanger trip, kiting above
//                   Båtsfjord and the Barents Sea, the coast and villages)
//     Iceland      NONE: the two own Iceland reports ("Wilderness islandaise", "Quelques très beaux coins d'Islande")
//                   show the route areas only as summer trekking landscapes, which would mislead for a winter
//                   snowkite trip (lead decision 2026-10-21) -> stays at the listing vignette.
//     Cap Nord     NONE: no North Cape / Porsanger / Kvaløya report exists on the site (the Varanger report is the
//                   other end of Finnmark and is not reused) -> stays at the listing vignette.
//   A story page that fails only drops its photos (note), never the content.
// robots.txt (2026-10-19, re-checked 2026-10-21): only commented lines -> all allowed.
// Requests per run: listing 1 (memoised across the five adapters) + story pages in fetchContent: Finse 1, LIGHT 1,
//   Varanger 1, Iceland 0, Cap Nord 0 (4 for all five together; fetchSlots needs none of them).
// Known limits: the trip sheets link Google Photos albums (not used, not the own site); no spotCoords (the site
//   prints none); Finse meals: "un cuisinier s'occupe de nos repas" read as full board.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, iso, parse, todayIso } from '../parse.js';
import type { FetchContext, ItinerarySpot, OfferAdapter, OfferContent, OfferKind, OperatorRef, Slot } from '../types.js';

const SITE = 'https://www.latitudes-nord.fr';
export const LN_LIST_URL = `${SITE}/prochains-voyages`;

export const LN_OPERATOR: OperatorRef = {
  name: 'Latitudes Nord (Michael Charavin)',
  websiteUrl: `${SITE}/`,
  rootDomain: 'latitudes-nord.fr',
  contactEmail: 'michael.charavin@gmail.com',
  phone: '+33 6 13 93 72 95',
};

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const decode = (s: string): string => collapse(parse(`<p>${s}</p>`).text);

const FR_MONTHS: Record<string, number> = {
  janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, août: 8,
  septembre: 9, octobre: 10, novembre: 11, decembre: 12, décembre: 12,
};
const frMonth = (w: string | undefined): number | null => (w ? FR_MONTHS[w.toLowerCase()] ?? null : null);

/** "Du 24 février au 08 mars 2026", "Du 06 février au 13 février 2027", "Du 22 au 31 mars 2026", "du 1er ...". */
export function parseFrenchRange(text: string): { start: string; end: string } | null {
  const m = collapse(text).match(/du\s+(\d{1,2})(?:er)?\s*([a-zéû]+)?\s+au\s+(\d{1,2})(?:er)?\s+([a-zéû]+)\s+(20\d{2})/i);
  if (!m) return null;
  const m2 = frMonth(m[4]);
  const m1 = m[2] ? frMonth(m[2]) : m2;
  if (!m1 || !m2) return null;
  const y = Number(m[5]);
  return { start: iso(m1 > m2 ? y - 1 : y, m1, Number(m[1])), end: iso(y, m2, Number(m[3])) };
}

// --- listing parser ---------------------------------------------------------------------------
export interface LnRow {
  id: number | null;
  season: string;
  title: string;
  dateText: string;
  start: string | null;
  end: string | null;
  country: string;
  pdfPath: string | null;
  imagePath: string | null;
}

/**
 * The listing's markup is malformed (`<img ... alt="Présentation"</a>` never closes the img tag), which breaks a DOM
 * parse of the tables, so the rows are cut out of the raw HTML: season headings and <tr> blocks in document order.
 */
export function parseLnRows(html: string): LnRow[] {
  const out: LnRow[] = [];
  let season = '';
  const cell = (tr: string, cls: string): string | null => tr.match(new RegExp(`<td class="${cls}">([\\s\\S]*?)</td>`))?.[1] ?? null;
  for (const m of html.matchAll(/<h3 class="h3">([\s\S]*?)<\/h3>|<tr>([\s\S]*?)<\/tr>/g)) {
    if (m[1] !== undefined) { season = decode(m[1]); continue; }
    const tr = m[2];
    const titleCell = cell(tr, 'title');
    if (titleCell === null) continue;
    const dateText = decode(titleCell.match(/<span class="details">([\s\S]*?)<\/span>/)?.[1] ?? '');
    const title = decode(titleCell.replace(/<span class="details">[\s\S]*?<\/span>/, ''));
    const pdfRaw = (cell(tr, 'file') ?? '').match(/href="([^"]+)"/)?.[1] ?? null;
    const imgRaw = (cell(tr, 'image') ?? '').match(/src="([^"]+)"/)?.[1] ?? null;
    const idm = (pdfRaw ?? imgRaw ?? '').match(/\/journey\/(\d+)\//);
    const r = parseFrenchRange(dateText);
    out.push({
      id: idm ? Number(idm[1]) : null,
      season,
      title,
      dateText,
      start: r?.start ?? null,
      end: r?.end ?? null,
      country: decode(cell(tr, 'details') ?? ''),
      pdfPath: pdfRaw ? decode(pdfRaw) : null,
      imagePath: imgRaw ? decode(imgRaw) : null,
    });
  }
  return out;
}

// --- hand-read trip sheets (2026-10-19) ---------------------------------------------------------
export interface LnSheet {
  /** the PDF path these facts were read from (released only while the listing links it) */
  pdf: string;
  price: number | null;
  priceNote: string;
}

/** Facts from the trip-sheet PDFs, keyed by journey id. */
export const LN_PDF: Record<number, LnSheet> = {
  45: { pdf: '/ups/files/journey/45/Snowkite itinerant LIGHT Norvege RYFYLKE - SETESDAL_fiche presentation 2026.pdf', price: 2950,
    priceNote: 'from EUR 2,950 per person for 12 days on a basis of 4 participants, flights not included (+EUR 200 for 13 days; supplement for 3 participants)' },
  28: { pdf: '/ups/files/journey/28/Snowkite Norvege Cap Nord_fiche presentation 2026.pdf', price: 3200,
    priceNote: 'from EUR 3,200 per person for 10 days (EUR 3,420 for 11 days) on a basis of 4 participants, without cook, flights not included; cook option extra' },
  46: { pdf: '/ups/files/journey/46/Snowkite Norvege Varanger-Nordkinn_fiche presentation 2026.pdf', price: 3600,
    priceNote: 'EUR 3,600 per person with the cook option, on a basis of 4 participants, flights not included' },
  48: { pdf: "/ups/files/journey/48/Snowkite Exploration Volcans d'Islande_fiche presentation 2026.pdf", price: null,
    priceNote: 'price on request ("TARIFS : Me contacter")' },
  47: { pdf: '/ups/files/journey/47/Snowkite FINSE_DECOUVERTE_NORVEGE_fiche présentation 2027.pdf', price: 2500,
    priceNote: 'EUR 2,500 per person on a basis of 4 participants (+EUR 100 with 3), flights, train and any Oslo nights not included' },
  14: { pdf: '/ups/files/journey/14/Snowkite FINSE_PERFECTIONNEMENT_NORVEGE_fiche présentation 2027.pdf', price: 2500,
    priceNote: 'EUR 2,500 per person on a basis of 4 participants (+EUR 100 with 3), flights, train and any Oslo nights not included' },
};

// --- trip reports ("carnets et photos") -----------------------------------------------------------
export interface LnStoryImage { src: string; caption: string }

/** Photos of a /carnets-et-photos page: <li class="type-image"> blocks (cover included) with their caption. */
export function parseLnStoryImages(html: string): LnStoryImage[] {
  const out: LnStoryImage[] = [];
  for (const part of html.split(/<li class="type-/).slice(1)) {
    if (!part.startsWith('image')) continue;
    const src = part.match(/<img[^>]*\ssrc="([^"]+)"/)?.[1];
    if (!src || !/^\/ups\/images\//.test(src)) continue;
    out.push({ src: decode(src), caption: decode(part.match(/<p class="caption">\s*<span>([\s\S]*?)<\/span>/)?.[1] ?? '') });
  }
  return out;
}

export interface LnStory {
  /** path of the trip report on the own site */
  path: string;
  /** hand-picked file names (2026-10-21), best-first; released only while the page still shows them */
  pick: string[];
}

const fileName = (src: string): string => src.split('/').pop() ?? src;

/** The picked photos of one report, in pick order, as absolute URLs. */
export function lnStoryImageUrls(html: string, story: LnStory): string[] {
  const byName = new Map(parseLnStoryImages(html).map(i => [fileName(i.src), i.src]));
  return story.pick.map(n => byName.get(n)).filter((s): s is string => !!s).map(s => new URL(s, SITE).toString());
}

/** Trip reports per product key; picks avoid portraits, animals, roads, food and near-duplicates. */
export const LN_STORIES: Record<string, LnStory[]> = {
  'latitudes-nord-finse-snowkite-weeks': [{
    path: '/carnets-et-photos/snowkite-dans-le-skarvheimen-hardanger-norvege',
    pick: [
      'P1100745.jpg', // the Finsehytta hut above the Finse lake, Middalen glacier behind
      'IMG_0483.jpg', // cover: rider on the south summit of the Hardangerjøkulen
      'P1160365.jpg', // Bukkeskinn cirque, rider
      'P1040514bb.jpg', // freestyle in front of the Finsenuten
      'P1130401.jpg', // the village of Finse (1,222 m)
      'IMG_0437.jpg', // rider above the Blåisen glacier
      'P1030049.jpg', // rider on the Hardangerjøkulen summit
      'P1160273.jpg', // parawing on the Finse lake
      'P1100856.jpg', // two riders at dusk, Finsefetene moraines
      'IMG_0293.jpg', // Bukkeskinnsbotn slopes, rider
    ],
  }],
  'latitudes-nord-snowkite-light-ryfylke-setesdal': [{
    path: '/carnets-et-photos/nomads-of-the-wind',
    pick: [
      'P1080359 copie.jpg', // rider above the Kringlevatn hut, Blåsjø
      'P1080021 copie.jpg', // the Jonstølen hut
      'P1080216 copie.jpg', // natural half-pipe, Vassdalstjørn hut area
      'P1080660 copie.jpg', // strong wind on the plateau
      '26349130004_bac8ff346c_o (1).jpg', // living room of the Jonstølen hut
      'P1130336 copie.jpg', // riding on to the next hut, Blåsjø
      'P1070414 copie.jpg', // the Storsteinen huts
      'P1080715 copie.jpg', // rider, Valleheiane (Bossbu)
      '34752655265_f844f7ef67_o.jpg', // barns at the Bleskestadmoen hut
    ],
  }],
  'latitudes-nord-snowkite-nordkinn-varanger': [{
    path: '/carnets-et-photos/snowkite-en-peninsule-du-varanger-extremite-nord-est-de-la-norvege',
    pick: [
      'P1110776bis.jpg', // cover: rider in blowing snow
      'P1110842bis.jpg', // hills of Båtsfjordalen
      'P1120061bis.jpg', // rider on Mount Mattavarri
      'P1110778bis.jpg', // strong wind, snow drift
      'P1110830bis.jpg', // "perfect wind, perfect snow"
      'P1120238bis.jpg', // rider over birch scrub, south side
      'P1110861bis.jpg', // Båtsfjord fishing village
      'P1110993bis.jpg', // fjord and mountains, west of the peninsula
      'P1120030bis.jpg', // kiting up from the chalet towards Mattavarri
      'P1110852bis.jpg', // steep north coast of the peninsula
      'P1110785bis.jpg', // rider in rounded hills
    ],
  }],
};

// --- products -----------------------------------------------------------------------------------
export interface LnVariant { ids: number[]; titleRe: RegExp; slug: string; unit: string }
export interface LnProduct {
  key: string;
  name: string;
  kind: OfferKind;
  title: string;
  variants: LnVariant[];
  continent: string;
  country: string;
  region: string;
  spot: string;
  itinerarySpots: ItinerarySpot[];
  durationDays: number;
  skillLevels: string[];
  kiteLessons: boolean;
  accommodation: string;
  mealPlan: string | null;
  /** the trip sheet presents it as a yearly trip (Iceland is a one-off exploration project so far) */
  recurring: boolean;
  /** first summary sentences (from the trip sheet), the dates sentence is added from the listing */
  lead: string[];
  included: string[];
  optional: string[];
}

const NO = 'Norway';
const IS = 'Iceland';
const sp = (order: number, name: string, region: string, country = NO): ItinerarySpot => ({ name, country, region, order });

export const LN_PRODUCTS = {
  finse: {
    key: 'latitudes-nord-finse-snowkite-weeks',
    name: 'Latitudes Nord - Snowkite touring weeks in Finse (Discovery / Advanced)',
    kind: 'camp',
    title: 'Latitudes Nord Snowkite Touring Weeks, Finse',
    variants: [
      { ids: [47], titleRe: /finse.*d[ée]couverte|d[ée]couverte.*finse/i, slug: 'discovery', unit: 'Discovery week (snowkite touring, "débrouillé" level)' },
      { ids: [14], titleRe: /finse.*perfectionnement|perfectionnement.*finse/i, slug: 'advanced', unit: 'Advanced week (perfectionnement, intermediate level)' },
    ],
    continent: 'Europe', country: NO, region: 'Hardangervidda', spot: 'Finse, Hardangervidda',
    itinerarySpots: [],
    durationDays: 8,
    skillLevels: ['intermediate'],
    kiteLessons: true,
    accommodation: 'Apartment in Finse (kiting from the door), meals cooked by the team\'s cook',
    mealPlan: 'full_board', // "un cuisinier s'occupe de nos repas" (inferred: all meals)
    recurring: true,
    lead: [
      'Latitudes Nord, run by French polar guide Michael Charavin, holds two snowkite touring weeks - kiting on snow with skis, not on water - in Finse, the railway village at 1,222 m between the Hardangerjøkulen glacier and the Skarvheimen mountains in Norway.',
      'From an apartment in the village (with a cook) a group of 3 to 4 goes out every day on wind-powered tours over frozen lakes, valleys and summits, sometimes 20 to 40 km downwind with the train back; the first week is a discovery of snowkite touring for riders who can already kite on snow, the second a coaching week for intermediate riders.',
    ],
    included: ['7 nights in an apartment in Finse', 'Meals cooked by the team\'s cook', 'Guiding and coaching by Michael Charavin (state-certified guide, snowkite instructor)'],
    optional: ['A snowkite course at a school beforehand is required for non-kiters'],
  },
  light: {
    key: 'latitudes-nord-snowkite-light-ryfylke-setesdal',
    name: 'Latitudes Nord - Snowkite itinerant "LIGHT", Ryfylke & Setesdal plateaus',
    kind: 'tour',
    title: 'Latitudes Nord Snowkite Hut-to-Hut Tour, Ryfylke & Setesdal',
    variants: [{ ids: [45], titleRe: /light|ryfylke|setesdal/i, slug: 'light', unit: 'Hut-to-hut snowkite tour (12-13 days from France)' }],
    continent: 'Europe', country: NO, region: 'Ryfylke & Setesdal, southern Norway', spot: 'Ryfylkeheiane, Rogaland',
    itinerarySpots: [sp(1, 'Ryfylkeheiane', 'Rogaland'), sp(2, 'Setesdalsheiane', 'Agder')],
    durationDays: 13,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: false,
    accommodation: 'Mountain huts of the Norwegian hut network, a different hut most days',
    mealPlan: null,
    recurring: true,
    lead: [
      'Latitudes Nord, run by French polar guide Michael Charavin, leads a light-weight snowkite tour - kiting on snow with skis, not on water - from hut to hut across the Ryfylke and Setesdal plateaus, the southernmost mountains of Norway.',
      'A group of 3 to 4 travels without sleds, carrying only a minimum of gear so it can ride ridges, bowls and cornices, and moves on to a new hut of the Norwegian hut network most days; it is meant for regular snowkiters with ski-touring basics (intermediate to expert).',
    ],
    included: ['Guiding by Michael Charavin (state-certified guide, snowkite instructor)', 'Hut nights along the route'],
    optional: [],
  },
  capnord: {
    key: 'latitudes-nord-snowkite-cap-nord',
    name: 'Latitudes Nord - Snowkite exploration at the North Cape',
    kind: 'tour',
    title: 'Latitudes Nord Snowkite Exploration, North Cape',
    variants: [{ ids: [28], titleRe: /cap nord/i, slug: 'cap-nord', unit: 'Snowkite road trip (10-11 days from France)' }],
    continent: 'Europe', country: NO, region: 'Finnmark', spot: 'Alta, Finnmark',
    itinerarySpots: [sp(1, 'Alta', 'Finnmark'), sp(2, 'Magerøya', 'Finnmark'), sp(3, 'Porsangerhalvøya', 'Finnmark'), sp(4, 'Kvaløya', 'Finnmark (Hammerfest)')],
    durationDays: 11,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: false,
    accommodation: 'Cosy lodgings near the coast, changing along the route',
    mealPlan: null,
    recurring: true,
    lead: [
      'Latitudes Nord, run by French polar guide Michael Charavin, leads a snowkite road trip - kiting on snow with skis, not on water - in the far north of Norway, above 70° north.',
      'Starting from Alta, a group of 3 to 4 drives (with a ferry crossing) to a different area every day: Magerøya island with the North Cape, the coasts of the Porsanger peninsula and Kvaløya, the island of Hammerfest, for day tours and downwinds above the fjords; it suits intermediate to expert snowkiters, and a cook can join the team.',
    ],
    included: ['Guiding by Michael Charavin (state-certified guide, snowkite instructor)', 'Vehicles and ferry transfers on the route', 'Lodgings along the route'],
    optional: ['Cook option (assistant cook in the staff)'],
  },
  varanger: {
    key: 'latitudes-nord-snowkite-nordkinn-varanger',
    name: 'Latitudes Nord - Snowkite exploration on the Nordkinn & Varanger peninsulas',
    kind: 'tour',
    title: 'Latitudes Nord Snowkite Exploration, Nordkinn & Varanger',
    variants: [{ ids: [46], titleRe: /varanger|nordkinn/i, slug: 'nordkinn-varanger', unit: 'Snowkite road trip (11 days from France)' }],
    continent: 'Europe', country: NO, region: 'Finnmark', spot: 'Nordkinnhalvøya, Finnmark',
    itinerarySpots: [sp(1, 'Nordkinnhalvøya', 'Finnmark'), sp(2, 'Varangerhalvøya', 'Finnmark')],
    durationDays: 11,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: false,
    accommodation: 'Cosy lodgings near the coast, changing along the route',
    mealPlan: null,
    recurring: true,
    lead: [
      'Latitudes Nord, run by French polar guide Michael Charavin, leads a snowkite road trip - kiting on snow with skis, not on water - on the Nordkinn and Varanger peninsulas in north-east Norway, on the shores of the Barents Sea.',
      'A group of 3 to 4 drives (with ferry transfers) to a different area every day for day tours and downwinds over rounded hills above the Arctic Ocean, with a cook in the team; it suits intermediate to expert snowkiters.',
    ],
    included: ['Guiding by Michael Charavin (state-certified guide, snowkite instructor)', 'Cook in the team', 'Vehicles and ferry transfers on the route', 'Lodgings along the route'],
    optional: [],
  },
  iceland: {
    key: 'latitudes-nord-snowkite-iceland-volcanoes',
    name: 'Latitudes Nord - Snowkite exploration on Iceland\'s volcanoes',
    kind: 'tour',
    title: 'Latitudes Nord Snowkite Exploration, Iceland Volcanoes',
    variants: [{ ids: [48], titleRe: /islan|iceland|volcan/i, slug: 'iceland-volcanoes', unit: 'Snowkite 4x4 road trip (15 days)' }],
    continent: 'Europe', country: IS, region: 'Southern Iceland', spot: 'Snæfellsnes, West Iceland',
    itinerarySpots: [
      sp(1, 'Snæfellsnes', 'West Iceland', IS),
      sp(2, 'Langjökull', 'Highlands', IS),
      sp(3, 'Kerlingarfjöll', 'Highlands', IS),
      sp(4, 'Fjallabak', 'Highlands', IS),
      sp(5, 'Eyjafjallajökull', 'South Iceland', IS),
      sp(6, 'Mýrdalsjökull', 'South Iceland', IS),
    ],
    durationDays: 15,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: false,
    accommodation: 'Guesthouses and huts, changing about every 3 days',
    mealPlan: null,
    recurring: false,
    lead: [
      'Latitudes Nord, run by French polar guide Michael Charavin, leads an exploratory snowkite trip - kiting on snow with skis, not on water - to the volcanoes of southern Iceland.',
      'A group of 3 to 4 travels by 4x4 from the Snæfellsnes peninsula and its glacier volcano to the Langjökull ice cap and the geothermal valleys of Kerlingarfjöll, on to Fjallabak and Hekla, and finally tries the high volcanoes Eyjafjallajökull and Mýrdalsjökull, with day tours and a change of lodging about every three days; it suits intermediate to expert snowkiters.',
    ],
    included: ['Guiding by Michael Charavin (state-certified guide, snowkite instructor)', '4x4 vehicle', 'Lodgings along the route'],
    optional: [],
  },
} satisfies Record<string, LnProduct>;

// --- slots ------------------------------------------------------------------------------------
export interface LnMatch { variant: LnVariant; row: LnRow }

/** Rows of one product: by journey id, else by title (a tour never takes a Finse row). */
export function lnMatches(rows: LnRow[], product: LnProduct): LnMatch[] {
  const out: LnMatch[] = [];
  for (const row of rows) {
    const v = product.variants.find(x => row.id !== null && x.ids.includes(row.id)) ?? product.variants.find(x => x.titleRe.test(row.title));
    if (v && !(product.kind === 'tour' && /finse/i.test(row.title))) out.push({ variant: v, row });
  }
  return out;
}

export function buildLnSlots(rows: LnRow[], product: LnProduct, today: string, notes: string[] = []): Slot[] {
  const out: Slot[] = [];
  for (const { variant, row } of lnMatches(rows, product)) {
    if (!row.start || !row.end || row.start < today) continue;
    const sheet = row.id !== null ? LN_PDF[row.id] : undefined;
    const known = !!sheet && sheet.pdf === row.pdfPath;
    if (!known) notes.push(`${product.key}: trip sheet not hand-read yet (${row.pdfPath ?? 'no PDF'}): price left empty, re-read the PDF`);
    const price = known ? sheet!.price : null;
    out.push({
      key: `${row.start}|${variant.slug}`,
      startDate: row.start,
      endDate: row.end,
      unit: variant.unit,
      price,
      currency: price !== null ? 'EUR' : null,
      priceUnit: price !== null ? 'package' : null,
      priceBasis: price !== null ? 'person' : null,
      occupancy: null,
      availability: 'on_request',
      availabilityText: `Request by e-mail or phone; group of 3 to 4${known ? `; ${sheet!.priceNote}` : ''}`,
      spotsLeft: null,
    });
  }
  return out;
}

// --- content ----------------------------------------------------------------------------------
const day = (d: string, year = true): string => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });

/** `stories`: report path -> its HTML (the photos of LN_STORIES[product.key]); missing pages add no photos. */
export function parseLnContent(html: string, product: LnProduct, today = todayIso(), stories: Record<string, string> = {}): OfferContent {
  const rows = parseLnRows(html);
  const matches = lnMatches(rows, product);
  const future = matches.filter(m => m.row.start && m.row.start >= today);
  const past = matches.filter(m => m.row.start && m.row.start < today);
  const sheets = matches.map(m => (m.row.id !== null ? LN_PDF[m.row.id] : undefined)).filter((s): s is LnSheet => !!s);
  const priceSentence = sheets[0]
    ? sheets[0].price !== null ? `Price per the trip sheet: ${sheets[0].priceNote}.` : 'The price is on request.'
    : '';
  const range = (m: LnMatch): string => `${day(m.row.start!, false)} to ${day(m.row.end!)}`;
  let dates: string;
  if (future.length) {
    dates = `Next dates: ${future.map(m => `${range(m)}${product.variants.length > 1 ? ` (${m.variant.slug === 'discovery' ? 'discovery week' : 'advanced week'})` : ''}`).join(', ')}; booking by request.`;
  } else if (past.length) {
    const y = Number(past[past.length - 1].row.start!.slice(0, 4));
    dates = `${product.recurring ? 'Runs every year; ' : ''}${y + 1} dates not yet published (${y}: ${past.map(range).join(', ')}).`;
  } else {
    dates = 'Dates are announced on the operator\'s "Séjours encadrés" page; booking by request.';
  }
  const imageUrls = [...new Set([
    ...matches.map(m => m.row.imagePath).filter((p): p is string => !!p).map(p => new URL(p, SITE).toString()),
    ...(LN_STORIES[product.key] ?? []).flatMap(st => (stories[st.path] ? lnStoryImageUrls(stories[st.path], st) : [])),
  ])];
  const pdfs = [...new Set(matches.map(m => m.row.pdfPath).filter((p): p is string => !!p))];

  return {
    kind: product.kind,
    title: product.title,
    summary: [...product.lead, priceSentence, dates].filter(Boolean).join(' '),
    continent: product.continent,
    country: product.country,
    region: product.region,
    spot: product.spot,
    spotCoords: null,
    itinerarySpots: product.itinerarySpots,
    durationDays: product.durationDays,
    skillLevels: product.skillLevels,
    kiteLessons: product.kiteLessons,
    equipmentRental: false,
    beginnerFriendly: false,
    includedServices: product.included,
    optionalServices: product.optional,
    accommodation: product.accommodation,
    mealPlan: product.mealPlan,
    languages: ['fr', 'en'],
    rooms: [],
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: LN_LIST_URL,
    bookingUrl: pdfs[0] ? new URL(pdfs[0], SITE).toString() : LN_LIST_URL,
    sourceText: [
      ...matches.map(m => `${m.row.season} | #${m.row.id} ${m.row.title} | ${m.row.dateText} | ${m.row.country} | ${m.row.pdfPath}`),
      ...sheets.map(s => `trip sheet ${s.pdf}: ${s.priceNote}`),
    ].join('\n'),
  };
}

export async function fetchLnSlots(product: LnProduct, today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const rows = parseLnRows(await page(LN_LIST_URL));
  if (!rows.length) throw new Error('latitudes-nord: no trip rows on /prochains-voyages (layout changed?)');
  const notes: string[] = [];
  const slots = buildLnSlots(rows, product, today, notes);
  for (const n of notes) ctx?.note(n);
  const matches = lnMatches(rows, product);
  if (!matches.length) ctx?.note(`${product.key}: not on the listing page this season`);
  else if (!slots.length) ctx?.note(`${product.key}: listed dates are past (${matches.map(m => m.row.dateText).join('; ')}); next dates not published yet`);
  return slots;
}

export function lnAdapter(product: LnProduct): OfferAdapter {
  return {
    key: product.key,
    name: product.name,
    kind: product.kind,
    disciplines: ['snowkite'], // every Latitudes Nord product we ingest is a snowkite trip
    operator: LN_OPERATOR,
    url: LN_LIST_URL,
    slotMethod: 'html_dates',
    instantBooking: false,
    fetchBudget: 2 + (LN_STORIES[product.key]?.length ?? 0),
    confidence: 'medium', // prices hand-read from the trip-sheet PDFs
    async fetchContent(ctx) {
      const html = await page(LN_LIST_URL);
      const stories: Record<string, string> = {};
      for (const st of LN_STORIES[product.key] ?? []) {
        try {
          stories[st.path] = await page(`${SITE}${st.path}`);
          if (!lnStoryImageUrls(stories[st.path], st).length) ctx?.note(`${product.key}: no picked photo left on ${st.path} (re-pick)`);
        } catch (e) {
          ctx?.note(`${product.key}: trip report ${st.path} failed (${(e as Error).message}); listing photo only`);
        }
      }
      return parseLnContent(html, product, todayIso(), stories);
    },
    fetchSlots: ctx => fetchLnSlots(product, todayIso(), ctx),
  };
}

// --- adapter (the four tours live in latitudes-nord-snowkite-*.ts) ------------------------------
export const latitudesNordFinseSnowkiteWeeks: OfferAdapter = lnAdapter(LN_PRODUCTS.finse);
