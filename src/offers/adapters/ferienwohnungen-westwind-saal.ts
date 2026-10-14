// ---------------------------------------------------------------------------
// Ferienwohnungen Westwind & Gästehaus Darßblick, Saal (Saaler Bodden, opposite Fischland-Darß, Mecklenburg-Vorpommern,
// Germany) - two holiday flats ("Emma", "Ben") in a half-timbered house in the village centre and, since 2026, the
// 5-room Gästehaus Darßblick (offered as "Surfhostel Zimmer" in the request form). The site's water-sports page says the
// flats are "auf die Bedürfnisse der Wassersportler eingestellt": the Wassersportcenter Saal (kite school, rental) is a
// few minutes' walk away and the Kiteshop Saal 5 minutes on foot.
//
// Data path (checked 2026-10-14), CM4all site ferienwohnungen-saal.de:
//   content  /Wassersport-Kitesurfen/ (kite school, shop, rental, Bodden), /Ferienwohnungen-Saal/ (flat Emma),
//            /Ferienunterkuenfte-Saal/ (flat Ben), /Gaestehaus-Darssblick-Saal/ (rooms, shared rooms, price tables).
//   slots    flats: per flat an <h2> "Nebensaison (NS)" / "Vorsaison (VS)" / "Hauptsaison (HS)" + "Zeiträume:" with dated
//            2026 ranges (e.g. 27.10. - 20.12.2026, 21.12. - 03.01.2027) + "50,- EUR pro Nacht 1-2 Personen" (Ben's
//            heading still says "Preisübersicht für das Jahr 2025", its ranges are 2026).
//            Gästehaus: two tables "Hauptsaison (01. Mai – 30. September)" / "Nebensaison Zimmerpreise (01. Oktober –
//            30. April)" without a year: rows "1 Nacht (So–Do)", "Samstag → Sonntag", "Wochenende Fr–So (2 Nächte)",
//            "1 Woche = 6 Nächte", "2 Wochen = 13 Nächte" x 1 / 2 persons, price per room. The year comes from the page's
//            own <lastmod> in /sitemap.xml (2026-08-16 -> high season 2026-05-01..09-30, low season 2026-10-01..2027-04-30).
// Booking: request forms only ("Ferienwohnung anfragen", "Zimmer anfragen") -> availability 'on_request'.
// robots.txt (2026-10-14): "Crawl-delay: 10" for all agents (this adapter waits 10 s between its own requests - local
//   helper, the shared throttle is 1.5 s), /.cm4all/ disallowed except mediadb / sysdb / uproc.php (the photos).
//   No coordinates on the site (the map widget is a consent placeholder), so spotCoords stays empty.
// Requests per run: content 4 + sitemap 1, slots 4 (memoised with content) -> 5 (~50 s with the crawl delay).
// Parsed: flat x season band (real 2026/27 limits, end = last night as printed), EUR per flat per night for 1-2 persons
//   (occupancy 2); guesthouse room x persons (1 / 2) x season band: the Sun-Thu night price (per_night) and the 6-night
//   week (package, packageNights 6), EUR per room. Bands that ended before today are dropped.
// Known limits: Saturday nights, weekends and 13-night stays are in the room features only; flat extras (final cleaning
//   EUR 60, extra bed EUR 10 per person and night, Kurabgabe EUR 2) are not in the slot price.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, iso, monthOf, parse, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://ferienwohnungen-saal.de';
export const FWS_SPORT_URL = `${SITE}/Wassersport-Kitesurfen/`;
export const FWS_EMMA_URL = `${SITE}/Ferienwohnungen-Saal/`;
export const FWS_BEN_URL = `${SITE}/Ferienunterkuenfte-Saal/`;
export const FWS_GUEST_URL = `${SITE}/Gaestehaus-Darssblick-Saal/`;
export const FWS_SITEMAP_URL = `${SITE}/sitemap.xml`;
const BOOKING_URL = `${SITE}/Ferienwohnung-Infos/`;
const CRAWL_DELAY_MS = 10_000; // ferienwohnungen-saal.de robots.txt "Crawl-delay: 10"

