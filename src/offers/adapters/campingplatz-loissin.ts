// ---------------------------------------------------------------------------
// Campingplatz Loissin ("Ferien- und Freizeitpark Loissin"), Loissin (Greifswalder Bodden, Mecklenburg-Vorpommern,
// Germany) - family campsite directly on the beach of the Greifswald Bodden; the site names "Schulen für Kitesurfen und
// Stand-Up-Paddling" on the campsite and its menu item "Kitesurfen" links Kitesafe (kitesafe.de), whose station and beach
// bar sit behind the tent meadow ("Unsere Freunde von Kitesafe ... an der Beach Bar hinter der Zeltwiese"). Listed: the
// rental units only (apartments, double rooms, sleeping barrels, two mobile homes), never the pitches.
//
// Data path (checked 2026-10-14), WordPress (The Mounty theme, trx_addons "properties"):
//   content  / (unit cards: name, "ab €55 pro Nacht" / "€127 Pro Nacht" / "142€ pro Nacht", type), /campingplatz/
//            (beach, kite schools, Kitesafe news), /properties/{apartments,doppelzimmer,schlaffass,mobilheim-boddentraum,
//            mobilheim-boddenglueck}/ (description, "Details" list incl. "Maximale Belegung", gallery data-image).
//   slots    /preise/ "Vermietung Apartment & Doppelzimmer": one <table> per unit type, columns Wintersaison ("bis
//            01.04.2026 / ab 31.10.2026"), Vor- und Nachsaison (01.04.-13.05.2026, 25.05.-15.06.2026, 31.08.-31.10.2026),
//            Hauptsaison (13.05.-25.05.2026 *, 15.06.-31.08.2026 **); rows "2 Personen/Nacht" price, "ab 3. Nacht" price,
//            extra person, dog. (The heading still says "Preise gültig für die Saison 2024"; the cells carry 2026 dates.)
//            The mobile homes and sleeping barrels have only the card price on the home page (no dates).
// Booking engine: mgm Easybuchen (buchen.campingplatz-loissin.de, the iframe on /reservierung/) - its robots.txt
//   disallows /Onlinebuchen/GetStep, /Preisrechner/GetStep, /Home/UpdateArrAndCampsite and /Home/GetLimitierungen (the
//   calls that carry prices and free places), so we do not use it: no live availability.
// robots.txt campingplatz-loissin.de (2026-10-14): Yoast default, nothing disallowed. No map pin with coordinates on the
//   site (the Google Maps embed is a text query "loissin zeltplatz"), so spotCoords stays empty.
// Requests per run: content 8 (home, campsite, prices, 5 unit pages), slots 2 (home + prices, memoised) -> 8.
// Parsed: apartment / double room = unit x season band, EUR per room per night for 2 persons (the first-nights price; the
//   lower "ab 3. Nacht" price goes into the room features), band end = last night before the printed end date (the next
//   band starts on it), "ab 31.10.2026" = open-ended winter band (endDate null); '**' band = Saturday to Saturday only
//   (minNights 7). Mobile homes and sleeping barrels: one undated slot each, EUR per unit per night as on the card
//   ("ab" for the barrel; per unit is INFERRED - the page says only "pro Nacht"). Availability 'unknown'.
// Known limits: extra persons (EUR 5 per night) and dogs (on request) are not modelled; the campsite's camping season
//   is 01.04.-31.10.2026, the mobile-home and barrel prices carry no season.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, iso, parse, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://campingplatz-loissin.de';
export const CPL_HOME_URL = `${SITE}/`;
export const CPL_CAMP_URL = `${SITE}/campingplatz/`;
export const CPL_PRICES_URL = `${SITE}/preise/`;
export const CPL_UNIT_URLS = ['apartments', 'doppelzimmer', 'schlaffass', 'mobilheim-boddentraum', 'mobilheim-boddenglueck']
  .map(s => `${SITE}/properties/${s}/`);
const BOOKING_URL = `${SITE}/reservierung/`;

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share pages */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const keyPart = (s: string): string => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const dmy = (s: string): string | null => {
  const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? iso(+m[3], +m[2], +m[1]) : null;
};

/** Visible text lines (scripts, styles dropped), split at block tags. */
export function cplLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|figure|table)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

// --- price tables -------------------------------------------------------------------------------
export interface CplBand { season: 'winter' | 'shoulder' | 'high'; start: string | null; end: string | null; marks: string }
export interface CplTable { unit: 'Apartment' | 'Doppelzimmer'; columns: Array<{ season: CplBand['season']; bands: CplBand[]; price: number | null; from3rd: number | null }>; extraPerson: number | null }

