// ---------------------------------------------------------------------------
// Campingplatz Strandgut, Cuxhaven-Sahlenburg (German North Sea, Wadden Sea) - small campsite about 200 m from the beach
// with rental units: two 16 m² Tiny Houses, Strandgut-Kajüten (cabins), Strandgut-Kojen (covered outdoor beds) and the
// Sandbank2Go caravan. Kite link on its own site: "In einem Umkreis von 200 Metern ... Strand, Kite-Showroom und
// Kite-Storage", "Kitesurfer können sich bei uns einen Schrank für ihr Kite-Equipment dazubuchen" (/platz-ausstattung),
// "Kitesurfen („Die Kiterei“)" under the activities (home). Pitches and the "Wohnmobil zur Miete" (a motorhome to drive
// away) are not listed.
//
// Data path (checked 2026-10-14), Joomla / YOOtheme:
//   content  / (intro, kite link, activities), /platz-ausstattung (kite storage + showroom, facilities),
//            /alternative-unterkuenfte/{tiny-house,strandgut-kajueten,strandgut-kojen,sandbank2go} (unit texts, photos),
//            /kontakt (OpenStreetMap marker {"lat":53.8589332,"lng":8.5950373} -> spotCoords).
//   slots    /preise: "Saison 15. März bis 31. Oktober 2026", the main/low season periods under "Preisliste Reisecamping
//            2026" (Hauptsaison 23.03.-16.04., 15.05.-26.05., 02.07.-23.08., 12.10.-24.10.; Nebensaison 17.04.-14.05.,
//            27.05.-01.07., 24.08.-11.10., 25.10.-31.10.; "gilt für die Übernachtungspreise ... je nach Unterkunft") and
//            one card per rental unit ("Tiny Haus (max. 4 Personen) / Ab 3 Nächten / Inkl. 2 Personen / Montag - Freitag
//            HS: 120,00 €/ Nacht NS: 90,00 € / Samstag - Sonntag HS ... NS ..."). That the camping HS/NS periods also apply
//            to the rental units is INFERRED (the unit cards only say HS / NS).
// Booking: online via the site (no third-party engine in the pages); not read.
// robots.txt (2026-10-14): Joomla defaults (/administrator/, /api/, /components/, ... - nothing we read).
// Requests per run: content 7, slots 1 (memoised with content).
// Parsed: slot = unit x season period x day type ("tiny-house|mon-fri|2026-10-12"), EUR per unit per night for the
//   persons the price includes (Tiny House / Sandbank2Go 2, Kajüte / Koje 1; extra persons in the room features),
//   minNights from "Ab 3 Nächten", availability 'unknown'. Periods that ended are dropped -> [] after 31.10.2026 until
//   the 2027 list is online. The 15.03.-22.03. opening week is in neither season list and gets no slot.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, iso, parse, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.campingplatz-strandgut.de';
export const SG_HOME_URL = `${SITE}/`;
export const SG_PRICES_URL = `${SITE}/preise`;
export const SG_FACILITIES_URL = `${SITE}/platz-ausstattung`;
export const SG_CONTACT_URL = `${SITE}/kontakt`;
export const SG_UNIT_URLS = {
  tiny: `${SITE}/alternative-unterkuenfte/tiny-house`,
  kajuete: `${SITE}/alternative-unterkuenfte/strandgut-kajueten`,
  koje: `${SITE}/alternative-unterkuenfte/strandgut-kojen`,
  sandbank: `${SITE}/alternative-unterkuenfte/sandbank2go`,
} as const;

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share the pages */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Visible text with block / span boundaries as spaces (scripts, styles, header, footer dropped). */
export function sgText(html: string): string {
  const root = parse(html.replace(/<(?=\/?(?:p|div|li|ul|ol|h[1-6]|br|section|figure|span|a|td|th|tr|strong)\b)/gi, ' <'));
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, template')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('#tm-main') ?? root.querySelector('body') ?? root).text);
}

