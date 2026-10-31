// ---------------------------------------------------------------------------
// UMMAII Surfhostel, Tiny Houses & Baumhaus, Ummanz (west Rügen, Germany) - surf hostel in Haide on the island of
// Ummanz (operator Uns eigen e.G.) with its own wind- and kitesurf school (VDWS courses "seit 1994") at the Regenbogen
// campsite in Suhrendorf, "Deutschlands größtes Stehrevier", inside the Vorpommersche Boddenlandschaft National Park.
//
// Data path (checked 2026-10-14), TYPO3 site, German only:
//   content  / (spot, kite school, geo.position meta 54.474674;13.147695, the Sirvoy widget data-form-id),
//            /unterkunft-tikibar/hostel/ (categories Kat. A-D: bungalows with 6- and 8-bed rooms, 1-4-bed rooms in
//            the main house, tree house, two tiny houses, min. 4 nights), /unterkunft-tikibar/tiny-houses/,
//            /unterkunft-tikibar/preise/ (price list "Preisliste Übernachtung & Verpflegung", no year printed:
//            per person incl. breakfast for bungalow / main house, tree house 120, tiny houses 140 / 160 per night),
//            /kitesurfkurse/preise/ (course prices) + the room cards of the first Sirvoy sample below.
//   slots    Sirvoy booking engine, the site's own widget (<script data-form-id="8f8fb088e5c371a1"
//            src="https://secured.sirvoy.com/widget/sirvoy.js">, also ummaii-hostel.sirvoy.me). Per sample stay the
//            widget makes two anonymous calls, and so do we (same calls as kite-beach-inn-cabarete.ts):
//              POST secured.sirvoy.com/widget/book_widget_cors.js  JSON {form_id, widget:"normal", adults:"2",
//                   check_in, check_out, target:"results", ...} -> {status:"ok", t:<engine session id>, html:<iframe>}
//              GET  secured.sirvoy.com/engine/book_results?t=<t>&id=<form id>&container_id=sbw_widget_1
//                   -> per room type data-room-type-data='{"name","rateByOccupancy":{"1":{"rate",
//                   "quantityLabel":"shared.term.per_night"},...},"availableUnitIds":[...]}', room cards,
//                   "customerCurrency":"EUR"; outside the season only "The selected dates can't be booked. Please
//                   make another selection or call to book." (2027-01-15, checked 2026-10-14).
//            No login, cookie or signed header: the session id comes back in the first answer (parsers reused from
//            kite-beach-inn-cabarete.ts). One 4-night stay for 2 adults per season month (April-October, arrival on
//            the 15th or tomorrow), 12 months ahead; 4 nights because the tiny houses need at least 4.
// robots.txt (2026-10-14): www.ummaii.de only "User-agent: Googlebot / Disallow:" (nothing disallowed);
//   secured.sirvoy.com "User-agent: *" without rules -> allowed.
// Requests per run: content 5 + 2 (first sample, memoised), slots 7 samples x 2 = 14 -> 19 for a full run.
// Parsed: per room type (camper / tent pitches dropped), month bands merged where price and availability stay the same
//   (runsOf): EUR per unit per night for 2 guests (1 in the single room; room only, the rate the engine lists "/night"), 'available' when
//   the engine lists a free unit (the hostel has one or two units per type, so a single free unit is not read as a
//   shortage), 'on_request' for a sample the engine refuses with its date notice ("The selected dates can't be booked.
//   Please make another selection or call to book."; seen for 2027-06-15 and 2027-09-15, probably group / class-trip
//   weeks), 'unknown' when a type is missing from an open sample. Tiny houses carry minNights 4 (hostel page).
// Known limits: breakfast (EUR 11.00 + 1.90 drinks per person per day online; the price list says breakfast comes with
//   every room booking) and the final cleaning (EUR 10 per room, EUR 40 per tiny house, "immer enthalten") come on top
//   of the room rates, except the tree house rate, which includes both. One sample per month: other arrival dates can
//   differ (the 2027-06 and 2027-09 samples were refused while July and August were open). The printed price list has no
//   year (it looks older than the engine rates: tiny houses 140 / 160 printed, 150 / 170 online for 2027) and goes into the
//   room features only.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, iso, parse, parseAmount, runsOf, todayIso } from '../parse.js';
import type { Availability, ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';
import { parseKbiResults, type KbiRoomCard, type KbiRoomType } from './kite-beach-inn-cabarete.js';

const SITE = 'https://www.ummaii.de';
export const UM_HOME_URL = `${SITE}/`;
export const UM_HOSTEL_URL = `${SITE}/unterkunft-tikibar/hostel/`;
export const UM_TINY_URL = `${SITE}/unterkunft-tikibar/tiny-houses/`;
export const UM_PRICES_URL = `${SITE}/unterkunft-tikibar/preise/`;
export const UM_KITE_PRICES_URL = `${SITE}/kitesurfkurse/preise/`;
const BOOKING_URL = `${SITE}/unterkunft-tikibar/unterkunft-anfragen/`;
const SIRVOY = 'https://secured.sirvoy.com';
export const UM_FORM_ID = '8f8fb088e5c371a1';
export const UM_WIDGET_URL = `${SIRVOY}/widget/book_widget_cors.js`;
const ADULTS = 2;
const NIGHTS = 4;
const MONTHS = 12;
const SEASON = [4, 5, 6, 7, 8, 9, 10];
/** the engine's date notice (data-translation-key="booking_engine.error.invalid_date"), e.g. "The selected dates can't be booked. …" */
const DATE_ERROR_RE = /data-translation-key="booking_engine\.error\.[\w.]+"[^>]*>([^<]+)</;

export interface UmSample {
  checkIn: string; checkOut: string;
  /** the engine refused the dates: its notice ("The selected dates can't be booked. Please make another selection or call to book.") */
  refused: string | null;
  currency: string | null; types: KbiRoomType[]; cards: KbiRoomCard[];
}

// --- local helpers ----------------------------------------------------------------------------
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysIn(y: number, m: number): number { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
const money = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const isPitch = (name: string): boolean => /stellplatz|camper|zelt|wohnmobil/i.test(name);

/** Sirvoy room type name -> English unit name (unknown names stay as they are). */
export function umUnitName(name: string): string {
  let m = name.match(/^Zimmer (\d)[\s-]Bett Haupthaus$/i);
  if (m) return m[1] === '1' ? 'Main house single room' : `Main house ${m[1]}-bed room`;
  if (/^Baumhaus$/i.test(name)) return 'Tree house';
  m = name.match(/^Tiny\s?haus (\d)$/i);
  if (m) return `Tiny House ${m[1]}`;
  m = name.match(/^Bungalow (\d)[\s-]Bett$/i);
  if (m) return `Bungalow ${m[1]}-bed room`;
  return name;
}

export const UM_ROOM_MAIN_HOUSE = 'Main house room (1-4 beds)';
export const UM_ROOM_BUNGALOW = 'Bungalow room (6 or 8 beds)';
/** Content room an engine unit prices: the per-size main-house and bungalow types share one room each; others are named alike. */
export function umRoom(unit: string): string | null {
  if (/^Main house (?:single|\d-bed) room$/.test(unit)) return UM_ROOM_MAIN_HOUSE;
  if (/^Bungalow \d-bed room$/.test(unit)) return UM_ROOM_BUNGALOW;
  return null;
}

/** Visible text lines (scripts, styles dropped), split at block tags. */
export function umLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|table)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

/** Lines of the page body: after the second weather box ("zur Windguru Windvorhersage"), before the footer. */
function bodyLines(html: string): string[] {
  const lines = umLines(html);
  const idx = lines.reduce<number[]>((a, l, i) => (/^zur Windguru Windvorhersage$/.test(l) ? [...a, i] : a), []);
  const start = idx.length >= 2 ? idx[1] + 1 : 0;
  const end = lines.findIndex((l, i) => i > start && /^Kite- & Surfschule$/.test(l));
  return lines.slice(start, end > start ? end : undefined).filter(l => !/^(Home|0 Artikel im Warenkorb|-->)$/.test(l));
}

// --- sample stays ------------------------------------------------------------------------------
/** One 4-night stay per season month (April-October): arrival on the 15th (or tomorrow in the current month), 12 months ahead. */
export function umSampleStays(today: string): Array<{ checkIn: string; checkOut: string }> {
  const y = Number(today.slice(0, 4)); const m = Number(today.slice(5, 7));
  const tomorrow = addDays(today, 1);
  const out: Array<{ checkIn: string; checkOut: string }> = [];
  for (let k = 0; k < MONTHS; k++) {
    const mm = ((m - 1 + k) % 12) + 1; const yy = y + Math.floor((m - 1 + k) / 12);
    if (!SEASON.includes(mm)) continue;
    let checkIn = iso(yy, mm, 15);
    if (checkIn < tomorrow) checkIn = tomorrow;
    if (checkIn.slice(0, 7) !== iso(yy, mm, 1).slice(0, 7)) continue;
    out.push({ checkIn, checkOut: addDays(checkIn, NIGHTS) });
  }
  return out;
}

/** Body the site's widget posts (data attributes of the script tag + the search dates). */
export function umWidgetBody(checkIn: string, checkOut: string): string {
  return JSON.stringify({
    container_id: 'sbw_widget_1', widget: 'normal', source: null, context: 'default', guest_id: null, copy_booking_id: null,
    form_id: UM_FORM_ID, adults: String(ADULTS), check_in: checkIn, check_out: checkOut, target: 'results',
    host_page_url: BOOKING_URL, wp_plugin_version: 'legacy',
  });
}

/** Widget answer -> results page URL (engine session id `t`). */
export function umResultsUrl(widgetJson: string): string | null {
  const d = JSON.parse(widgetJson) as { status?: string; t?: string; html?: string };
  if (d.status !== 'ok') return null;
  const src = d.html?.match(/src="([^"]+)"/)?.[1];
  if (src) return src.replace(/&amp;/g, '&');
  return d.t ? `${SIRVOY}/engine/book_results?t=${d.t}&id=${UM_FORM_ID}&container_id=sbw_widget_1` : null;
}

