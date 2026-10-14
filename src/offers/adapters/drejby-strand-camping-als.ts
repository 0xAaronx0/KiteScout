// ---------------------------------------------------------------------------
// Drejby Strand Camping, Kegnæs (Als, Southern Jutland, Denmark) - four-star beach campsite (450 pitches) between the
// Baltic Sea and Lillehavet at the isthmus to Kegnæs; rents four types of camping cabins and six holiday apartments.
// The surf station at the campsite entrance (partner: Surfers Paradise) teaches surfing and kiting.
//
// Data path (checked 2026-10-12), WordPress / WPBakery site, English version on www.drejby.com:
//   content  / (four-star, 450 pitches, Baltic Sea and Lillehavet), /holiday-cabins/ and /holiday-apartments/ (unit blocks:
//            <h3> name, optional <h4> "(Cabins 1-4 and 11-16)", description in "min-height-overview-item-descr", photo in
//            the column before), /activities-at-the-campsite/ ("Surfers Paradise ... learn to surf or kite"); the footer of
//            every page carries "Season 2027 starts on March 19 and ends on September 19."
//   slots    Compusoft online booking embedded in the site (/online-booking/, csobPortalKey 2523bf24-…) - the shared helpers
//            of hvide-sande-camping.ts: per sample week the widget's anonymous profile list + one price call. One
//            Saturday-to-Saturday week per month inside the published seasons (2027: 20.03.-18.09.), max 9.
//            "Prices dynamic" on the site: there is no printed price table, the engine is the only price source.
// robots.txt (2026-10-12): www.drejby.com WordPress defaults (nothing we read); v3.onlinebooking.dk "Allow: /".
// Requests per run: content 4, slots 1 (cabins page for the season line, memoised) + up to 2 per sample week = max 19.
// Parsed: slot = unit type x sample week ("standard-cabin|2027-06-05"), DKK per unit for 7 nights as quoted by the engine
//   (priceUnit 'package', packageNights 7, priceBasis 'room'); available / limited (1-2 free; each apartment is a single
//   unit, so apartments are always 'limited' when free) / sold_out. Pitches and the engine's offer / package profiles
//   (holiday and Easter offers, cabin + Universe science park ticket, short holiday) are left out.
// Known limits: no map pin on the site (no embed, no geo) - spotCoords omitted; prices only for the sampled weeks.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, iso, monthOf, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';
import { csobSaturdaySamples, csobSlots, fetchCsobSamples, type CsobPortal } from './hvide-sande-camping.js';

