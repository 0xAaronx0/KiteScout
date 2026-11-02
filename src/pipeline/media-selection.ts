// ---------------------------------------------------------------------------
// Rules of the cruise media selection, shared by apply (media-candidates.ts) and the automatic selection
// (media-auto.ts). No I/O here, so test/pipeline/media-selection.test.ts can pin them.
//
//   selectionImageRows  rule 1: apply rebuilds an offer's images from EVERY sorted selected/applied row
//   planAutoFill        rule 2: the live set stays as it is (same photos, same order, same hero); new photos only go
//                       behind it, up to MAX_MEDIA together with the hero video
//   isOwnSiteImage, photoStem                    rule 3: the provider's own photos, no second copy of one
//   placeTerms, namedPlaces, acceptVerdict, acceptShared   rule 4: no photo of another destination, in doubt leave it out
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

/** The words that name an offer's destination: country, region, title and itinerary stops, generic ones dropped. */
export function placeTerms(o: { country?: string | null; region?: string | null; title?: string | null; spots?: Array<string | null | undefined> }): string[] {
  const out = new Set<string>();
  for (const src of [o.country, o.region, o.title, ...(o.spots ?? [])]) {
    for (const w of words(src ?? '')) if (w.length >= 4 && !GEO_STOP.has(w)) out.add(w);
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
 * also inside a word and with one letter off (the provider's own spelling, "Mayrau" for Mayreau).
 */
export function namedPlaces(url: string, terms: string[]): string[] {
  const ws = words(baseName(url));
  return terms.filter(t => ws.some(w => w === t || w === `${t}s` || `${w}s` === t
    || (t.length >= 6 && (w.includes(t) || oneEditApart(w, t)))));
}

export type Place = 'generic' | 'this' | 'other' | 'unsure';
export const PLACES: Place[] = ['generic', 'this', 'other', 'unsure'];

export interface Verdict {
  keep: boolean;
  place: Place | null;
}

/**
 * Photo judged for ONE listing. null = take it, else why not. `tied` = found on the offer's own page or its
 * destination page, or its file name names the destination; untied photos of a provider with one destination come
 * here too (untied photos of a multi-destination provider go through acceptShared instead).
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
 * A site-wide photo of a provider with several destinations (Caribbean Kite Cruise shows the same homepage photos for
 * all five islands) may go on every listing only when nothing in it shows where it was taken (Aaron 2026-11-02:
 * generic boat and kite photos are fine, an island photo is not, in doubt leave it out). It is judged in more than
 * one pass and every pass must agree: the cheap model placed the same photo as "generic" once and "Anegada" once.
 */
export function acceptShared(passes: Array<SharedVerdict | null>): string | null {
  if (passes.length === 0 || passes.some(p => !p)) return 'not judged in every pass';
  const ps = passes as SharedVerdict[];
  if (ps.some(p => !p.keep)) return 'vision: not a fitting photo';
  const named = ps.find(p => p.place)?.place;
  if (named) return `vision: shows a particular place (${named})`;
  if (ps.some(p => p.land !== 'none' && p.land !== 'background')) return 'vision: island, beach or coast is the subject';
  return null;
}