/** Results page -> room types / cards / currency, or the engine's "can't be booked" answer. */
export function parseUmResults(html: string): Omit<UmSample, 'checkIn' | 'checkOut'> {
  if (!/data-room-type-data=/.test(html)) {
    const refused = clean(html.match(DATE_ERROR_RE)?.[1] ?? '') || null;
    if (!refused) throw new Error('ummaii: Sirvoy results page has neither room types nor a date notice');
    return { refused, currency: null, types: [], cards: [] };
  }
  const r = parseKbiResults(html);
  return { refused: null, currency: r.currency, types: r.types.filter(t => !isPitch(t.name)), cards: r.cards };
}

const occOf = (t: KbiRoomType): number => (t.rates[ADULTS] ? ADULTS : Math.max(...Object.keys(t.rates).map(Number)));

/** Month bands per room type from the samples (merged where price and availability repeat). */
export function buildUmSlots(samples: UmSample[], today: string): Slot[] {
  const names: string[] = [];
  for (const s of samples) for (const t of s.types) if (!names.includes(t.name)) names.push(t.name);
  const out: Slot[] = [];
  for (const name of names) {
    type Day = { date: string; sample: UmSample; type: KbiRoomType | null };
    const days: Day[] = [];
    for (const s of samples) {
      const y = Number(s.checkIn.slice(0, 4)); const m = Number(s.checkIn.slice(5, 7));
      const t = s.types.find(x => x.name === name) ?? null;
      for (let d = 1; d <= daysIn(y, m); d++) if (iso(y, m, d) >= today) days.push({ date: iso(y, m, d), sample: s, type: t });
    }
    const cls = (d: Day): Availability => (d.sample.refused ? 'on_request'
      : !d.type || !Object.keys(d.type.rates).length ? 'unknown' : d.type.freeUnits === 0 ? 'sold_out' : 'available');
    const state = (d: Day) => `${cls(d)}|${d.type && Object.keys(d.type.rates).length ? d.type.rates[occOf(d.type)] : '-'}`;
    for (const run of runsOf(days, state)) {
      const t = run.first.type;
      const a = cls(run.first);
      const priced = !!t && (a === 'available' || a === 'sold_out');
      const stay = `${run.first.sample.checkIn}..${run.first.sample.checkOut}`;
      out.push({
        key: `${keyPart(name)}|${run.start}`,
        startDate: run.start,
        endDate: run.end,
        unit: umUnitName(name),
        ...(umRoom(umUnitName(name)) ? { room: umRoom(umUnitName(name)) } : {}),
        price: priced ? t!.rates[occOf(t!)] : null,
        currency: priced ? run.first.sample.currency : null,
        priceUnit: priced ? 'per_night' : null,
        priceBasis: 'room',
        occupancy: priced ? occOf(t!) : null,
        availability: a,
        availabilityText: a === 'on_request' ? `Sirvoy: "${run.first.sample.refused}" (sample stay ${stay})`
          : a === 'unknown' ? `not offered for the sample stay ${stay} (booked or not bookable for ${ADULTS} guests)`
            : `${t!.freeUnits} unit(s) free for the sample stay ${stay} (Sirvoy)`,
        spotsLeft: null,
        ...(/tiny/i.test(name) ? { minNights: 4 } : {}),
      });
    }
  }
  return out;
}