const SITE = 'https://www.drejby.com';
export const DSC_HOME_URL = `${SITE}/`;
export const DSC_CABINS_URL = `${SITE}/holiday-cabins/`;
export const DSC_APARTMENTS_URL = `${SITE}/holiday-apartments/`;
export const DSC_ACTIVITIES_URL = `${SITE}/activities-at-the-campsite/`;
const BOOKING_URL = `${SITE}/booking/`;
export const DSC_PORTAL: CsobPortal = {
  portalKey: '2523bf24-2094-4a66-8a04-c9010bb12418',
  language: 'en',
  currency: 'DKK',
  // subTitle "(Drejby Strandcamping, Cabins)" / "(…, Appartements)"; offer / package profiles ("Holiday offer …", "Easter offer …",
  // "Holiday in Cabin including access to Sciencepark Universe", "Short holiday in our Standard cabin") are left out
  isUnit: p => /cabins|appartement|apartment/i.test(p.subTitle) && !/offer|tilbud|including|short holiday|holiday in/i.test(p.title),
};

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share the cabins page */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const text = (h: string): string => clean(h.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '));

/** Footer: "Season 2027 starts on March 19 and ends on September 19." */
export function parseDscSeasons(html: string): Array<{ year: number; start: string; end: string }> {
  const out: Array<{ year: number; start: string; end: string }> = [];
  for (const m of text(html).matchAll(/Season (20\d{2}) starts on ([A-Z][a-z]+) (\d{1,2}) and ends on ([A-Z][a-z]+) (\d{1,2})/g)) {
    const y = Number(m[1]);
    const a = monthOf(m[2]);
    const b = monthOf(m[4]);
    if (!a || !b || out.some(s => s.year === y)) continue;
    out.push({ year: y, start: iso(y, a, Number(m[3])), end: iso(y, b, Number(m[5])) });
  }
  return out;
}

export interface DscUnit { name: string; numbers: string | null; description: string | null; image: string | null }

/** Unit blocks of the cabins / apartments page: <h3> + <h4> "(Cabins …)" (cabins) or "Holiday apartment N", first <p> after
 *  the heading; photo = last upload image before the heading. Other <h3> blocks ("Practical info", "Furnishings") are skipped. */
export function parseDscUnits(html: string): DscUnit[] {
  const out: DscUnit[] = [];
  const heads = [...html.matchAll(/<h3>([\s\S]*?)<\/h3>/g)];
  heads.forEach((h, i) => {
    const seg = html.slice(h.index!, heads[i + 1]?.index ?? html.length);
    const numbers = seg.match(/^<h3>[\s\S]*?<\/h3>\s*<h4>([\s\S]*?)<\/h4>/)?.[1];
    if (!numbers && !/^holiday apartment \d/i.test(text(h[1]))) return;
    const descr = seg.match(/<p>([\s\S]*?)<\/p>/)?.[1];
    if (!descr) return;
    const before = html.slice(Math.max(0, h.index! - 4000), h.index!);
    const imgs = [...before.matchAll(/<img[^>]+src="(https:\/\/www\.drejby\.(?:com|dk)\/wp-content\/uploads\/[^"]+)"/g)];
    out.push({
      name: text(h[1]),
      numbers: numbers ? text(numbers).replace(/^\(|\)$/g, '') : null,
      description: text(descr).replace(/…$|\.\.\.$/, '…') || null,
      image: imgs.length ? imgs[imgs.length - 1][1] : null,
    });
  });
  return out;
}

/** Content photos (WPBakery single images) of a page; icons, social buttons, maps and thumbnails dropped. */
export function dscImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<img[^>]+src="(https:\/\/www\.drejby\.(?:com|dk)\/wp-content\/uploads\/[^"]+)"[^>]*class="vc_single_image-img/g)) {
    if (/logo|icon|facebook|instagram|youtube|kort|-\d{2,3}x\d{2,3}\.|\.svg|\.png$/i.test(m[1])) continue;
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

export interface DscPages { home: string; cabins: string; apartments: string; activities: string }

export function parseDrejbyContent(p: DscPages): OfferContent {
  const cabins = parseDscUnits(p.cabins);
  const apartments = parseDscUnits(p.apartments);
  const seasons = parseDscSeasons(p.cabins);
  const act = text(p.activities);
  const home = text(p.home);
  const surf = act.match(/The surf station is located at the entr\w+ to Drejby Strand Camping and offers you the possibility to le\w+ to surf or kite\.\s*We cooperate with Surfers Paradise\s*\./)?.[0].replace(/\s+\./g, '.') ?? null;
  const pitches = home.match(/has (\d+) pitches/)?.[1] ?? null;
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const next = seasons.filter(s => s.end >= todayIso()).sort((a, b) => a.start.localeCompare(b.start))[0] ?? seasons[seasons.length - 1];

  const rooms: ContentRoom[] = [
    ...cabins.map(c => ({ name: c.name, description: c.description, features: [...(c.numbers ? [c.numbers] : []), 'Duvets, pillows and tableware provided; bring or rent linen and towels'] })),
    ...apartments.map(a => ({ name: a.name, description: a.description, features: ['Kitchen, bathroom, TV, private balcony / porch / patio', 'Up to six people (by apartment)'] })),
  ];
  const imgs: string[] = [];
  for (const u of [...cabins.map(c => c.image), ...apartments.map(a => a.image), ...dscImages(p.activities), ...dscImages(p.home)]) {
    if (u && !/-\d{2,3}x\d{2,3}\./.test(u) && !imgs.includes(u)) imgs.push(u);
  }

  const summary = [
    `Drejby Strand Camping is a four-star beach campsite${pitches ? ` with ${pitches} pitches` : ''} on Als in Southern Jutland, Denmark, between the Baltic Sea and Lillehavet at the isthmus to Kegnæs${next ? `, open from ${fmt(next.start)} to ${fmt(next.end)}` : ''}.`,
    `It rents ${cabins.length || 4} types of camping cabins (standard, economy, Rice-inspired and Outdoor-oasis cabins for 2 to 6 people) and ${apartments.length || 6} holiday apartments, several of them less than 50 m from the beach.`,
    'The surf station at the campsite entrance (partner: Surfers Paradise) offers surf and kite lessons; the campsite also has a heated pool, four stairways down to the beach and a shop and café.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Drejby Strand Camping',
    summary,
    continent: 'Europe',
    country: 'Denmark',
    region: 'Kegnæs, Als',
    spot: 'Drejby Strand, Kegnæs',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner'],
    kiteLessons: surf ? true : null,
    equipmentRental: null,
    beginnerFriendly: true,
    includedServices: ['Heated outdoor pool with slide (end of May to end of August)', 'Beach access by four stairways', 'Activity programme in high season'],
    optionalServices: ['Surf and kite lessons at the Surfers Paradise surf station (campsite entrance)', 'Bed linen and towel rental', 'Final cleaning of the apartments', 'Shop and café RICETERIA'],
    accommodation: 'camping cabins and holiday apartments on a beach campsite',
    mealPlan: 'self_catering',
    languages: ['da', 'de', 'en'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: DSC_ACTIVITIES_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${home.match(/Drejby Strand Camping offers camping[^.]*\.[^.]*\./)?.[0] ?? ''}`,
      `surf station: ${surf ?? ''}`,
      `seasons: ${seasons.map(s => `${s.year} ${s.start}..${s.end}`).join('; ')}`,
      `cabins: ${cabins.map(c => `${c.name} (${c.numbers ?? '-'}): ${c.description ?? ''}`).join(' | ')}`,
      `apartments: ${apartments.map(a => `${a.name}: ${a.description ?? ''}`).join(' | ')}`,
    ].join('\n'),
  };
}

export async function fetchDscSlots(today: string, ctx: FetchContext): Promise<Slot[]> {
  const seasons = parseDscSeasons(await page(DSC_CABINS_URL));
  if (seasons.length === 0) throw new Error('drejby: footer line "Season YYYY starts on … and ends on …" not found');
  const checkIns = csobSaturdaySamples(today, seasons, { max: 9 });
  if (checkIns.length === 0) { ctx.note('drejby: no sample week inside a published season within 12 months'); return []; }
  return csobSlots(await fetchCsobSamples(DSC_PORTAL, checkIns, ctx), ctx);
}

export const drejbyStrandCampingAls: OfferAdapter = {
  key: 'drejby-strand-camping-als',
  name: 'Drejby Strand Camping Als',
  kind: 'accommodation',
  operator: {
    name: 'Drejby Strand Camping',
    websiteUrl: 'https://www.drejby.dk',
    rootDomain: 'drejby.dk',
    contactEmail: 'info@drejby.dk',
    phone: '+4574404305',
  },
  url: DSC_ACTIVITIES_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 23,
  async fetchContent() {
    const home = await page(DSC_HOME_URL);
    const cabins = await page(DSC_CABINS_URL);
    const apartments = await page(DSC_APARTMENTS_URL);
    const activities = await page(DSC_ACTIVITIES_URL);
    if (!/Surfers Paradise/.test(activities)) throw new Error('drejby: Surfers Paradise block missing on the activities page (kite link gone?)');
    return parseDrejbyContent({ home, cabins, apartments, activities });
  },
  async fetchSlots(ctx) {
    return fetchDscSlots(todayIso(), ctx);
  },
};