/** Season header cell -> bands with real limits (end = last night before the printed end date). */
export function parseCplSeasonCell(html: string): { season: CplBand['season']; bands: CplBand[] } | null {
  const text = collapse(parse(`<td>${html.replace(/<br\s*\/?>/gi, '\n')}</td>`).text);
  const season = /winter/i.test(text) ? 'winter' : /haupt/i.test(text) ? 'high' : /vor-|nachsaison/i.test(text) ? 'shoulder' : null;
  if (!season) return null;
  const bands: CplBand[] = [];
  const parts = html.replace(/<\/?(?:strong|span|b)\b[^>]*>/gi, '').split(/<br\s*\/?>/i).map(p => collapse(parse(`<p>${p}</p>`).text));
  for (const p of parts) {
    const marks = p.match(/(\*+)\s*$/)?.[1] ?? '';
    let m = p.match(/(\d{1,2})\.(\d{1,2})\.(?:(\d{4}))?\s*-\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (m) {
      const start = iso(+(m[3] ?? m[6]), +m[2], +m[1]);
      const end = addDays(iso(+m[6], +m[5], +m[4]), -1);
      bands.push({ season, start, end, marks });
      continue;
    }
    m = p.match(/\bbis\s+(\d{1,2}\.\d{1,2}\.\d{4})/i);
    if (m) { bands.push({ season, start: null, end: addDays(dmy(m[1])!, -1), marks }); continue; }
    m = p.match(/\bab\s+(\d{1,2}\.\d{1,2}\.\d{4})/i);
    if (m) bands.push({ season, start: dmy(m[1]), end: null, marks });
  }
  return { season, bands };
}

/** /preise/: the apartment and double-room tables. */
export function parseCplTables(html: string): CplTable[] {
  const out: CplTable[] = [];
  for (const t of parse(html).querySelectorAll('table')) {
    const head = collapse(t.querySelector('tr')?.text ?? '');
    const unit = /Apartment/i.test(head) ? 'Apartment' : /Doppelzimmer/i.test(head) ? 'Doppelzimmer' : null;
    if (!unit) continue;
    const rows = t.querySelectorAll('tr').slice(1).map(r => r.querySelectorAll('td'));
    const seasonRow = rows.find(r => r.some(td => /saison/i.test(td.text)));
    if (!seasonRow) continue;
    const cols = seasonRow.map(td => parseCplSeasonCell(td.innerHTML));
    const priceRow = rows.find(r => r.length && /^\s*[\d.,]+\s*Euro/i.test(r[0].text));
    const thirdRow = rows.find(r => r.some(td => /ab 3\. Nacht/i.test(td.text)));
    const extraRow = rows.find(r => r.some(td => /zusätzliche Person/i.test(td.text)));
    out.push({
      unit,
      columns: cols.flatMap((c, i) => c ? [{
        season: c.season,
        bands: c.bands,
        price: priceRow?.[i] ? parseAmount(priceRow[i].text) : null,
        from3rd: thirdRow?.[i] && /ab 3\. Nacht/i.test(thirdRow[i].text) ? parseAmount(thirdRow[i].text.replace(/ab 3\./i, '')) : null,
      }] : []),
      extraPerson: extraRow ? parseAmount(extraRow[0].text) : null,
    });
  }
  return out;
}

const UNIT_EN: Record<CplTable['unit'], string> = { Apartment: 'Apartment', Doppelzimmer: 'Double room' };

export function buildCplTableSlots(tables: CplTable[], today: string): Slot[] {
  const out: Slot[] = [];
  for (const t of tables) {
    for (const c of t.columns) {
      if (!c.price) continue;
      for (const b of c.bands) {
        if (b.end !== null && b.end < today) continue;
        const weekly = b.marks === '**';
        out.push({
          key: `${keyPart(UNIT_EN[t.unit])}|${b.start ?? `until-${b.end}`}`,
          startDate: b.start,
          endDate: b.end,
          unit: UNIT_EN[t.unit],
          price: c.price,
          currency: 'EUR',
          priceUnit: 'per_night',
          priceBasis: 'room',
          occupancy: 2,
          availability: 'unknown',
          availabilityText: weekly ? 'Buchungen nur von Samstag bis Samstag möglich' : b.marks === '*' ? 'über die Feiertage beträgt der Mindestaufenthalt 4 Tage' : null,
          spotsLeft: null,
          ...(weekly ? { minNights: 7 } : {}),
        });
      }
    }
  }
  return out.sort((x, y) => (x.unit ?? '').localeCompare(y.unit ?? '') || (x.startDate ?? '').localeCompare(y.startDate ?? ''));
}

// --- unit cards on the home page --------------------------------------------------------------------
export interface CplCard { name: string; url: string | null; price: number | null; priceText: string; type: string }
export function parseCplCards(html: string): CplCard[] {
  const out: CplCard[] = [];
  for (const it of parse(html).querySelectorAll('.sc_properties_item')) {
    const a = it.querySelector('.sc_properties_item_title a');
    const name = collapse(a?.text ?? '');
    if (!name || out.some(c => c.name === name)) continue;
    const priceText = collapse(it.querySelector('.properties_price')?.text ?? '');
    out.push({
      name,
      url: a?.getAttribute('href') ?? null,
      price: parseAmount(priceText.replace(/^\D+/, '')),
      priceText,
      type: collapse(it.querySelector('.sc_properties_item_type')?.text ?? ''),
    });
  }
  return out;
}

const isCardUnit = (c: CplCard): boolean => /Mobilheim|Schlaffass/i.test(c.name) && /pro nacht/i.test(c.priceText);
const cardUnitEn = (name: string): string => name.replace(/^Schlaffass$/i, 'Sleeping barrel (Schlaffass)').replace(/^Mobilheim /i, 'Mobile home ');

export function buildCplCardSlots(cards: CplCard[]): Slot[] {
  return cards.filter(isCardUnit).filter(c => c.price).map(c => ({
    key: keyPart(cardUnitEn(c.name)),
    startDate: null,
    endDate: null,
    unit: cardUnitEn(c.name),
    price: c.price,
    currency: 'EUR',
    priceUnit: 'per_night' as const,
    priceBasis: 'room' as const,
    occupancy: null,
    availability: 'unknown' as const,
    availabilityText: null,
    spotsLeft: null,
  }));
}

// --- unit pages ------------------------------------------------------------------------------------
export interface CplUnitPage { title: string; text: string; details: Array<{ label: string; data: string }>; gallery: string[] }
export function parseCplUnitPage(html: string): CplUnitPage {
  const root = parse(html);
  const title = collapse(root.querySelector('h1')?.text ?? root.querySelector('title')?.text.replace(/\s*-\s*Campingplatz.*$/, '') ?? '');
  const content = root.querySelector('.properties_page_content') ?? root.querySelector('.post_content') ?? root.querySelector('article');
  const text = collapse(content?.querySelectorAll('p').map(p => p.text).join(' ') ?? '');
  const details = root.querySelectorAll('.properties_page_section_item').map(s => ({
    label: collapse(s.querySelector('.properties_page_label')?.text ?? ''),
    data: collapse(s.querySelector('.properties_page_data')?.text ?? ''),
  })).filter(d => d.label);
  const gallery: string[] = [];
  for (const g of root.querySelectorAll('.properties_page_gallery_item')) {
    const u = g.getAttribute('data-image');
    if (!u) continue;
    // WordPress derivatives ("-1200x658.jpg") -> the original upload
    const abs = new URL(u, SITE).toString().replace(/-\d+x\d+(?=\.(?:jpe?g|png|webp)$)/i, '');
    if (!gallery.includes(abs)) gallery.push(abs);
  }
  return { title, text, details, gallery };
}

const DETAIL_EN: Array<[RegExp, string]> = [
  [/^(\d) Doppelbett$/i, '$1 double bed'], [/^(\d) Schlafcouch$/i, '$1 sofa bed'], [/^(\d) Kinderzimmer$/i, '$1 children\'s room'],
  [/^Kinderzimmer$/i, 'Children\'s room'], [/^Sat-TV$/i, 'Satellite TV'], [/^W-LAN$/i, 'Wi-Fi'], [/^Terrasse$/i, 'Terrace'],
  [/^Waschmaschine$/i, 'Washing machine'], [/^Bügeleisen, Föhn & Staubsauger$/i, 'Iron, hair dryer and vacuum cleaner'],
  [/^200m² Gartem$/i, '200 m² garden'], [/^Mit Holzkohlegrill$/i, 'Charcoal grill'], [/^Bollerwagen$/i, 'Hand cart'],
  [/^Kochnische$/i, 'Kitchenette'], [/^Badezimmer$/i, 'Bathroom'], [/^Maximale Belegung$/i, 'Maximum occupancy'],
  [/^WLAN$/i, 'Wi-Fi'],
];
const DATA_EN: Array<[RegExp, string]> = [
  [/^mit Doppelstockbett$/i, 'with bunk bed'], [/^kostenfrei$/i, 'free'], [/^mit Grill$/i, 'with grill'], [/^mit Kühlschrank$/i, 'with fridge'],
  [/^(\d) Erwachsene,? (\d) Kinder$/i, '$1 adults, $2 children'], [/^mit Dusche, WC und Fön$/i, 'with shower, toilet and hair dryer'],
  [/^mit Fernbedienung$/i, 'with remote control'], [/^mit Holzkohlegrill$/i, 'with charcoal grill'],
];
const en = (s: string, map: Array<[RegExp, string]>): string => { for (const [re, t] of map) if (re.test(s)) return s.replace(re, t); return s; };

export interface CplPages { home: string; camp: string; prices: string; units: string[] }

export function parseLoissinContent(p: CplPages): OfferContent {
  const camp = cplLines(p.camp);
  const tables = parseCplTables(p.prices);
  const cards = parseCplCards(p.home);
  const units = p.units.map(parseCplUnitPage);
  const kiteLine = camp.find(l => /Schulen für Kitesurfen/i.test(l)) ?? null;
  const kitesafe = camp.find(l => /Kitesafe/i.test(l)) ?? null;
  const seasonLine = cplLines(p.home).find(l => /Campingsaison/i.test(l)) ?? null;
  const surferDay = cplLines(p.prices).join('\n').match(/Tageskarte für Surfer ohne Übernachtung\n€([\d,]+)\n€([\d,]+)/);

  const unitByName = (re: RegExp) => units.find(u => re.test(u.title));
  const tableFeatures = (t: CplTable | undefined): string[] => t ? t.columns.filter(c => c.price).map(c => {
    const label = { winter: 'Winter season', shoulder: 'Low season', high: 'High season' }[c.season];
    const dates = c.bands.map(b => `${b.start ?? '…'} to ${b.end ?? '…'}`).join(', ');
    return `${label} (${dates}): EUR ${c.price} per night for 2 persons${c.from3rd ? `, from the 3rd night EUR ${c.from3rd}` : ''}`;
  }).concat(t.extraPerson ? [`Extra person EUR ${t.extraPerson} per night; dogs on request`] : []) : [];

  const rooms: ContentRoom[] = [];
  const apt = unitByName(/Apartment/i);
  rooms.push({
    name: 'Apartment',
    description: 'Apartment with terrace for up to 4 persons: double bed and bunk bed, bathroom, kitchenette, terrace with grill; restaurant and shop with bakery next door.',
    features: [...(apt?.details.map(d => `${en(d.label, DETAIL_EN)}${d.data ? ` ${en(d.data, DATA_EN)}` : ''}`) ?? []), ...tableFeatures(tables.find(t => t.unit === 'Apartment'))],
  });
  rooms.push({
    name: 'Double room',
    description: 'Double room with terrace: double bed plus a loft bed for 2 more persons, shower and toilet, TV, kitchenette and grill.',
    features: tableFeatures(tables.find(t => t.unit === 'Doppelzimmer')),
  });
  for (const c of cards.filter(isCardUnit)) {
    const u = unitByName(new RegExp(c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    const isBarrel = /Schlaffass/i.test(c.name);
    rooms.push({
      name: cardUnitEn(c.name),
      description: isBarrel
        ? 'Wooden sleeping barrel near the sanitary building, shop, restaurant and playground; the barrels also suit groups of up to 30.'
        : 'Mobile home with terrace and a private garden of about 200 m².',
      features: [
        ...(u?.details.map(d => `${en(d.label, DETAIL_EN)}${d.data ? ` ${en(d.data, DATA_EN)}` : ''}`) ?? []),
        `${/^ab\b/i.test(c.priceText) ? 'from ' : ''}EUR ${c.price} per night (as printed: "${c.priceText}")`,
      ],
    });
  }

  const imgs: string[] = [];
  for (const u of units) for (const g of u.gallery) if (!imgs.includes(g)) imgs.push(g);

  const minTable = Math.min(...tables.flatMap(t => t.columns.map(c => c.price ?? Infinity)));
  // camping season = the low/high-season bands of the table (first night .. last printed day)
  const inSeason = tables[0]?.columns.filter(c => c.season !== 'winter').flatMap(c => c.bands) ?? [];
  const firstNight = inSeason.map(b => b.start).filter((x): x is string => !!x).sort()[0] ?? null;
  const lastNight = inSeason.map(b => b.end).filter((x): x is string => !!x).sort().reverse()[0] ?? null;
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const summary = [
    `Campingplatz Loissin (Ferien- und Freizeitpark Loissin) is a family campsite directly on the beach of the Greifswald Bodden in Loissin, Mecklenburg-Vorpommern${firstNight && lastNight ? `, open for camping from ${fmt(firstNight)} to ${fmt(addDays(lastNight, 1))}` : ''}.`,
    'The campsite names schools for kitesurfing and stand-up paddling on its grounds; the Kitesafe kite station and beach bar sit behind the tent meadow, and surfers can also come for a day ticket.',
    `Besides pitches it rents double rooms and apartments with terrace and kitchenette (from EUR ${Number.isFinite(minTable) ? minTable : 55} per night for 2), wooden sleeping barrels and two mobile homes with private gardens; a restaurant, shop with bakery, sauna and bike rental are on site.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Campingplatz Loissin',
    summary,
    continent: 'Europe',
    country: 'Germany',
    region: 'Loissin, Greifswald Bodden',
    spot: 'Loissin',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: kiteLine ? true : null,
    equipmentRental: null,
    beginnerFriendly: null,
    includedServices: ['Free Wi-Fi', 'Beach access', 'Playground', '24/7 check-in'],
    optionalServices: [
      'Kitesurf and SUP lessons (Kitesafe, kitesafe.de)',
      ...(surferDay ? [`Day ticket for surfers without overnight stay EUR ${parseAmount(surferDay[1])} (low season) / EUR ${parseAmount(surferDay[2])} (high season)`] : []),
      'Bike, e-bike and e-scooter rental',
      'Sauna',
      'Restaurant and shop with bakery',
    ],
    accommodation: 'apartments, double rooms, sleeping barrels and mobile homes on a beach campsite',
    mealPlan: 'self_catering',
    languages: ['de'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: CPL_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `campsite: ${camp.find(l => /direkt am Greifswalder Bodden/i.test(l)) ?? ''} | ${kiteLine ?? ''} | ${kitesafe ?? ''}`,
      `season: ${seasonLine ?? ''}`,
      `cards: ${cards.map(c => `${c.name} [${c.type}] ${c.priceText}`).join(' | ')}`,
      ...tables.map(t => `${t.unit}: ${t.columns.map(c => `${c.season} ${c.bands.map(b => `${b.start}..${b.end}${b.marks}`).join(',')} ${c.price}${c.from3rd ? ` (from 3rd night ${c.from3rd})` : ''}`).join('; ')}`),
      ...units.map(u => `${u.title}: ${u.text} | ${u.details.map(d => `${d.label} ${d.data}`.trim()).join(', ')}`),
    ].join('\n'),
  };
}

export async function fetchCplSlots(today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const tables = parseCplTables(await page(CPL_PRICES_URL));
  if (tables.length < 2) throw new Error(`campingplatz-loissin: apartment / double-room price tables not found on /preise/ (${tables.length})`);
  const cards = parseCplCards(await page(CPL_HOME_URL));
  const cardSlots = buildCplCardSlots(cards);
  if (cardSlots.length === 0) ctx?.note('campingplatz-loissin: no mobile-home / sleeping-barrel card prices on the home page');
  return [...buildCplTableSlots(tables, today), ...cardSlots];
}

export const campingplatzLoissin: OfferAdapter = {
  key: 'campingplatz-loissin',
  name: 'Campingplatz Loissin',
  kind: 'accommodation',
  operator: {
    name: 'Ferien- und Freizeitpark Loissin',
    websiteUrl: SITE,
    rootDomain: 'campingplatz-loissin.de',
    contactEmail: 'kontakt@campingplatz-loissin.de',
    phone: '+4938352243',
  },
  url: CPL_HOME_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 9,
  async fetchContent() {
    const home = await page(CPL_HOME_URL);
    const camp = await page(CPL_CAMP_URL);
    const prices = await page(CPL_PRICES_URL);
    const units: string[] = [];
    for (const u of CPL_UNIT_URLS) units.push(await page(u));
    if (!/Kitesurfen/i.test(camp)) throw new Error('campingplatz-loissin: kite sentence missing on /campingplatz/');
    return parseLoissinContent({ home, camp, prices, units });
  },
  async fetchSlots(ctx) {
    return fetchCplSlots(todayIso(), ctx);
  },
};