// --- engine calls (memoised per stay for 10 minutes: content and slots share the first sample) ----------
const sampleMemo = new Map<string, { at: number; p: Promise<UmSample> }>();
export function fetchUmSample(checkIn: string, checkOut: string): Promise<UmSample> {
  const k = `${checkIn}|${checkOut}`;
  const hit = sampleMemo.get(k);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = (async () => {
    const widget = await fetchText(UM_WIDGET_URL, { method: 'POST', body: umWidgetBody(checkIn, checkOut), contentType: 'application/json', accept: 'application/json' });
    const url = umResultsUrl(widget);
    if (!url) throw new Error(`ummaii: Sirvoy widget answered without an engine session (${widget.slice(0, 120)})`);
    return { checkIn, checkOut, ...parseUmResults(await fetchText(url, { accept: 'text/html' })) };
  })();
  sampleMemo.set(k, { at: Date.now(), p });
  p.catch(() => sampleMemo.delete(k));
  return p;
}

export async function fetchUmSlots(ctx: FetchContext, today: string): Promise<Slot[]> {
  const samples: UmSample[] = [];
  for (const s of umSampleStays(today)) {
    try { samples.push(await fetchUmSample(s.checkIn, s.checkOut)); }
    catch (e) { ctx.incomplete(`Sirvoy sample ${s.checkIn}..${s.checkOut}: ${(e as Error).message}`); }
  }
  if (samples.length === 0) throw new Error('ummaii: no Sirvoy sample stay could be read');
  if (samples.every(s => s.types.length === 0)) ctx.note('ummaii: Sirvoy listed no room type for any sample stay');
  return buildUmSlots(samples, today);
}