// --- local helpers ----------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
let lastSiteFetch = 0;
let siteQueue: Promise<unknown> = Promise.resolve();
/** Memoised fetch, serialised with the robots.txt crawl delay (skipped on fixture replay). */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const run = async () => {
    if (!process.env.OFFERS_FIXTURE_DIR) {
      const wait = lastSiteFetch + CRAWL_DELAY_MS - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
    try { return await fetchText(url, { accept: url.endsWith('.xml') ? 'application/xml,text/xml,*/*;q=0.8' : 'text/html' }); } finally { lastSiteFetch = Date.now(); }
  };
  const p = siteQueue.catch(() => undefined).then(run);
  siteQueue = p;
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const keyPart = (s: string): string => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** text of an HTML fragment with <br> as line breaks and tags removed without spaces ("27</em><em>.10." -> "27.10.") */
const brText = (html: string): string => clean(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|li|div)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n/g, ' \n '))
  .replace(/ ?\n ?/g, '\n');

/** Main text lines of a CM4all page (scripts, styles, cookie and footer boilerplate dropped). */
export function fwsLines(html: string): string[] {
  const lines = html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|figure|table)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
  const end = lines.findIndex(l => /^Online Streitbeilegung$/i.test(l));
  return end > 0 ? lines.slice(0, end) : lines;
}

// --- flats ------------------------------------------------------------------------
export interface FwsFlatBand { season: 'NS' | 'VS' | 'HS'; start: string; end: string; price: number }

/** "06.01. - 23.03.2026" / "21.12. - 03.01.2027": the start takes the end's year, or the year before when it would lie after the end. */
export function fwsRanges(text: string): Array<{ start: string; end: string }> {
  const out: Array<{ start: string; end: string }> = [];
  for (const m of text.matchAll(/(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(?:(\d{4}))?\s*[-–]\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})/g)) {
    const end = iso(+m[6], +m[5], +m[4]);
    let start = iso(m[3] ? +m[3] : +m[6], +m[2], +m[1]);
    if (!m[3] && start > end) start = iso(+m[6] - 1, +m[2], +m[1]);
    out.push({ start, end });
  }
  return out;
}