export interface SgUnit {
  name: string;
  maxPersons: number | null;
  minNights: number | null;
  /** persons the nightly price includes */
  included: number;
  weekday: { hs: number; ns: number } | null;
  weekend: { hs: number; ns: number } | null;
  extraPerson: number | null;
  extras: string[];
}
export interface SgPrices {
  year: number | null;
  seasonStart: string | null;
  seasonEnd: string | null;
  main: Array<{ start: string; end: string }>;
  low: Array<{ start: string; end: string }>;
  units: SgUnit[];
}

const pair = (t: string, re: RegExp): { hs: number; ns: number } | null => {
  const m = t.match(re);
  const hs = m ? parseAmount(m[1]) : null;
  const ns = m ? parseAmount(m[2]) : null;
  return hs && ns ? { hs, ns } : null;
};

/** /preise: season line, the HS / NS period lists and one card per rental unit. */
export function parseSgPrices(html: string): SgPrices {
  const text = sgText(html);
  const season = text.match(/Saison (\d{1,2})\. ([A-Za-zä]+) bis (\d{1,2})\. ([A-Za-zä]+) (20\d{2})/);
  const MONTH: Record<string, number> = { januar: 1, februar: 2, märz: 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12 };
  const year = season ? Number(season[5]) : (Number(text.match(/Preisliste Reisecamping (20\d{2})/)?.[1]) || null);
  const seasonStart = season && MONTH[season[2].toLowerCase()] ? iso(year!, MONTH[season[2].toLowerCase()], Number(season[1])) : null;
  const seasonEnd = season && MONTH[season[4].toLowerCase()] ? iso(year!, MONTH[season[4].toLowerCase()], Number(season[3])) : null;
  const ranges = (seg: string) => (year ? [...seg.matchAll(/(\d{2})\.(\d{2})\.\s*[–-]\s*(\d{2})\.(\d{2})\./g)]
    .map(m => ({ start: iso(year, Number(m[2]), Number(m[1])), end: iso(year, Number(m[4]), Number(m[3])) })) : []);
  const hs = text.match(/Hauptsaison:([\s\S]*?)Nebensaison:/)?.[1] ?? '';
  const ns = text.match(/Nebensaison:([\s\S]*?)gilt für die Übernachtungspreise/)?.[1] ?? '';

  const units: SgUnit[] = [];
  for (const tile of parse(html).querySelectorAll('.uk-tile')) {
    const name = clean(tile.querySelector('h2 .uk-text-primary')?.text);
    if (!name) continue;
    const t = sgText(`<main>${tile.innerHTML}</main>`);
    const weekday = pair(t, /(?:Montag\s*-\s*Freitag|Mo\s*-\s*Fr):?\s*[^H]{0,10}HS:\s*([\d.,\s]+?)\s*€[\s\S]*?NS:\s*([\d.,\s]+?)\s*€/i);
    if (!weekday) continue; // pitch cards of the camping list have no day-type prices
    const included = Number(t.match(/Inkl\.\s*(\d)\s*Personen/i)?.[1] ?? (/\b1 Person\b/.test(t) ? 1 : NaN));
    units.push({
      name,
      maxPersons: Number(t.match(/\(max\.\s*(\d+)\s*Personen\)/i)?.[1]) || null,
      minNights: Number(t.match(/Ab (\d+) N[äa]cht/i)?.[1]) || null,
      included: Number.isFinite(included) ? included : 1,
      weekday,
      weekend: pair(t, /(?:Samstag\s*-\s*Sonntag|Sa\s*-\s*So):?\s*[^H]{0,10}HS:\s*([\d.,\s]+?)\s*€[\s\S]*?NS:\s*([\d.,\s]+?)\s*€/i),
      extraPerson: (() => { const m = t.match(/2\. Person\s*\+\s*([\d.,]+)\s*€/); return m ? parseAmount(m[1]) : null; })(),
      extras: tile.querySelectorAll('.uk-accordion-content li').map(li => clean(li.text.replace(/\s+/g, ' '))).filter(Boolean),
    });
  }
  return { year, seasonStart, seasonEnd, main: ranges(hs), low: ranges(ns), units };
}