// --- content ----------------------------------------------------------------------------------
export interface UmPrice { label: string; amount: number; perPerson: boolean }

/** "Preisliste Übernachtung & Verpflegung": label cell + price cell ("p.P. 36,90 €", "120,- €"). */
export function parseUmPriceList(html: string): UmPrice[] {
  const out: UmPrice[] = [];
  for (const tr of parse(html).querySelectorAll('table tr')) {
    const cells = tr.querySelectorAll('td').map(td => collapse(td.text));
    if (cells.length < 2 || !/€/.test(cells[1])) continue;
    const amount = parseAmount(cells[1].replace(/,-/, ''));
    if (amount) out.push({ label: cells[0], amount, perPerson: /p\.\s?P/i.test(cells[1]) });
  }
  return out;
}

/** geo.position meta of the site ("54.474674;13.147695"). */
export function umCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/<meta name="geo\.position" content="(-?\d+\.\d+);\s*(-?\d+\.\d+)"/);
  return m ? { lat: Math.round(Number(m[1]) * 1e5) / 1e5, lng: Math.round(Number(m[2]) * 1e5) / 1e5 } : null;
}

/** Kite course table: "Grundkurs*", "Mo, Fr", "3 Tage", "359,- €" rows -> "Grundkurs (3 Tage) EUR 359". */
export function parseUmKiteCourses(html: string): Array<{ name: string; duration: string; price: string }> {
  const lines = bodyLines(html);
  const end = lines.findIndex(l => /^Preise Equipment Miete$/i.test(l));
  const scope = lines.slice(0, end > 0 ? end : undefined);
  const out: Array<{ name: string; duration: string; price: string }> = [];
  for (let i = 0; i + 3 < scope.length; i++) {
    if (!/^[\dA-ZÄÖÜ][^€]*\*?$/.test(scope[i]) || !/(Tage?|Std\.)$/.test(scope[i + 2]) || !/€/.test(scope[i + 3])) continue;
    out.push({ name: scope[i].replace(/\*$/, ''), duration: scope[i + 2], price: scope[i + 3] });
    i += 3;
  }
  return out;
}