/** Flat page: season <h2> blocks with their "Zeiträume" and the "N,- EUR pro Nacht 1-2 Personen" price. */
export function parseFwsFlatBands(html: string): FwsFlatBand[] {
  const out: FwsFlatBand[] = [];
  const h2s = parse(html).querySelectorAll('h2');
  for (const h of h2s) {
    const season = collapse(h.text).match(/\((NS|VS|HS)\)/)?.[1] as FwsFlatBand['season'] | undefined;
    if (!season) continue;
    let block = '';
    for (let el = h.nextElementSibling; el && el.tagName !== 'H2'; el = el.nextElementSibling) block += `${brText(el.innerHTML)}\n`;
    const price = parseAmount(block.match(/(\d+)\s*,-?\s*EUR pro Nacht\s*1-2 Personen/i)?.[1] ?? '');
    if (!price) continue;
    for (const r of fwsRanges(block.replace(/Zeiträume:?/i, ''))) out.push({ season, ...r, price });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export function buildFwsFlatSlots(unit: string, bands: FwsFlatBand[], today: string): Slot[] {
  return bands.filter(b => b.end >= today).map(b => ({
    key: `${keyPart(unit)}|${b.start}`,
    startDate: b.start,
    endDate: b.end,
    unit,
    price: b.price,
    currency: 'EUR',
    priceUnit: 'per_night' as const,
    priceBasis: 'room' as const,
    occupancy: 2,
    availability: 'on_request' as const,
    availabilityText: null,
    spotsLeft: null,
  }));
}

// --- guesthouse -------------------------------------------------------------------
export interface FwsGuestTable { season: 'high' | 'low'; from: { d: number; m: number }; to: { d: number; m: number }; rows: Array<{ label: string; p1: number | null; p2: number | null }> }

/** Gästehaus tables: the <p> before each table names the season and its day-month limits. */
export function parseFwsGuestTables(html: string): FwsGuestTable[] {
  const out: FwsGuestTable[] = [];
  for (const t of parse(html).querySelectorAll('table')) {
    const prev = t.parentNode?.previousElementSibling ?? t.previousElementSibling;
    const head = collapse(prev?.text ?? '');
    const m = head.match(/(Haupt|Neben)saison[^(]*\(\s*(\d{1,2})\.\s*([A-Za-zäÄ]+)\s*[–-]\s*(\d{1,2})\.\s*([A-Za-zäÄ]+)\s*\)/);
    if (!m || !monthOf(m[3]) || !monthOf(m[5])) continue;
    const rows = t.querySelectorAll('tr').slice(1).map(r => r.querySelectorAll('td').map(td => collapse(td.text)))
      .filter(c => c.length >= 3)
      .map(c => ({ label: c[0], p1: parseAmount(c[1]), p2: parseAmount(c[2]) }));
    out.push({ season: m[1] === 'Haupt' ? 'high' : 'low', from: { d: +m[2], m: monthOf(m[3])! }, to: { d: +m[4], m: monthOf(m[5])! }, rows });
  }
  return out;
}

/** <lastmod> of a page in the CM4all sitemap. */
export function fwsLastmod(xml: string, url: string): string | null {
  const i = xml.indexOf(`<loc>${url}</loc>`);
  if (i < 0) return null;
  return xml.slice(i, i + 400).match(/<lastmod>(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

/** Season limits of the year-less tables, anchored on `year` (a season that crosses New Year ends the year after). */
export function fwsGuestBand(t: FwsGuestTable, year: number): { start: string; end: string } {
  const start = iso(year, t.from.m, t.from.d);
  const cross = t.to.m < t.from.m;
  return { start, end: iso(cross ? year + 1 : year, t.to.m, t.to.d) };
}

export const FWS_ROOM_UNIT = 'Gästehaus Darßblick room';

export function buildFwsGuestSlots(tables: FwsGuestTable[], year: number, today: string): Slot[] {
  const out: Slot[] = [];
  for (const t of tables) {
    const band = fwsGuestBand(t, year);
    if (band.end < today) continue;
    const night = t.rows.find(r => /^1 Nacht/i.test(r.label));
    const week = t.rows.find(r => /1 Woche\s*=\s*6 Nächte/i.test(r.label));
    for (const [persons, nightPrice, weekPrice] of [[1, night?.p1, week?.p1], [2, night?.p2, week?.p2]] as const) {
      const base = {
        startDate: band.start, endDate: band.end, unit: FWS_ROOM_UNIT, currency: 'EUR', priceBasis: 'room' as const, occupancy: persons,
        availability: 'on_request' as const, spotsLeft: null,
      };
      if (nightPrice) out.push({ ...base, key: `guesthouse-room-${persons}p|${band.start}`, price: nightPrice, priceUnit: 'per_night', availabilityText: `${night!.label}, ${persons} ${persons === 1 ? 'Person' : 'Personen'}` });
      if (weekPrice) out.push({ ...base, key: `guesthouse-room-${persons}p-6n|${band.start}`, price: weekPrice, priceUnit: 'package', packageNights: 6, availabilityText: `${week!.label}, ${persons} ${persons === 1 ? 'Person' : 'Personen'}` });
    }
  }
  return out;
}

// --- images -----------------------------------------------------------------------
/** CM4all photos (robots allows /.cm4all/uproc.php/): the 1600 px rendition, logos dropped. */
export function fwsImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/\/\.cm4all\/uproc\.php\/0\/\.([^/"'\s]+)\/picture-1600(\?_=[0-9a-f]+)?/g)) {
    if (/logo|westwind%20dunkel|westwind dunkel/i.test(m[1])) continue;
    const u = `${SITE}/.cm4all/uproc.php/0/.${m[1]}/picture-1600${m[2] ?? ''}`;
    if (!out.some(x => x.includes(`/.${m[1]}/`))) out.push(u);
  }
  return out;
}

// --- content ----------------------------------------------------------------------
export interface FwsPages { sport: string; emma: string; ben: string; guest: string; sitemap: string }

export function parseFwsContent(p: FwsPages): OfferContent {
  const sport = fwsLines(p.sport);
  const emma = fwsLines(p.emma);
  const ben = fwsLines(p.ben);
  const guest = fwsLines(p.guest);
  const flatBands = parseFwsFlatBands(p.emma);
  const guestTables = parseFwsGuestTables(p.guest);
  const year = Number((fwsLastmod(p.sitemap, FWS_GUEST_URL) ?? '').slice(0, 4)) || null;
  const flatPrices = [...new Set(flatBands.map(b => b.price))].sort((a, b) => a - b);
  const pick = (lines: string[], re: RegExp) => lines.find(l => re.test(l)) ?? null;

  const flatFeatures = (lines: string[]): string[] => [
    ...(lines.some(l => /bis zu 4 Personen|bis 4 Personen/i.test(l)) ? ['Up to 4 persons (bedroom for 2 + sofa bed)'] : []),
    ...(lines.some(l => /eigenes Badezimmer|Dusche/i.test(l)) ? ['Own bathroom with shower'] : []),
    ...(lines.some(l => /Küche/i.test(l)) ? ['Equipped kitchen'] : []),
    ...(lines.some(l => /WLAN/i.test(l)) ? ['Free Wi-Fi'] : []),
    ...(lines.some(l => /Kachelofen/i.test(l)) ? ['Tiled stove in the living room'] : []),
    ...(lines.some(l => /Terrasse|Grill/i.test(l)) ? ['Terrace / barbecue area'] : []),
    'Non-smoking, no pets',
    ...flatBands.map(b => `${{ NS: 'Low season', VS: 'Shoulder season', HS: 'High season' }[b.season]} ${b.start} to ${b.end}: EUR ${b.price} per night for 1-2 persons`),
    'Final cleaning EUR 60; extra bed EUR 10 per person and night; Kurabgabe EUR 2 per person and day',
  ];
  const guestFeatures = guestTables.flatMap(t => t.rows.map(r => `${t.season === 'high' ? 'High season' : 'Low season'} (${t.from.d}.${t.from.m}.-${t.to.d}.${t.to.m}.), ${r.label}: EUR ${r.p1 ?? '-'} (1 person) / EUR ${r.p2 ?? '-'} (2 persons) per room`));
  const since = guest.join(' ').match(/Seit (20\d\d) ist alles Erstbezug/)?.[1] ?? null;
  const rooms: ContentRoom[] = [
    { name: 'Ferienwohnung Emma', description: 'Renovated holiday flat in Haus Westwind with a separate bedroom, own bathroom and kitchen.', features: flatFeatures(emma) },
    { name: 'Ferienwohnung Ben', description: 'Renovated holiday flat in a half-timbered house with terrace, kitchen, bedroom and sofa bed.', features: flatFeatures(ben) },
    {
      name: FWS_ROOM_UNIT,
      description: `One of 5 rooms in the guesthouse${since ? ` (first occupancy ${since})` : ''}: bunk bed for 1-2 persons, TV, desk; shared kitchen, lounge and 2 bathrooms.`,
      features: [...guestFeatures, 'Bed linen EUR 7, towels EUR 4, both EUR 10 (once); final cleaning EUR 25 per room for short stays'],
    },
  ];
  const nightLow = guestTables.find(t => t.season === 'low')?.rows.find(r => /^1 Nacht/i.test(r.label))?.p1 ?? null;
  const imgs: string[] = [];
  for (const u of [...fwsImages(p.emma), ...fwsImages(p.ben), ...fwsImages(p.guest), ...fwsImages(p.sport)]) if (!imgs.includes(u)) imgs.push(u);

  const summary = [
    `Ferienwohnungen Westwind are two renovated holiday flats (Emma and Ben, up to 4 persons each) in a half-timbered house in the centre of Saal on the Saaler Bodden, opposite the Fischland-Darß peninsula; ${since ? `since ${since} ` : ''}the owners also run Gästehaus Darßblick with 5 rooms (bunk bed for 1-2 persons, shared kitchen and bathrooms).`,
    'The Wassersportcenter Saal with its kite school and equipment rental is a few minutes on foot and the Kiteshop Saal 5 minutes; the shallow Bodden lagoon makes learning to kite easy, and the hosts advise booking a kite course before the stay.',
    `${flatPrices.length ? `The flats cost EUR ${flatPrices[0]}-${flatPrices[flatPrices.length - 1]} per night for 1-2 persons` : 'Flat prices on request'}${nightLow ? `, guesthouse rooms from EUR ${nightLow} per night` : ''}; bookings by request form.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Ferienwohnungen Westwind & Gästehaus Darßblick',
    summary,
    continent: 'Europe',
    country: 'Germany',
    region: 'Saal, Fischland-Darß',
    spot: 'Saal',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate'],
    kiteLessons: sport.some(l => /Kitekurse/i.test(l)) ? true : null,
    equipmentRental: sport.some(l => /Material zu leihen/i.test(l)) ? true : null,
    beginnerFriendly: sport.some(l => /Einsteiger/i.test(l)) ? true : null,
    includedServices: ['Electricity, water, heating and Wi-Fi (flats)', 'Parking on the property'],
    optionalServices: [
      'Kite courses for beginners and private lessons at the Wassersportcenter Saal (book the course first)',
      'Kite equipment rental 365 days a year (Flysurfer, Cabrinha, Duotone, North, Liquid Force)',
      'Bike rental',
      'Linen and towel packages',
    ],
    accommodation: 'holiday flats and guesthouse rooms in the village',
    mealPlan: 'self_catering',
    languages: ['de'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: FWS_SPORT_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `water sports: ${sport.filter(l => /Kite|Wassersport|Bodden|Material/i.test(l)).join(' | ')}`,
      `Emma: ${pick(emma, /Platz für bis zu/i) ?? ''} | bands ${flatBands.map(b => `${b.season} ${b.start}..${b.end} ${b.price}`).join('; ')}`,
      `Ben: ${pick(ben, /Kitesurfshop/i) ?? ''} | ${pick(ben, /Preisübersicht/i) ?? ''}`,
      `Gästehaus: ${pick(guest, /5 frisch renovierten Zimmer/i) ?? ''} | ${pick(guest, /Seit 20\d\d/i) ?? ''} | sitemap lastmod year ${year ?? '-'}`,
      ...guestTables.map(t => `${t.season} ${t.from.d}.${t.from.m}.-${t.to.d}.${t.to.m}.: ${t.rows.map(r => `${r.label} ${r.p1}/${r.p2}`).join('; ')}`),
    ].join('\n'),
  };
}

export async function fetchFwsSlots(today: string): Promise<Slot[]> {
  const emma = parseFwsFlatBands(await page(FWS_EMMA_URL));
  const ben = parseFwsFlatBands(await page(FWS_BEN_URL));
  const guest = parseFwsGuestTables(await page(FWS_GUEST_URL));
  const year = Number((fwsLastmod(await page(FWS_SITEMAP_URL), FWS_GUEST_URL) ?? '').slice(0, 4)) || null;
  if (emma.length === 0 && ben.length === 0) throw new Error('ferienwohnungen-westwind-saal: flat season blocks ("Nebensaison (NS)" + "EUR pro Nacht 1-2 Personen") not found');
  if (guest.length === 0) throw new Error('ferienwohnungen-westwind-saal: guesthouse price tables not found');
  if (!year) throw new Error('ferienwohnungen-westwind-saal: no <lastmod> for the guesthouse page in sitemap.xml (year anchor)');
  return [
    ...buildFwsFlatSlots('Ferienwohnung Emma', emma, today),
    ...buildFwsFlatSlots('Ferienwohnung Ben', ben, today),
    ...buildFwsGuestSlots(guest, year, today),
  ];
}

export const ferienwohnungenWestwindSaal: OfferAdapter = {
  key: 'ferienwohnungen-westwind-saal',
  name: 'Ferienwohnungen Westwind & Gästehaus Darßblick Saal',
  kind: 'accommodation',
  operator: {
    name: 'Ferienwohnungen Westwind Saal',
    websiteUrl: SITE,
    rootDomain: 'ferienwohnungen-saal.de',
    contactEmail: 'info@ferienwohnung-westwind.de', // printed as "info (at) ferienwohnung-westwind.de"
    phone: '+4915257904880',
  },
  url: FWS_SPORT_URL,
  slotMethod: 'price_table',
  fetchBudget: 6,
  async fetchContent() {
    const sport = await page(FWS_SPORT_URL);
    const emma = await page(FWS_EMMA_URL);
    const ben = await page(FWS_BEN_URL);
    const guest = await page(FWS_GUEST_URL);
    const sitemap = await page(FWS_SITEMAP_URL);
    if (!/Kite/i.test(sport)) throw new Error('ferienwohnungen-westwind-saal: kite text missing on the water-sports page');
    return parseFwsContent({ sport, emma, ben, guest, sitemap });
  },
  async fetchSlots() {
    return fetchFwsSlots(todayIso());
  },
};
