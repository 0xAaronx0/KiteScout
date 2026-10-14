// ---------------------------------------------------------------------------
// Villa Taina, Cabarete (Puerto Plata, Dominican Republic) - beachfront boutique hotel in the centre of
// Cabarete Bay (since 1993) with its own "Water Club" watersports school on the beach: kitesurf lessons
// with IKO-certified instructors, kite / wing / windsurf rental, plus the Serenade restaurant and a pool.
//
// Data path (checked 2026-10-12): villataina.com is a React single-page app (Vite build). Every route answers
// the same prerendered home HTML; the other routes' text lives in the JS bundle /assets/index-<hash>.js
// (linked from the home page, ~725 KB). We read:
//   home     https://villataina.com/ - hero, room teaser, "On Property" (Water Club), the notice "From
//            September 28 to October 13, 2026, scheduled maintenance ..." (2026 operation), photos.
//   bundle   string literals only (never executed): room objects {id,title,desc,features:Ir("bed","fan",
//            [extras]),images:[{src:var}]} with the shared feature list Ir=(e,n,a=[])=>[e,...,n,...b6,...a],
//            the Water Club disciplines {title:"Kitesurf",desc,rentals:[{duration,price}],lessons:[...]},
//            FAQ {q,a|schemaText}, route meta descriptions ("Since 1993 ..."), the asset path variables
//            (x="/assets/....jpg") and the Windy live-wind embed (lat=19.749&lon=-70.413, marker on the
//            hotel's bay) used as spotCoords.
//   slots    none. "Book Now" opens the Clock PMS+ web booking engine (sky-us2.clock-software.com, hotel
//            13400), whose robots.txt is "Disallow: /" (checked 2026-10-12) -> not called. The site prints no
//            room rates (FAQ: rates and breakfast depend on the rate plan) -> fetchSlots returns [].
// robots.txt (2026-10-12): villataina.com "Allow: /".
// Requests per run: content 2 (home + bundle), slots 0.
// Known limits: the bundle hash changes with every deploy (we follow the <script src> of the home page);
//   if a rebuild renames the minified helpers the room parser falls back to the home teaser cards.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://villataina.com';
export const VT_HOME_URL = `${SITE}/`;
const BOOKING_URL = 'https://sky-us2.clock-software.com/spa/pms-wbe/#/hotel/13400';

export interface VtRoom { id: string; title: string; desc: string; features: string[]; images: string[] }
export interface VtDiscipline { title: string; desc: string; rentals: Array<{ duration: string; price: number }>; lessons: Array<{ duration: string; price: number }> }

// --- local helpers ----------------------------------------------------------------------------
/** JS string / spread / identifier tokens of an array-literal body: 'a', "b", ...x, y */
function jsTokens(body: string): Array<{ str?: string; spread?: string; ident?: string }> {
  const out: Array<{ str?: string; spread?: string; ident?: string }> = [];
  for (const m of body.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|\.\.\.(\w+)|\b([A-Za-z_$][\w$]*)\b/g)) {
    if (m[1] !== undefined || m[2] !== undefined) out.push({ str: (m[1] ?? m[2]).replace(/\\(.)/g, '$1') });
    else if (m[3]) out.push({ spread: m[3] });
    else if (m[4]) out.push({ ident: m[4] });
  }
  return out;
}
const strs = (body: string): string[] => jsTokens(body).filter(t => t.str !== undefined).map(t => t.str!);
const usd = (s: string): number => Number(s.replace(/[^\d.]/g, ''));

// --- pure parsers (bundle) ----------------------------------------------------------------------
/** asset variable -> absolute photo URL */
export function vtAssets(bundle: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of bundle.matchAll(/([\w$]+)="(\/assets\/[^"]+\.(?:jpe?g|webp|png))"/gi)) out.set(m[1], `${SITE}${m[2]}`);
  return out;
}