const DE_EN: Array<[RegExp, string]> = [
  [/^Grundkurs$/i, 'Beginner course'], [/^5 Tage Camp$/i, '5-day kite camp'], [/^Wochenendkurs$/i, 'Weekend course'],
  [/^Aufsteigerkurs$/i, 'Improver course'], [/^Privatstunde$/i, 'Private lesson'], [/^Schnuppertag$/i, 'Taster day'],
  [/^Betreutes Kiten$/i, 'Supervised kiting'], [/^Privatkurs \(2:1\)$/i, 'Private course (2:1)'], [/^Exklusivtraining \(1:1\)$/i, 'Exclusive training (1:1)'],
];
const en = (s: string): string => { for (const [re, t] of DE_EN) if (re.test(s)) return t; return s; };
const enDuration = (s: string): string => s.replace(/(\d+)\s*Tage?/, (_, n) => `${n} day${n === '1' ? '' : 's'}`).replace(/(\d+)\s*Std\./, (_, n) => `${n} h`);
const eur = (s: string): string => {
  const n = parseAmount(s.replace(/,-/, ''));
  return n ? `${/ab/i.test(s) ? 'from ' : ''}EUR ${n}${/p\.\s?P/i.test(s) ? ' per person' : ''}` : s;
};

/** Same photo in its TYPO3 variants (original, lightbox csm_*_<hash>, thumbnail csm_*_<other hash>). */
const photoKey = (u: string): string => (u.split('/').pop() ?? u).toLowerCase().replace(/^csm_/, '').replace(/_[0-9a-f]{10}(?=\.[a-z]+$)/, '');

/** Gallery: lightbox targets (<a href> to an image) first, then the content <img> of the page; logos, map, small teasers dropped. */
export function umImages(html: string, base: string, seen = new Set<string>()): string[] {
  const out: string[] = [];
  const add = (u: string) => {
    const abs = new URL(u, base).toString();
    if (!/\/fileadmin\/(?:redaktion|_processed_)\//.test(abs) || /logo|tricolore|Karte_|teaser-small|events\/|\.svg$/i.test(abs) || seen.has(photoKey(abs))) return;
    seen.add(photoKey(abs));
    out.push(abs);
  };
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]+\.(?:jpe?g|png|webp))"/gi)) add(m[1]);
  for (const m of html.matchAll(/<img\b[^>]*src="([^"]+\.(?:jpe?g|png|webp))"/gi)) add(m[1]);
  return out;
}

export interface UmPages { home: string; hostel: string; tiny: string; prices: string; kitePrices: string; sample: UmSample | null }