const UNIT_KEYS: Record<string, string> = { 'Tiny Haus': 'tiny-house', 'Strandgut-Kajüte': 'kajuete', 'Strandgut-Koje': 'koje', Sandbank2Go: 'sandbank2go' };
const UNIT_EN: Record<string, string> = {
  'Tiny Haus': 'Tiny House',
  'Strandgut-Kajüte': 'Strandgut-Kajüte (cabin)',
  'Strandgut-Koje': 'Strandgut-Koje (covered outdoor bed)',
  Sandbank2Go: 'Sandbank2Go caravan',
};

export function buildSgSlots(p: SgPrices, today: string): Slot[] {
  const periods = [...p.main.map(r => ({ ...r, season: 'hs' as const })), ...p.low.map(r => ({ ...r, season: 'ns' as const }))]
    .sort((a, b) => a.start.localeCompare(b.start));
  const out: Slot[] = [];
  for (const u of p.units) {
    for (const per of periods) {
      if (per.end < today) continue;
      for (const [day, prices, label] of [['mon-fri', u.weekday, 'Mon-Fri nights'], ['sat-sun', u.weekend, 'Sat-Sun nights']] as const) {
        if (!prices) continue;
        out.push({
          key: `${UNIT_KEYS[u.name] ?? keyPart(u.name)}|${day}|${per.start}`,
          startDate: per.start,
          endDate: per.end,
          unit: `${UNIT_EN[u.name] ?? u.name}, ${label}`,
          price: per.season === 'hs' ? prices.hs : prices.ns,
          currency: 'EUR',
          priceUnit: 'per_night',
          priceBasis: 'room',
          occupancy: u.included,
          availability: 'unknown',
          availabilityText: null,
          spotsLeft: null,
          ...(u.minNights ? { minNights: u.minNights } : {}),
        });
      }
    }
  }
  return out;
}