const ROOM_BLOCK = /([\w$]+)=\[((?:'[^']*'|"[^"]*"|,)+)\],([\w$]+)=\(e,n,a=\[\]\)=>\[([^\]]*)\],[\w$]+=\[\{id:"[\s\S]*?\}\]\}\]/;

/** Room objects with their full feature list (shared helper resolved) and photos. */
export function vtRooms(bundle: string): VtRoom[] {
  const block = bundle.match(ROOM_BLOCK);
  if (!block) return [];
  const shared = strs(block[2]);
  const helper = block[3];
  const tmpl = jsTokens(block[4]); // e, "Air conditioning", "Mini fridge", n, ...b6, ...a
  const assets = vtAssets(bundle);
  const out: VtRoom[] = [];
  const re = new RegExp(`\\{id:"([\\w-]+)",title:"([^"]+)",desc:"([^"]+)",features:${helper.replace(/\$/g, '\\$')}\\(((?:"[^"]*"|'[^']*'|\\[[^\\]]*\\]|[^)"'])*)\\),images:\\[([^\\]]*)\\]`, 'g');
  for (const m of block[0].matchAll(re)) {
    const args = m[4];
    const arr = args.match(/\[([^\]]*)\]/);
    const scalars = strs(arr ? args.slice(0, arr.index) : args);
    const extras = arr ? strs(arr[1]) : [];
    const features: string[] = [];
    for (const t of tmpl) {
      if (t.str !== undefined) features.push(t.str);
      else if (t.ident === 'e' && scalars[0]) features.push(scalars[0]);
      else if (t.ident === 'n' && scalars[1]) features.push(scalars[1]);
      else if (t.spread === 'a') features.push(...extras);
      else if (t.spread === block[1]) features.push(...shared);
    }
    const images = [...m[5].matchAll(/src:([\w$]+)/g)].map(x => assets.get(x[1])).filter((u): u is string => !!u);
    out.push({ id: m[1], title: m[2], desc: m[3], features, images });
  }
  return out;
}

/** Water Club disciplines with rental and lesson prices (USD as printed, "$207"). */
export function vtWaterClub(bundle: string): VtDiscipline[] {
  const arr = bundle.match(/\[\{title:"[^"]+",desc:"[^"]+",icon:[\w$]+,img:[\w$]+,rentals:[\s\S]*?\]\}\]/)?.[0];
  if (!arr) return [];
  const out: VtDiscipline[] = [];
  for (const m of arr.matchAll(/\{title:"([^"]+)",desc:"([^"]+)",icon:[\w$]+,img:[\w$]+,rentals:\[([^\]]*)\],lessons:\[([^\]]*)\]\}/g)) {
    const items = (s: string) => [...s.matchAll(/\{duration:"([^"]+)",price:"([^"]+)"\}/g)].map(x => ({ duration: x[1], price: usd(x[2]) }));
    out.push({ title: m[1], desc: m[2], rentals: items(m[3]), lessons: items(m[4]) });
  }
  return out;
}

