// ---------------------------------------------------------------------------
// Rules of the cruise media selection, shared by apply (media-candidates.ts) and the automatic selection
// (media-auto.ts). No I/O here, so test/pipeline/media-selection.test.ts can pin them.
//
//   selectionImageRows  rule 1: apply rebuilds an offer's images from EVERY sorted selected/applied row
//   planAutoFill        rule 2: the live set stays as it is (same photos, same order, same hero); new photos only go
//                       behind it, up to MAX_MEDIA together with the hero video
//   isOwnSiteImage, photoStem, fileNameFlag, cornerCutout   rule 3: the provider's own photos, no second copy of one
//   placeTerms, namedPlaces, fileNamePlaces, foreignCountries, acceptVerdict, acceptShared, boatMismatch
//                       rule 4: no photo of another destination or another boat, in doubt leave it out
// ---------------------------------------------------------------------------

/** The app shows at most 12 media per listing: images and the hero video together. */
export const MAX_MEDIA = 12;

/**
 * The offer's image set as apply rebuilds it: EVERY sorted image row that is 'selected' (pending) OR already
 * 'applied', best-first. Building from the pending rows alone made a RETRY of a few failed downloads REPLACE the whole
 * images array with just those stragglers (sardinia went 10 images → 1, 2026-07-10).
 */
export function selectionImageRows<T extends { kind: string; status: string; sort: number | null }>(rows: T[]): T[] {
  return rows
    .filter(r => r.kind === 'image' && (r.status === 'selected' || r.status === 'applied') && r.sort !== null)
    .sort((a, b) => (a.sort ?? 99) - (b.sort ?? 99))
    .slice(0, MAX_MEDIA);
}

export interface MediaRow {
  id: string;
  kind: string;
  url: string;
  status: string;
  sort: number | null;
}

export interface FillPlan {
  /** why nothing is added; null when the plan can be written */
  skip: string | null;
  /** the live photos as applied rows in live order (id null = no row yet); empty when the rows already say so */
  base: Array<{ id: string | null; url: string; sort: number; hero: boolean }>;
  /** applied rows that are no longer live: they leave the set, or the next apply would bring them back */
  stale: string[];
  /** new photos, 'selected' behind the live set */
  picks: Array<{ id: string; sort: number }>;
  /** free places before picking */
  room: number;
}

/**
 * Rule 2 (Aaron 2026-11-02): a curated set is never replaced, the automatic selection only fills up behind the
 * existing sort, up to MAX_MEDIA combined; a chosen hero image or hero video stays. The live images are the truth:
 * they become the applied base (rule 1 makes apply rebuild from it), and `picks` (candidate ids, best first) go behind.
 */
export function planAutoFill(input: { liveUrls: string[]; rows: MediaRow[]; hasVideo: boolean; picks: string[] }): FillPlan {
  const { liveUrls, rows, hasVideo } = input;
  const none = (skip: string): FillPlan => ({ skip, base: [], stale: [], picks: [], room: 0 });
  if (rows.some(r => r.status === 'selected')) return none('selection pending (apply runs first)');
  if (new Set(liveUrls).size !== liveUrls.length) return none('live set repeats a photo');
  const room = MAX_MEDIA - (hasVideo ? 1 : 0) - liveUrls.length;
  if (room <= 0) return none('full');

  const images = rows.filter(r => r.kind === 'image');
  const live = new Set(liveUrls);
  const byUrl = new Map(images.map(r => [r.url, r]));
  const liveRows = liveUrls.map(u => byUrl.get(u));
  const sorts = liveRows.map(r => (r?.status === 'applied' ? r.sort : null));
  // the rows already hold the live set in live order (gaps in sort are fine: apply renumbers)
  const consistent = sorts.every((s, i) => s !== null && (i === 0 || s > (sorts[i - 1] as number)));
  const base = consistent ? [] : liveUrls.map((url, i) => ({ id: liveRows[i]?.id ?? null, url, sort: i, hero: i === 0 }));
  const next = consistent ? (sorts.length ? (sorts[sorts.length - 1] as number) + 1 : 0) : liveUrls.length;
  const stale = images.filter(r => r.status === 'applied' && r.sort !== null && !live.has(r.url)).map(r => r.id);

  const free = new Set(images.filter(r => r.status === 'candidate' && !live.has(r.url)).map(r => r.id));
  const picks = [...new Set(input.picks)].filter(id => free.has(id)).slice(0, room).map((id, j) => ({ id, sort: next + j }));
  return { skip: null, base, stale, picks, room };
}