export function parseUmmaiiContent(p: UmPages): OfferContent {
  const home = bodyLines(p.home);
  const hostel = bodyLines(p.hostel);
  const tiny = bodyLines(p.tiny);
  const prices = parseUmPriceList(p.prices);
  const courses = parseUmKiteCourses(p.kitePrices);
  const coords = umCoords(p.home);
  const hostelText = hostel.join(' ');
  const price = (re: RegExp): number | null => prices.find(x => re.test(x.label))?.amount ?? null;
  const pp = (n: number | null) => (n ? `EUR ${n.toFixed(2)} per person` : null);
  const sample = p.sample && !p.sample.refused ? p.sample : null;
  const cardOf = (re: RegExp) => sample?.cards.find(c => re.test(c.name)) ?? null;
  /** "Online (Sirvoy, sample stay a..b): Main house single room EUR 40 for 1 guest; …" for the engine types matching `re` */
  const online = (re: RegExp): string | null => {
    const ts = (sample?.types ?? []).filter(t => re.test(t.name) && Object.keys(t.rates).length);
    if (!sample || !ts.length) return null;
    const parts = ts.map(t => `${umUnitName(t.name)} EUR ${money(t.rates[occOf(t)])} for ${occOf(t)} guest${occOf(t) > 1 ? 's' : ''}`);
    return `Online per night (Sirvoy, sample stay ${sample.checkIn}..${sample.checkOut}): ${parts.join('; ')}`;
  };
  const nBungalows = hostelText.match(/befinden sich (\d+) Bungalows/)?.[1] ?? null;
  const kp = bodyLines(p.kitePrices);
  const licence = parseAmount((kp[kp.findIndex(l => /^Kitelizenz$/i.test(l)) + 2] ?? '').replace(/,-/, ''));

  const rooms: ContentRoom[] = [
    {
      name: UM_ROOM_MAIN_HOUSE,
      description: 'Simple heated 1- to 4-bed rooms on the first floor of the main house (renovated 2019), shower and WC on the floor; reception, dining rooms and kitchen downstairs.',
      features: [
        price(/Haupthaus 1 er/i) ? `Price list (no year printed): single use ${pp(price(/Haupthaus 1 er/i))}, double use ${pp(price(/Haupthaus 2 er/i))}, 3 or more ${pp(price(/Haupthaus ab 3/i))} per night incl. breakfast` : null,
        online(/Haupthaus/i),
      ].filter((x): x is string => !!x),
    },
    {
      name: UM_ROOM_BUNGALOW,
      description: `${nBungalows ?? 'Five'} heated bungalows (redesigned 2017), each with one 8-bed and one 6-bed room with bunk beds; shared central washrooms like on a campsite.`,
      features: [
        price(/Bungalow 1 er/i) ? `Price list (no year printed): single use ${pp(price(/Bungalow 1 er/i))}, double use ${pp(price(/Bungalow 2 er/i))}, 3 or more ${pp(price(/Bungalow ab 3/i))} per night incl. breakfast` : null,
        online(/^Bungalow/i),
      ].filter((x): x is string => !!x),
    },
    {
      name: 'Tree house',
      description: 'Tree house about 6 m up at the edge of the grounds with a double bed, small fridge and a large sunset terrace with hammocks; shower and WC in the central wash house; for up to 2 people, breakfast and final cleaning included.',
      features: [
        price(/Baumhaus/i) ? `Price list (no year printed): EUR ${price(/Baumhaus/i)} per night for 2 incl. breakfast` : null,
        online(/^Baumhaus$/i),
      ].filter((x): x is string => !!x),
    },
    ...[1, 2].map(n => ({
      name: `Tiny House ${n}`,
      description: `Self-built tiny house on an old construction-trailer chassis with double bed and pull-out beds, heating, shower/WC, kitchen and a sunset terrace facing the water${n === 2 ? '; Tiny House 2 also has a guest room with panoramic view and a sofa bed' : ''}. Minimum stay 4 nights.`,
      features: [
        cardOf(new RegExp(`^Tiny\\s?haus ${n}$`, 'i'))?.beds ? `Bed spaces: ${cardOf(new RegExp(`^Tiny\\s?haus ${n}$`, 'i'))!.beds}` : null,
        price(new RegExp(`Tiny\\s?haus ${n}`, 'i')) ? `Price list (no year printed): EUR ${price(new RegExp(`Tiny\\s?haus ${n}`, 'i'))} per night plus final cleaning` : null,
        online(new RegExp(`^Tiny\\s?haus ${n}$`, 'i')),
        'Final cleaning EUR 40 (online)',
      ].filter((x): x is string => !!x),
    })),
  ];

  const rates = (sample?.types ?? []).map(t => t.rates[ADULTS]).filter((x): x is number => !!x);
  const seen = new Set<string>();
  const imgs = [...umImages(p.hostel, UM_HOSTEL_URL, seen), ...umImages(p.home, UM_HOME_URL, seen), ...umImages(p.tiny, UM_TINY_URL, seen)];

  const summary = [
    'UMMAII is a surf hostel in Haide on the island of Ummanz off western Rügen, inside the Vorpommersche Boddenlandschaft National Park; its own wind- and kitesurf school (courses since 1994, VDWS licences) runs the water sports centre at the Regenbogen campsite in Suhrendorf on what the site calls Germany\'s largest standing-depth spot.',
    `Guests stay in simple 1- to 4-bed rooms in the main house, in group bungalows with 6- and 8-bed rooms, in a tree house or in two tiny houses with bathroom, kitchen and sunset terrace (minimum 4 nights)${rates.length ? `; online rates for 2 guests run from EUR ${Math.min(...rates)} to ${Math.max(...rates)} per unit per night` : ''}.`,
    'Breakfast is a buffet in the main house (bookable online at EUR 11 per person plus drinks), and the grounds have a Tiki bar, beer garden and live music in summer.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'UMMAII Surfhostel, Tiny Houses & Baumhaus',
    summary,
    continent: 'Europe',
    country: 'Germany',
    region: 'Suhrendorf, Rügen',
    spot: 'Suhrendorf, Ummanz',
    ...(coords ? { spotCoords: coords } : {}),
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: courses.length > 0 || /Kitesurfkurs/i.test(home.join(' ')),
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: ['Use of the 10,000 m² grounds: hammock park, beer garden, basketball, volleyball and football fields'],
    optionalServices: [
      ...courses.map(c => `Kite school: ${en(c.name)} (${enDuration(c.duration)}), ${eur(c.price)}`),
      ...(licence ? [`VDWS kite licence incl. workbook EUR ${licence}`] : []),
      'Breakfast buffet EUR 11.00 per person + EUR 1.90 drinks per day (online)',
      'Dinner (half board) EUR 12.90 per person, on request',
      'Bed linen EUR 10 per person',
      'Final cleaning EUR 10 per room / EUR 40 per tiny house',
      'Wing, windsurf and SUP courses and rental at the school',
    ],
    accommodation: 'surf hostel rooms, group bungalows, tree house and tiny houses',
    mealPlan: 'breakfast optional',
    languages: ['de'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: UM_HOSTEL_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${home.filter(l => /Stehrevier|Kitesurfkurs|Regenbogen|Kiteschule|Schulung|Festival|VDWS/i.test(l)).join(' | ')}`,
      `hostel: ${hostel.filter(l => /^Kat\.|Bungalows|Tiki/i.test(l)).join(' | ')}`,
      `tiny houses: ${tiny.find(l => /Tiny/i.test(l) && l.length > 100) ?? ''}`,
      `price list (no year): ${prices.map(x => `${x.label} = ${x.amount}${x.perPerson ? ' p.P.' : ''}`).join('; ')}`,
      `kite courses: ${courses.map(c => `${c.name} ${c.duration} ${c.price}`).join('; ')}`,
      `sirvoy sample ${p.sample ? `${p.sample.checkIn}..${p.sample.checkOut} ${p.sample.refused ?? p.sample.currency}` : '-'}: ${(p.sample?.types ?? []).map(t => `${t.name} ${JSON.stringify(t.rates)} free ${t.freeUnits}`).join('; ')}`,
    ].join('\n'),
  };
}

export async function fetchUmContent(ctx: FetchContext, today: string): Promise<OfferContent> {
  const home = await fetchText(UM_HOME_URL, { accept: 'text/html' });
  const hostel = await fetchText(UM_HOSTEL_URL, { accept: 'text/html' });
  const tiny = await fetchText(UM_TINY_URL, { accept: 'text/html' });
  const prices = await fetchText(UM_PRICES_URL, { accept: 'text/html' });
  const kitePrices = await fetchText(UM_KITE_PRICES_URL, { accept: 'text/html' });
  if (!/Kitesurfkurs|Kiteschule/i.test(home)) throw new Error('ummaii: kite school text missing on the home page');
  let sample: UmSample | null = null;
  const first = umSampleStays(today)[0];
  if (first) {
    try { sample = await fetchUmSample(first.checkIn, first.checkOut); }
    catch (e) { ctx.note(`ummaii: Sirvoy room types not read: ${(e as Error).message}`); }
  }
  return parseUmmaiiContent({ home, hostel, tiny, prices, kitePrices, sample });
}

// --- adapter ----------------------------------------------------------------------------------
export const ummaiiSurfhostelUmmanz: OfferAdapter = {
  key: 'ummaii-surfhostel-ummanz',
  name: 'UMMAII Surfhostel, Ummanz (Rügen)',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'UMMAII Surfhostel (Uns eigen eG)',
    websiteUrl: SITE,
    rootDomain: 'ummaii.de',
    contactEmail: 'betrieb@uns-eigen.de',
    phone: '+493830555018',
  },
  url: UM_HOSTEL_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 19,
  fetchContent: ctx => fetchUmContent(ctx, todayIso()),
  fetchSlots: ctx => fetchUmSlots(ctx, todayIso()),
};