/** /kontakt: YOOtheme map config {"markers":[{"lat":..,"lng":..}]}. */
export function parseSgCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/"markers":\[\{"lat":(-?\d+\.\d+),"lng":(-?\d+\.\d+)/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
}

export interface SgPages { home: string; prices: string; facilities: string; contact: string; tiny: string; kajuete: string; koje: string; sandbank: string }

/** "Tiny Wave in der Schnellübersicht Wohnfläche ca. 16 m² ..." -> the unit pages' own descriptions (first sentences). */
function unitIntro(html: string, re: RegExp): string | null {
  return sgText(html).match(re)?.[0] ?? null;
}

export function parseStrandgutContent(p: SgPages): OfferContent {
  const prices = parseSgPrices(p.prices);
  const home = sgText(p.home);
  const fac = sgText(p.facilities);
  const kiteRadius = home.match(/In einem Umkreis von 200 Metern[^…]*/)?.[0] ?? null;
  const storage = fac.match(/Kitesurfer können sich bei uns einen Schrank für ihr Kite-Equipment dazubuchen\./)?.[0] ?? null;
  const showroom = fac.match(/Natürlich dürfen die Wassersportler nicht zu kurz kommen[\s\S]*?bevor du bestellst!/)?.[0] ?? null;
  const school = home.match(/Kitesurfen \(„Die Kiterei“\)/)?.[0] ?? null;
  const coords = parseSgCoords(p.contact);
  const fmt = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');
  const eur = (n: number) => `EUR ${n}`;
  const minPrice = prices.units.flatMap(u => [u.weekday?.ns, u.weekday?.hs, u.weekend?.ns, u.weekend?.hs]).filter((n): n is number => !!n).sort((a, b) => a - b)[0] ?? null;

  const DESC: Record<string, string | null> = {
    'Tiny Haus': unitIntro(p.tiny, /Unsere Tiny-Häuser laden auf 16 m2 für bis zu vier Personen ein\.[^.]*\./),
    'Strandgut-Kajüte': unitIntro(p.kajuete, /Die Kajüte ist mit einem großen Doppelbett[^.]*\.[^.]*\./),
    'Strandgut-Koje': unitIntro(p.koje, /Unsere Strandgut-Kojen sind Outdoor-Betten aus Douglasien-Holz\.[^.]*\./),
    Sandbank2Go: unitIntro(p.sandbank, /In unserer Sandbank2Go finden drei Personen ausreichend Platz zum Wohnen und Schlafen\./),
  };
  const EN: Record<string, string> = {
    'Tiny Haus': '16 m² tiny houses (e.g. "Tiny Wave", "Blanker Hans") for up to four: double bed and two single beds, full kitchen, bathroom with shower and WC, TV, terrace, outdoor shower for wetsuits and gear, one parking space.',
    'Strandgut-Kajüte': 'Small cabin with a 1.80 x 2.00 m double bed for up to two, storage under the bed, lights and USB sockets, table and a covered veranda.',
    'Strandgut-Koje': 'Covered outdoor bed of Douglas fir for up to two (1.20 x 2 m mattress, insect screen, lockable weatherproof boxes); no parking space.',
    Sandbank2Go: 'Caravan for up to three with kitchen block, bathroom with shower and WC, a seating area that converts into a bed, awning and garden furniture.',
  };
  const rooms: ContentRoom[] = prices.units.map(u => ({
    name: UNIT_EN[u.name] ?? u.name,
    description: EN[u.name] ?? DESC[u.name] ?? null,
    features: [
      ...(u.maxPersons ? [`Up to ${u.maxPersons} persons`] : []),
      ...(u.minNights ? [`Minimum stay ${u.minNights} night${u.minNights > 1 ? 's' : ''}`] : []),
      `Price includes ${u.included} person${u.included > 1 ? 's' : ''}`,
      ...(u.weekday ? [`Mon-Fri: main season ${eur(u.weekday.hs)}, low season ${eur(u.weekday.ns)} per night`] : []),
      ...(u.weekend ? [`Sat-Sun: main season ${eur(u.weekend.hs)}, low season ${eur(u.weekend.ns)} per night`] : []),
      ...(u.extraPerson ? [`2nd person +${eur(u.extraPerson)} per night`] : []),
      ...u.extras.map(x => `Extra: ${x.replace(/^(?:zzgl\.|Optional zubuchbar:)\s*/i, '')}`),
    ],
  }));

  const imgs: string[] = [];
  const seen = new Set<string>();
  for (const html of [p.tiny, p.kajuete, p.koje, p.sandbank, p.home, p.facilities]) {
    // originals sit in /images/... (data-src); /media/yootheme/cache/ holds resized copies of the same files
    for (const m of html.matchAll(/(?:data-src|src)="(\/images\/[^"]+?\.(?:jpe?g|png|webp))"/gi)) {
      const u = new URL(m[1], SITE).toString();
      if (/logo|favicon|icon|platzplan|\.pdf|hund/i.test(u) || seen.has(u)) continue;
      seen.add(u); imgs.push(u);
    }
  }

  const summary = [
    `Campingplatz Strandgut is a small campsite in Cuxhaven-Sahlenburg on the Wadden Sea, about 200 m from the beach${prices.seasonStart && prices.seasonEnd ? `, open from ${fmt(prices.seasonStart)} to ${fmt(prices.seasonEnd)}` : ''}.`,
    `Besides pitches it rents 16 m² Tiny Houses for up to four, Strandgut-Kajüten (cabins for two), Strandgut-Kojen (covered outdoor beds) and a Sandbank2Go caravan for three${minPrice ? `, from EUR ${minPrice} per night` : ''}.`,
    'For kitesurfers the campsite has its own kite showroom and bookable kite-equipment lockers, and it lists kitesurfing ("Die Kiterei") among the activities nearby.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Campingplatz Strandgut',
    summary,
    continent: 'Europe',
    country: 'Germany',
    region: 'Cuxhaven, North Sea Coast',
    spot: 'Cuxhaven-Sahlenburg',
    ...(coords ? { spotCoords: coords } : {}),
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: null, // the site lists kitesurfing ("Die Kiterei") as an activity nearby, no lessons of its own
    equipmentRental: null,
    beginnerFriendly: null,
    includedServices: ['Showers and Wi-Fi', 'Outdoor kitchen (Strandgut-Kombüse)'],
    optionalServices: [
      'Kite-equipment locker (bookable)',
      'Kite showroom (boards, harnesses, wetsuits and more to try before ordering)',
      'Kitesurfing ("Die Kiterei", listed among the activities nearby)',
      'Bike trailers for boards and gear',
      'Linen package EUR 20 per person',
      'Café and 24/7 snack vending (Strandgut-Foodbox)',
    ],
    accommodation: 'tiny houses, cabins, covered outdoor beds and a caravan on a campsite',
    mealPlan: 'self_catering',
    languages: ['de'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: `${SITE}/alternative-unterkuenfte`,
    bookingUrl: SG_PRICES_URL,
    sourceText: [
      `home: ${kiteRadius ?? ''} | ${school ?? ''}`,
      `facilities: ${storage ?? ''} | ${showroom ?? ''}`,
      `season ${prices.seasonStart ?? '-'}..${prices.seasonEnd ?? '-'}; HS ${prices.main.map(r => `${r.start}..${r.end}`).join(', ')}; NS ${prices.low.map(r => `${r.start}..${r.end}`).join(', ')}`,
      `units: ${prices.units.map(u => `${u.name} max ${u.maxPersons} min ${u.minNights} incl ${u.included}: Mo-Fr ${u.weekday?.hs}/${u.weekday?.ns}, Sa-So ${u.weekend?.hs}/${u.weekend?.ns}${u.extraPerson ? `, 2nd person +${u.extraPerson}` : ''}`).join(' | ')}`,
      ...Object.entries(DESC).map(([k, v]) => `${k}: ${v ?? ''}`),
    ].join('\n'),
  };
}

export async function fetchSgSlots(today: string): Promise<Slot[]> {
  const prices = parseSgPrices(await page(SG_PRICES_URL));
  if (prices.units.length < 3) throw new Error(`campingplatz-strandgut-cuxhaven: rental unit cards not found on /preise (${prices.units.length} parsed)`);
  if (prices.main.length === 0 || prices.low.length === 0) throw new Error('campingplatz-strandgut-cuxhaven: Hauptsaison / Nebensaison periods not found on /preise');
  return buildSgSlots(prices, today);
}

export const campingplatzStrandgutCuxhaven: OfferAdapter = {
  key: 'campingplatz-strandgut-cuxhaven',
  name: 'Campingplatz Strandgut Cuxhaven',
  kind: 'accommodation',
  operator: {
    name: 'Campingplatz Strandgut',
    websiteUrl: SITE,
    rootDomain: 'campingplatz-strandgut.de',
    contactEmail: 'info@campingplatz-strandgut.de',
    phone: '+491621022561',
    whatsapp: '+491621022561',
  },
  url: `${SITE}/alternative-unterkuenfte`,
  slotMethod: 'price_table',
  fetchBudget: 9,
  confidence: 'medium', // HS / NS periods of the camping list applied to the rental units (inferred)
  async fetchContent() {
    const home = await page(SG_HOME_URL);
    const prices = await page(SG_PRICES_URL);
    const facilities = await page(SG_FACILITIES_URL);
    const contact = await page(SG_CONTACT_URL);
    const tiny = await page(SG_UNIT_URLS.tiny);
    const kajuete = await page(SG_UNIT_URLS.kajuete);
    const koje = await page(SG_UNIT_URLS.koje);
    const sandbank = await page(SG_UNIT_URLS.sandbank);
    if (!/Kite-Storage|Kite-Lager/i.test(facilities + home)) throw new Error('campingplatz-strandgut-cuxhaven: kite storage text missing');
    return parseStrandgutContent({ home, prices, facilities, contact, tiny, kajuete, koje, sandbank });
  },
  async fetchSlots() {
    return fetchSgSlots(todayIso());
  },
};