// ---------------------------------------------------------------------------
// Rule 3: own photos, one copy each
// ---------------------------------------------------------------------------

// Site builders serve the provider's own uploads from their CDN (seen in offer_media_candidates 2026-11-02:
// wixstatic, squarespace-cdn, cdn-website (Duda), website-files (Webflow), tildacdn). Third-party hosts are not the
// provider's site: bstoked.azureedge.net, cdninstagram, ytimg, googleusercontent (also Google review photos), maps.
const SITE_BUILDER_CDN_RE = /(?:^|\.)(?:wixstatic\.com|squarespace-cdn\.com|squarespace\.com|cdn-website\.com|website-files\.com|webflow\.com|tildacdn\.(?:com|net)|jimcdn\.com|editmysite\.com|wsimg\.com|shopify\.com)$/i;

const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, '');

/** True when the image is served by the provider's own site (its domains, or its site builder's CDN). */
export function isOwnSiteImage(url: string, siteHosts: string[]): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  let host = bareHost(u.hostname);
  // Jetpack/Photon proxy: i0.wp.com/<origin host>/<path>
  if (/^i[0-3]\.wp\.com$/.test(host)) host = bareHost(u.pathname.split('/')[1] ?? '');
  const own = siteHosts.map(bareHost).filter(Boolean);
  if (own.some(h => host === h || host.endsWith(`.${h}`))) return true;
  return SITE_BUILDER_CDN_RE.test(host);
}

/** decoded file name without extension, e.g. "Kite-spot-Tobago-Cays-650" */
function baseName(url: string): string {
  let path: string;
  try { path = new URL(url).pathname; } catch { path = url.split('?')[0]; }
  let name = path.split('/').filter(Boolean).pop() ?? '';
  for (let i = 0; i < 2; i++) {
    try { name = decodeURIComponent(name); } catch { break; }
  }
  return name.replace(/\+/g, ' ').replace(/\.(?:jpe?g|png|webp|gif|avif)$/i, '').trim();
}

// names that many different photos share (Squarespace "image-asset", camera-less "photo-3"): no stem dedup for them
const GENERIC_STEM_RE = /^(?:image|image-asset|img|photo|picture|pic|foto|bild|unnamed|untitled|file|default|original|large|full|thumb|thumbnail|banner|header|hero|bg|background|slide|slider|gallery|cover)[-_ ]?\d{0,3}$/;

/**
 * The file a person would call "the same photo": WordPress size, scale and edit copies ("-1200x800", "-scaled",
 * "-e1778065435626") and the folder are dropped, so /v2/wp-content/uploads/G0351099-scaled-e17780.jpg and
 * /wp-content/uploads/G0351099.jpg match. null for names too generic to tell photos apart (pixels decide then).
 */
export function photoStem(url: string): string | null {
  let name = baseName(url).toLowerCase();
  for (;;) {
    const cut = name.replace(/-(?:\d{2,4}x\d{2,4}|scaled|rotated|e\d{9,})$/, '');
    if (cut === name) break;
    name = cut;
  }
  if (name.length < 5 || GENERIC_STEM_RE.test(name)) return null;
  return name;
}

// Seen in the dry runs over all listings (2026-11-02 / -10): screenshots ("Screenshot 2023-02-27 at 21.27.53", of
// another provider's yacht), Flickr downloads ("<photo id>_<secret>[_size]", "6200147916_4f88059655_b") and text
// graphics the model took for photos ("2026 schedule kitesurf web", "Grenadines-windguru-statistic"). Facebook's
// numeric names ("323780955_2250486811797500_...") are the provider's own uploads and stay.
const SCREENSHOT_RE = /screen[\s_-]?shot|bildschirmfoto|capture[\s_-]d[\s_-]?[eé]cran|schermata|captura[\s_-]de[\s_-]pantalla/i;
const FLICKR_RE = /(?:^|[^0-9a-z])\d{8,11}_[0-9a-f]{10}(?:_[a-z0-9])?(?:[^0-9a-z]|$)/i;
const TEXT_GRAPHIC_WORDS = new Set([
  'schedule', 'schedules', 'timetable', 'pricelist', 'prices', 'pricing', 'flyer', 'poster', 'brochure', 'infographic',
  'map', 'maps', 'windguru', 'windfinder', 'statistic', 'statistics', 'chart',
]);