/** FAQ entries with a plain-string answer (or the schemaText of a JSX answer). */
export function vtFaq(bundle: string): Array<{ q: string; a: string }> {
  const out: Array<{ q: string; a: string }> = [];
  for (const m of bundle.matchAll(/\{q:"([^"]+)",(?:schemaText:"([^"]*)",)?a:(?:"([^"]*)")?/g)) {
    const a = m[3] ?? m[2];
    if (a && !out.some(x => x.q === m[1])) out.push({ q: m[1], a: a.replace(/\\"/g, '"') });
  }
  return out;
}

/** Route meta description, e.g. "/about" -> "Since 1993, Villa Taina has been a landmark ..." */
export function vtRouteMeta(bundle: string, route: string): string | null {
  const m = bundle.match(new RegExp(`"${route.replace(/\//g, '\\/')}":\\{title:"[^"]*",description:"([^"]*)"`));
  return m ? m[1] : null;
}

/** Windy live-wind embed marker (lat/lon of the hotel's bay). */
export function vtCoords(bundle: string): { lat: number; lng: number } | null {
  const m = bundle.match(/embed\.windy\.com\/embed2\.html\?lat=(-?[\d.]+)&lon=(-?[\d.]+)/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
}

/** Bundle URL from the home page's module script. */
export function vtBundleUrl(homeHtml: string): string | null {
  const src = homeHtml.match(/<script[^>]+src="(\/assets\/index-[\w-]+\.js)"/)?.[1];
  return src ? `${SITE}${src}` : null;
}

// --- pure parsers (home) -------------------------------------------------------------------------
function homeLines(html: string): string[] {
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/gi, '');
  return body.split(/<[^>]+>/).map(s => clean(s)).filter(Boolean);
}
/** "From September 28 to October 13, 2026, scheduled maintenance ..." (sign of 2026 operation) */
export function vtNotice(homeHtml: string): string | null {
  return homeLines(homeHtml).find(l => /^From [A-Z][a-z]+ \d{1,2} to [A-Z][a-z]+ \d{1,2}, 20\d\d,/.test(l)) ?? null;
}
/** Teaser cards on the home page (fallback when the bundle cannot be read). */
export function vtTeaserRooms(homeHtml: string): ContentRoom[] {
  const ls = homeLines(homeHtml);
  const a = ls.findIndex(l => /^View All Rooms$/i.test(l));
  if (a < 0) return [];
  const out: ContentRoom[] = [];
  for (let i = a + 1; i + 2 < ls.length && /^View Room$/i.test(ls[i + 2]); i += 3) out.push({ name: ls[i], description: ls[i + 1], features: [] });
  return out;
}

export interface VtPages { home: string; bundle: string | null }

export function parseVillaTainaContent(p: VtPages): OfferContent {
  const bundle = p.bundle ?? '';
  const rooms = vtRooms(bundle);
  const club = vtWaterClub(bundle);
  const kite = club.find(d => /^kite/i.test(d.title)) ?? null;
  const faq = vtFaq(bundle);
  const about = vtRouteMeta(bundle, '/about');
  const since = about?.match(/Since (\d{4})/)?.[1] ?? null;
  const notice = vtNotice(p.home);
  const coords = vtCoords(bundle);
  const ans = (re: RegExp) => faq.find(f => re.test(f.q))?.a ?? null;
  const airport = ans(/How far is Villa Taina from the airport/i);
  const breakfast = ans(/Is breakfast included/i);
  const homeText = homeLines(p.home).join(' ');

  const contentRooms: ContentRoom[] = rooms.length
    ? rooms.map(r => ({ name: r.title, description: r.desc, features: r.features }))
    : vtTeaserRooms(p.home);
  const minMax = (xs: Array<{ price: number }>) => (xs.length ? `USD ${Math.min(...xs.map(x => x.price))}-${Math.max(...xs.map(x => x.price))}` : null);

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of [...rooms.flatMap(r => r.images), ...imageCandidates(p.home, VT_HOME_URL, null, 60), ...vtAssets(bundle).values()]) {
    if (!/\/assets\/[^/]+\.(?:jpe?g|webp)$/i.test(u) || /logo|icon|opengraph/i.test(u)) continue;
    const k = u.replace(/-[\w]{8}(?=\.[a-z]+$)/i, '').toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); imageUrls.push(u);
  }

  const summary = [
    `Villa Taina is a beachfront boutique hotel in the centre of Cabarete on the north coast of the Dominican Republic${since ? `, on Cabarete Beach since ${since}` : ''}.`,
    `Its Water Club on the beach is a watersports school for kitesurfing, wing foiling and windsurfing${kite ? ` (kite lessons with IKO-certified instructors, ${minMax(kite.lessons)} for 2 to 12 hours; kite rental ${minMax(kite.rentals)} per hour to week)` : ''}.`,
    `${contentRooms.length || 'Several'} room categories${contentRooms.length ? ` (${contentRooms.map(r => r.name).join(', ')})` : ''} share a beachfront pool and the Serenade restaurant; breakfast depends on the rate plan.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Villa Taina',
    summary,
    continent: 'North America',
    country: 'Dominican Republic',
    region: 'Puerto Plata',
    spot: 'Cabarete',
    ...(coords ? { spotCoords: coords } : {}),
    itinerarySpots: [],
    durationDays: null,
    // FAQ: "lessons for beginners as well as equipment rentals for experienced riders" (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: kite ? kite.lessons.length > 0 : /kitesurfing lessons/i.test(bundle),
    equipmentRental: kite ? kite.rentals.length > 0 : null,
    beginnerFriendly: ans(/Can beginners learn watersports/i) ? true : null,
    includedServices: [
      'Wi-Fi', 'Air conditioning', 'Beach loungers', 'Beach towels', 'Beachfront swimming pool',
      ...(/limited complimentary on-site parking/i.test(ans(/parking/i) ?? '') ? ['Limited on-site parking'] : []),
    ],
    optionalServices: [
      ...club.map(d => `${d.title}: lessons ${d.lessons.map(l => `${l.duration} USD ${l.price}`).join(' / ')}; rental ${d.rentals.map(r => `${r.duration} USD ${r.price}`).join(' / ')} (Water Club)`),
      'E-foiling, surfing and SUP (Water Club)',
      'Serenade beachfront restaurant',
      'Private airport transfer',
      'Excursions and tours',
    ],
    accommodation: 'beachfront boutique hotel rooms',
    mealPlan: null, // FAQ: "Breakfast inclusion depends on the room category and rate plan"
    languages: ['en'],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: VT_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${homeText}`,
      `notice: ${notice ?? '-'}`,
      `about: ${about ?? '-'}`,
      `water club: ${club.map(d => `${d.title}: ${d.desc} lessons ${d.lessons.map(l => `${l.duration} $${l.price}`).join(', ')} rentals ${d.rentals.map(r => `${r.duration} $${r.price}`).join(', ')}`).join(' | ')}`,
      `rooms: ${rooms.map(r => `${r.title}: ${r.desc} [${r.features.join('; ')}]`).join(' | ')}`,
      `breakfast: ${breakfast ?? '-'}`,
      `airport: ${airport ?? '-'}`,
      `faq: ${faq.map(f => `${f.q} ${f.a}`).join(' | ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const villaTainaCabarete: OfferAdapter = {
  key: 'villa-taina-cabarete',
  name: 'Villa Taina, Cabarete',
  kind: 'accommodation',
  operator: {
    name: 'Villa Taina',
    websiteUrl: SITE,
    rootDomain: 'villataina.com',
    contactEmail: 'info@villataina.com',
    phone: '+18095710722',
  },
  url: VT_HOME_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  fetchBudget: 2,
  confidence: 'low',
  async fetchContent(ctx) {
    const home = await fetchText(VT_HOME_URL, { accept: 'text/html' });
    const url = vtBundleUrl(home);
    let bundle: string | null = null;
    if (url) bundle = await fetchText(url, { accept: '*/*' });
    else ctx.note('home page has no /assets/index-*.js bundle link: rooms from the teaser cards only');
    if (bundle && vtRooms(bundle).length === 0) ctx.note('bundle room objects not found (minified layout changed?): rooms from the teaser cards');
    return parseVillaTainaContent({ home, bundle });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    // Clock PMS+ (sky-us2.clock-software.com) robots.txt "Disallow: /": never called.
    ctx.note('no slot source: Clock PMS+ engine robots.txt disallows all (2026-10-12) and the site prints no room rates');
    return [];
  },
};