/** Why the file name alone rules the image out (not the provider's own photo, or not a photo), or null. */
export function fileNameFlag(url: string): string | null {
  const name = baseName(url);
  if (SCREENSHOT_RE.test(name)) return 'screenshot file name';
  if (FLICKR_RE.test(name)) return 'Flickr file name';
  if (words(name).some(w => TEXT_GRAPHIC_WORDS.has(w))) return 'text graphic file name';
  return null;
}

/** Side of the small copy cornerCutout reads, in pixels; a corner is the CORNER x CORNER patch in each corner. */
export const CUTOUT_SIZE = 64;
const CORNER = 6;

/**
 * True when all four corners are the same flat white: a product cut-out, a round team portrait or a graphic, not a
 * photo. `rgb` is the image as CUTOUT_SIZE x CUTOUT_SIZE RGB pixels, transparency flattened onto white. In the dry run
 * of 2026-11-10 (1073 images) exactly 11 had such corners, all of them merch, cut-outs, a round portrait or a boat plan;
 * the next real photo was a dark night shot.
 */
export function cornerCutout(rgb: Uint8Array): boolean {
  const n = CUTOUT_SIZE;
  for (const [cx, cy] of [[0, 0], [n - CORNER, 0], [0, n - CORNER], [n - CORNER, n - CORNER]]) {
    for (let y = cy; y < cy + CORNER; y++) for (let x = cx; x < cx + CORNER; x++) {
      const i = (y * n + x) * 3;
      if (rgb[i] < 245 || rgb[i + 1] < 245 || rgb[i + 2] < 245) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Rule 4: the place
// ---------------------------------------------------------------------------

// Words of a destination that do not tell places apart ("Green Island", "Spanish Point", "Saint Vincent and the ...").
const GEO_STOP = new Set((
  'and the of de del la las los el le les da do dos das di des du van von ' +
  'island islands isla islas isle isles ilha ilhas ile iles cay cays cayo cayos key keys atoll ' +
  'bay bahia baia beach playa praia plage point punta ponta cape cabo harbour harbor port porto marina ' +
  'north south east west northern southern eastern western central upper lower ' +
  'grand great little petit petite big new old saint sainte santa santo sao san mount monte ' +
  'green blue white black red golden palm union spanish british french dutch american ' +
  'coast lagoon lagoa reef sound river lake gulf golfo sea ocean channel strait peninsula region province ' +
  'republic kingdom united states state territory national park brothers seven hermanos ' +
  'kite kites kiting kitesurf kitesurfing kiteboard kiteboarding wingfoil wingfoiling wing foil foiling surf sailing ' +
  'cruise cruises safari catamaran yacht boat trip tour week days luxury adventure'
).split(/\s+/));

function words(s: string): string[] {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

/**
 * The words that name an offer's destination: country, region, title and itinerary stops, generic ones dropped. A
 * place of several words also comes as one joined term ("unionisland"): its words alone are generic, together they
 * are a place (UnionIsland_Kitecruise_Jan23 on a Sardinia listing, 2026-11-10).
 */
export function placeTerms(o: { country?: string | null; region?: string | null; title?: string | null; spots?: Array<string | null | undefined> }): string[] {
  const out = new Set<string>();
  for (const src of [o.country, o.region, o.title, ...(o.spots ?? [])]) {
    for (const w of words(src ?? '')) if (w.length >= 4 && !GEO_STOP.has(w)) out.add(w);
  }
  for (const src of [o.country, o.region, ...(o.spots ?? [])]) {
    const ws = words(src ?? '').filter(w => !NAME_STOP.has(w));
    const joined = ws.join('');
    if (ws.length >= 2 && joined.length >= 8) out.add(joined);
  }
  return [...out];
}

/** a and b differ by at most one inserted, deleted or changed letter ("mayrau" for "mayreau") */
function oneEditApart(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length < b.length) [a, b] = [b, a];
  let i = 0;
  while (i < b.length && a[i] === b[i]) i++;
  return a.slice(i + 1) === b.slice(a.length === b.length ? i + 1 : i);
}

/**
 * The terms an image's file name names ("the-trip-turks-3.jpg" names "turks"): plural-tolerant; terms of 6+ letters
 * also inside a word and with one letter off (the provider's own spelling, "Mayrau" for Mayreau); terms of 8+ letters
 * also across words ("UnionIsland", "Union-Island" for "unionisland").
 */
export function namedPlaces(url: string, terms: string[]): string[] {
  const ws = words(baseName(url));
  const joined = ws.join('');
  return terms.filter(t => ws.some(w => w === t || w === `${t}s` || `${w}s` === t
    || (t.length >= 6 && (w.includes(t) || oneEditApart(w, t))))
    || (t.length >= 8 && joined.includes(t)));
}

/**
 * Where a file name says a photo belongs, for a listing and the provider's other destinations. Only own terms that no
 * other destination shares count as naming this listing: "greece" in "Cruises-Cyclades-KitegreeceLagoon-40" names
 * every Greek trip of Kitegreece, so on its Petali listing that file names the Cyclades and nothing of its own
 * (2026-11-10).
 */
export function fileNamePlaces(url: string, ownTerms: string[], otherTerms: string[]): { own: string[]; other: string[] } {
  const others = new Set(otherTerms);
  const own = new Set(ownTerms);
  return {
    own: namedPlaces(url, ownTerms.filter(t => !others.has(t))),
    other: namedPlaces(url, otherTerms.filter(t => !own.has(t))),
  };
}

// Every country by its English name (ICU), for file names that name a country outside the provider's own listings:
// a Red Sea safari of a kite school in Portugal showed "...-kitesurf-school-portugal.jpeg" (2026-11-02). Region codes
// that are not places are left out, and so are names that are also given names or common words in file names.
const NOT_A_COUNTRY = new Set(['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ']);
const AMBIGUOUS_COUNTRY = new Set(['chad', 'jordan', 'georgia', 'jersey', 'niger', 'guinea']);
const COUNTRY_ALIASES: Array<[string, string]> = [
  ['Holland', 'Netherlands'], ['England', 'United Kingdom'], ['Scotland', 'United Kingdom'], ['Wales', 'United Kingdom'],
  ['Turkey', 'Türkiye'], ['Cabo Verde', 'Cape Verde'], ['Ivory Coast', "Côte d'Ivoire"],
];
const NAME_STOP = new Set(['and', 'the', 'of', 'u', 's']);
// "St. Lucia" needs the saint in the file name too: "lucia" or "martin" alone is more often a photographer's name
const SAINT = '~saint';
const SAINT_WORDS = ['st', 'saint', 'sainte', 'san', 'santa'];

let countryCache: Array<{ name: string; keys: string[] }> | null = null;
function countries(): Array<{ name: string; keys: string[] }> {
  if (countryCache) return countryCache;
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const out: Array<{ name: string; keys: string[] }> = [];
  const keysOf = (name: string) => words(name).filter(w => !NAME_STOP.has(w)).map(w => (SAINT_WORDS.includes(w) ? SAINT : w));
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const a of A) for (const b of A) {
    const code = a + b;
    let name: string | undefined;
    try { name = names.of(code); } catch { continue; }
    if (!name || name === code || NOT_A_COUNTRY.has(code)) continue;
    // "Myanmar (Burma)", "Congo - Kinshasa", "Hong Kong SAR China": the first part names it
    name = name.replace(/\s*\(.*?\)/g, '').replace(/\s+-\s+.*$/, '').replace(/\s+SAR China$/, '');
    out.push({ name, keys: keysOf(name) });
  }
  for (const [alias, name] of COUNTRY_ALIASES) out.push({ name, keys: keysOf(alias) });
  countryCache = out.filter(c => c.keys.length && !(c.keys.length === 1 && AMBIGUOUS_COUNTRY.has(c.keys[0])));
  return countryCache;
}

const hasWord = (ws: Set<string>, k: string) => (k === SAINT ? SAINT_WORDS.some(w => ws.has(w)) : ws.has(k));

/**
 * The countries a file name names that are not the listing's own ("...-school-portugal.jpeg" on an Egypt listing).
 * Whole words, plural-tolerant ("Portugals-Winds"); a country is the listing's own when every word of its name is a
 * word of the listing's country, region, title or stops.
 */
export function foreignCountries(url: string, o: { country?: string | null; region?: string | null; title?: string | null; spots?: Array<string | null | undefined> }): string[] {
  const ws = new Set(words(baseName(url)));
  const has = (k: string) => hasWord(ws, k) || ws.has(`${k}s`) || ws.has(`${k}es`);
  const own = new Set([o.country, o.region, o.title, ...(o.spots ?? [])].flatMap(s => words(s ?? '')));
  const named = countries().filter(c => c.keys.every(has) && !c.keys.every(k => hasWord(own, k))).map(c => c.name);
  return [...new Set(named)];
}

export type Place = 'generic' | 'this' | 'other' | 'unsure';
export const PLACES: Place[] = ['generic', 'this', 'other', 'unsure'];

export interface Verdict {
  keep: boolean;
  place: Place | null;
}

/**
 * Photo judged for ONE listing. null = take it, else why not. `tied` = found on the offer's own page or its
 * destination page, or its file name names the destination (the auto step sends only tied photos here, site-wide
 * ones go through acceptShared).
 */
export function acceptVerdict(v: Verdict | null, c: { tied: boolean }): string | null {
  if (!v) return 'not judged';
  if (!v.keep) return 'vision: not a fitting photo';
  switch (v.place) {
    case 'generic':
    case 'this': return null;
    case 'other': return 'vision: another place';
    case 'unsure': return c.tied ? null : 'vision: unsure where, site-wide photo';
    default: return 'vision: no place given';
  }
}

export type Land = 'none' | 'background' | 'prominent';
export const LANDS: Land[] = ['none', 'background', 'prominent'];

export interface SharedVerdict {
  keep: boolean;
  land: Land | null;
  /** the place the photo or its file name names or recognisably shows, null when none */
  place: string | null;
}

/**
 * A site-wide photo (Caribbean Kite Cruise shows the same homepage photos for all five islands, a kite school its home
 * spot next to its Red Sea safari) may go on a listing only when nothing in it shows where it was taken (Aaron
 * 2026-11-02: generic boat and kite photos are fine, an island photo is not, in doubt leave it out). It is judged in
 * more than one pass and every pass must agree on the place: the cheap model placed the same photo as "generic" once
 * and "Anegada" once. Whether it is a fitting photo at all is a matter of taste, there the majority decides (one of
 * three passes turned down the provider's own boat photos, 2026-11-10). When the provider sails in more than one
 * destination, a coast in the background is enough to leave the photo out: Kite & Sail's bare Greek hills went onto
 * its Grenadines listing in the dry run of 2026-11-10.
 */
export function acceptShared(passes: Array<SharedVerdict | null>, c: { destinations: number }): string | null {
  if (passes.length === 0 || passes.some(p => !p)) return 'not judged in every pass';
  const ps = passes as SharedVerdict[];
  if (ps.filter(p => !p.keep).length * 2 >= ps.length) return 'vision: not a fitting photo';
  const named = ps.find(p => p.place)?.place;
  if (named) return `vision: shows a particular place (${named})`;
  if (ps.some(p => p.land !== 'none' && p.land !== 'background')) return 'vision: island, beach or coast is the subject';
  if (c.destinations > 1 && ps.some(p => p.land !== 'none')) return 'vision: coast in the background, the provider sails in more than one place';
  return null;
}

/** The kind of boat in a photo, as the vision step names it; "other" = dinghy, RIB or another small support boat. */
export type Boat = 'none' | 'catamaran' | 'monohull' | 'motor' | 'traditional' | 'other';
export const BOATS: Boat[] = ['none', 'catamaran', 'monohull', 'motor', 'traditional', 'other'];
const BOAT_KINDS = new Set<Boat>(['catamaran', 'monohull', 'motor', 'traditional']);
const BOAT_WORDS: Record<string, string> = { catamaran: 'catamaran', monohull: 'sailing yacht', motor: 'motor yacht', traditional: 'gulet or dhow' };

/** The listing's boat from cruise_offers.vessel_type; null = not known (speedboat, other, empty): no boat rule then. */
export function listingBoat(vesselType: string | null | undefined): Boat | null {
  switch (vesselType) {
    case 'catamaran': return 'catamaran';
    case 'sailing_yacht': return 'monohull';
    case 'motor_yacht': case 'liveaboard': return 'motor';
    case 'gulet': case 'dhow': return 'traditional';
    default: return null;
  }
}

/**
 * A photo of another kind of boat than the listing's (Sardinia and Cyclades catamaran listings got a motor yacht from
 * the same provider's site, 2026-11-02). Any judgement that saw another kind decides: in doubt leave it out.
 */
export function boatMismatch(seen: Array<Boat | null | undefined>, listing: Boat | null): string | null {
  if (!listing) return null;
  const other = seen.find(b => b && BOAT_KINDS.has(b) && b !== listing);
  return other ? `vision: another boat (${BOAT_WORDS[other]}, the trip is on a ${BOAT_WORDS[listing]})` : null;
}
