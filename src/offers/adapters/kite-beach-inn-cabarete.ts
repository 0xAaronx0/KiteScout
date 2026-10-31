// ---------------------------------------------------------------------------
// Kite Beach Inn, Cabarete (Puerto Plata, Dominican Republic) - 26-room budget beach hotel directly on Kite Beach;
// kites launch off the property, IKO-certified schools next door, hotel + kite lesson packages on request.
//
// Data path (checked 2026-10-12): WordPress (Avada), server-rendered:
//   content  / (intro, "Why Choose Us"), /about-us/ (26 rooms, launch from the property, Google Maps embed
//            !3d19.7626 !2d-70.4224), /specials-2-2/ (weekly specials, hotel/kite lesson packages, photos)
//            + the room types (name, bed spaces, description) of the first Sirvoy sample below.
//   slots    Sirvoy booking engine, the site's own widget on /booking/ (<script src=".../widget/sirvoy.js"
//            data-form-id="ed212d53a23bbba9a952f18681213b7e">). Per sample stay the widget makes two anonymous
//            calls, and so do we:
//              POST secured.sirvoy.com/widget/book_widget_cors.js  JSON {form_id, widget:"normal", adults,
//                   check_in, check_out, target:"results", ...}  -> {status:"ok", t:<engine session id>, html:<iframe>}
//              GET  secured.sirvoy.com/engine/book_results?t=<t>&id=<form id>&container_id=sbw_widget_1
//                   -> results page; per room type data-room-type-data='{"name", "rateByOccupancy":{"1":{"rate"},
//                   "2":{...}}, "availableUnitIds":[...]}' and the card text (bed spaces, description);
//                   "customerCurrency":"USD".
//            No login, cookie or signed header: the session id comes back in the first answer. The engine has
//            no availability calendar ("isAvailCalAllowed":false), so we sample one 3-night stay for 2 adults
//            per month (arrival on the 15th, or tomorrow in the current month), 6 months ahead.
// robots.txt (2026-10-12): www.kitebeachinn.com Yoast default (nothing disallowed); secured.sirvoy.com
//   "User-agent: *" without rules -> allowed.
// Requests per run: content 3 + 2 (first sample, memoised), slots 6 samples x 2 = 12 -> 15 for a full run.
// Parsed: per room type, month bands merged where price and availability class stay the same (runsOf):
//   USD per room per night for 2 guests (1 for single-occupancy types), 'available' (3+ free units) /
//   'limited' (1-2 units, spotsLeft) for the sample stay, 'unknown' when the type is missing from a sample;
//   availabilityText names the sample stay.
// Known limits: one 3-night sample per month - prices or availability on other dates of the month can
//   differ; the weekly specials (7 nights USD 385 / 560, by e-mail) and monthly rates stay in the content.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, iso, parse, runsOf, todayIso } from '../parse.js';
import type { Availability, ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kitebeachinn.com';
export const KBI_HOME_URL = `${SITE}/`;
export const KBI_ABOUT_URL = `${SITE}/about-us/`;
export const KBI_SPECIALS_URL = `${SITE}/specials-2-2/`;
const BOOKING_URL = `${SITE}/booking/`;
const SIRVOY = 'https://secured.sirvoy.com';
export const KBI_FORM_ID = 'ed212d53a23bbba9a952f18681213b7e';
export const KBI_WIDGET_URL = `${SIRVOY}/widget/book_widget_cors.js`;
const ADULTS = 2;
const NIGHTS = 3;
const MONTHS = 6;

export interface KbiRoomType { name: string; rates: Record<number, number>; freeUnits: number; dorm: boolean }
export interface KbiRoomCard { name: string; beds: string | null; description: string | null }
export interface KbiSample { checkIn: string; checkOut: string; currency: string; types: KbiRoomType[]; cards: KbiRoomCard[] }

// --- local helpers ----------------------------------------------------------------------------
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysIn(y: number, m: number): number { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function decode(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// --- sample stays ------------------------------------------------------------------------------
/** One 3-night stay per month: arrival on the 15th (or tomorrow in the current month), 6 months from today. */
export function kbiSampleStays(today: string): Array<{ checkIn: string; checkOut: string }> {
  const y = Number(today.slice(0, 4)); const m = Number(today.slice(5, 7));
  const tomorrow = addDays(today, 1);
  const out: Array<{ checkIn: string; checkOut: string }> = [];
  for (let k = 0; k < MONTHS; k++) {
    const mm = ((m - 1 + k) % 12) + 1; const yy = y + Math.floor((m - 1 + k) / 12);
    let checkIn = iso(yy, mm, 15);
    if (checkIn < tomorrow) checkIn = tomorrow;
    if (checkIn.slice(0, 7) !== iso(yy, mm, 1).slice(0, 7)) continue;
    out.push({ checkIn, checkOut: addDays(checkIn, NIGHTS) });
  }
  return out;
}

/** Body the site's widget posts (data attributes of the /booking/ script tag + the search dates). */
export function kbiWidgetBody(checkIn: string, checkOut: string): string {
  return JSON.stringify({
    container_id: 'sbw_widget_1', widget: 'normal', source: null, context: 'default', guest_id: null, copy_booking_id: null,
    form_id: KBI_FORM_ID, adults: String(ADULTS), check_in: checkIn, check_out: checkOut, target: 'results',
    host_page_url: BOOKING_URL, wp_plugin_version: 'legacy',
  });
}

/** Widget answer -> results page URL (engine session id `t`). */
export function kbiResultsUrl(widgetJson: string): string | null {
  const d = JSON.parse(widgetJson) as { status?: string; t?: string; html?: string };
  if (d.status !== 'ok') return null;
  const src = d.html?.match(/src="([^"]+)"/)?.[1];
  if (src) return decode(src);
  return d.t ? `${SIRVOY}/engine/book_results?t=${d.t}&id=${KBI_FORM_ID}&container_id=sbw_widget_1` : null;
}

/** Results page -> room types (rates per occupancy, free units), cards (beds, description), currency. */
export function parseKbiResults(html: string): { currency: string; types: KbiRoomType[]; cards: KbiRoomCard[] } {
  const types: KbiRoomType[] = [];
  for (const m of html.matchAll(/data-room-type-data="([^"]*)"/g)) {
    try {
      const d = JSON.parse(decode(m[1])) as { name?: string; is_dorm?: boolean; rateByOccupancy?: Record<string, { rate?: number }>; availableUnitIds?: unknown[] };
      if (!d.name) continue;
      const rates: Record<number, number> = {};
      for (const [occ, r] of Object.entries(d.rateByOccupancy ?? {})) if (Number(r?.rate) > 0) rates[Number(occ)] = Number(r.rate);
      types.push({ name: collapse(d.name), rates, freeUnits: Array.isArray(d.availableUnitIds) ? d.availableUnitIds.length : 0, dorm: !!d.is_dorm });
    } catch { /* broken attribute: skip */ }
  }
  const cards = parse(html).querySelectorAll('.card-item__description').map(el => ({
    name: collapse(el.querySelector('h3')?.text ?? ''),
    beds: el.querySelector('.amenities__amount')?.getAttribute('title')?.match(/:\s*(.+)$/)?.[1]?.trim() ?? null,
    description: collapse(el.querySelector('.sirvoy-long-text')?.text ?? '') || null,
  })).filter(c => c.name);
  const currency = decode(html).match(/customerCurrency\\?":\\?"([A-Z]{3})/)?.[1] ?? html.match(/Total\s*\(([A-Z]{3})\)/)?.[1] ?? null;
  if (!currency) throw new Error('kite-beach-inn: Sirvoy results page without a currency (customerCurrency / "Total (XXX)")');
  return { currency, types, cards };
}

/** Month bands per room type from the samples (merged where price and availability class repeat). */
export function buildKbiSlots(samples: KbiSample[], today: string): Slot[] {
  const names: string[] = [];
  for (const s of samples) for (const t of s.types) if (!names.includes(t.name)) names.push(t.name);
  const out: Slot[] = [];
  for (const name of names) {
    type Day = { date: string; sample: KbiSample; type: KbiRoomType | null };
    const days: Day[] = [];
    for (const s of samples) {
      const y = Number(s.checkIn.slice(0, 4)); const m = Number(s.checkIn.slice(5, 7));
      const t = s.types.find(x => x.name === name) ?? null;
      // the sample stands for its calendar month, from today on
      for (let d = 1; d <= daysIn(y, m); d++) if (iso(y, m, d) >= today) days.push({ date: iso(y, m, d), sample: s, type: t });
    }
    const occ = (t: KbiRoomType) => (t.rates[ADULTS] ? ADULTS : Math.max(...Object.keys(t.rates).map(Number)));
    const cls = (t: KbiRoomType | null): Availability => (!t || !Object.keys(t.rates).length ? 'unknown' : t.freeUnits === 0 ? 'sold_out' : t.freeUnits <= 2 ? 'limited' : 'available');
    const state = (d: Day) => `${cls(d.type)}|${d.type && Object.keys(d.type.rates).length ? d.type.rates[occ(d.type)] : '-'}`;
    for (const run of runsOf(days, state)) {
      const t = run.first.type;
      const a = cls(t);
      const priced = t && a !== 'unknown';
      out.push({
        key: `${keyPart(name)}|${run.start}`,
        startDate: run.start,
        endDate: run.end,
        unit: name,
        price: priced ? t!.rates[occ(t!)] : null,
        currency: priced ? run.first.sample.currency : null,
        priceUnit: priced ? 'per_night' : null,
        priceBasis: t?.dorm ? 'person' : 'room',
        occupancy: priced ? occ(t!) : null,
        availability: a,
        availabilityText: priced
          ? `${t!.freeUnits} unit(s) free for the sample stay ${run.first.sample.checkIn}..${run.first.sample.checkOut} (Sirvoy)`
          : `not offered for the sample stay ${run.first.sample.checkIn}..${run.first.sample.checkOut} (booked or closed)`,
        spotsLeft: a === 'limited' ? t!.freeUnits : null,
      });
    }
  }
  return out;
}

// --- engine calls (memoised per stay for 10 minutes: content and slots share the first sample) ----------
const sampleMemo = new Map<string, { at: number; p: Promise<KbiSample> }>();
export function fetchKbiSample(checkIn: string, checkOut: string): Promise<KbiSample> {
  const k = `${checkIn}|${checkOut}`;
  const hit = sampleMemo.get(k);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = (async () => {
    const widget = await fetchText(KBI_WIDGET_URL, { method: 'POST', body: kbiWidgetBody(checkIn, checkOut), contentType: 'application/json', accept: 'application/json' });
    const url = kbiResultsUrl(widget);
    if (!url) throw new Error(`kite-beach-inn: Sirvoy widget answered without an engine session (${widget.slice(0, 120)})`);
    const r = parseKbiResults(await fetchText(url, { accept: 'text/html' }));
    return { checkIn, checkOut, ...r };
  })();
  sampleMemo.set(k, { at: Date.now(), p });
  p.catch(() => sampleMemo.delete(k));
  return p;
}

export async function fetchKbiSlots(ctx: FetchContext, today: string): Promise<Slot[]> {
  const samples: KbiSample[] = [];
  for (const s of kbiSampleStays(today)) {
    try { samples.push(await fetchKbiSample(s.checkIn, s.checkOut)); }
    catch (e) { ctx.incomplete(`Sirvoy sample ${s.checkIn}..${s.checkOut}: ${(e as Error).message}`); }
  }
  if (samples.length === 0) throw new Error('kite-beach-inn: no Sirvoy sample stay could be read');
  if (samples.every(s => s.types.length === 0)) ctx.note('Sirvoy returned no room types for any sample stay');
  return buildKbiSlots(samples, today);
}

// --- content ----------------------------------------------------------------------------------
function textLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav, #sidebar')) el.remove();
  const scope = root.querySelector('#content') ?? root.querySelector('.post-content') ?? root.querySelector('body') ?? root;
  return scope.querySelectorAll('h1, h2, h3, h4, p, li').map(e => collapse(e.text)).filter(Boolean);
}

/** Google Maps embed on /about-us/: !3d<lat> !2d<lng>. */
export function kbiCoords(aboutHtml: string): { lat: number; lng: number } | null {
  const m = aboutHtml.match(/google\.com\/maps\/embed\?pb=[^"']*?!2d(-?[\d.]+)!3d(-?[\d.]+)/);
  return m ? { lat: Math.round(Number(m[2]) * 1e5) / 1e5, lng: Math.round(Number(m[1]) * 1e5) / 1e5 } : null;
}

export interface KbiPages { home: string; about: string; specials: string; sample: KbiSample | null }

export function parseKiteBeachInnContent(p: KbiPages): OfferContent {
  const home = textLines(p.home);
  const about = textLines(p.about);
  const specials = textLines(p.specials);
  const aboutText = about.join(' ');
  const coords = kbiCoords(p.about);
  const nRooms = aboutText.match(/(\d+)-room/)?.[1] ?? null;
  const weekly = [...specials.join('\n').matchAll(/^([^\n]*?)\n7 nights for USD \$(\d+)/gm)].map(m => ({ room: m[1], price: Number(m[2]) }));
  const why = (() => {
    const a = home.findIndex(l => /^Why Choose Us$/i.test(l));
    return a < 0 ? [] : home.slice(a + 1, a + 9).filter(l => l.length < 40);
  })();
  const types = p.sample?.types ?? [];
  const rooms: ContentRoom[] = (p.sample?.cards ?? []).map(c => {
    const t = types.find(x => x.name === c.name);
    const r2 = t ? (t.rates[2] ?? t.rates[1]) : undefined;
    return {
      name: c.name,
      description: c.description,
      features: [
        c.beds ? `Bed spaces: ${c.beds}` : null,
        r2 ? `USD ${r2} per night (online rate, sample stay ${p.sample!.checkIn}..${p.sample!.checkOut})` : null,
      ].filter((x): x is string => !!x),
    };
  });
  const rates = types.map(t => t.rates[2] ?? t.rates[1]).filter((x): x is number => !!x);

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const [html, base] of [[p.home, KBI_HOME_URL], [p.specials, KBI_SPECIALS_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 60)) {
      if (!/kitebeachinn\.com\/wp-content\/uploads\//.test(u) || /logo|favicon|certificate|\.png$|thumb-\d|special-banner|\/img\.jpg$/i.test(u)) continue;
      const k = u.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '');
      if (seen.has(k)) continue;
      seen.add(k); imageUrls.push(u);
    }
  }

  const summary = [
    `Kite Beach Inn is a ${nRooms ? `${nRooms}-room ` : ''}budget beachfront hotel directly on Kite Beach in Cabarete, on the north coast of the Dominican Republic; kites launch on the beach right off the property and IKO-certified kite schools are close by.`,
    `Rooms range from standard rooms to ocean-view studios with kitchenettes and penthouse studios${rates.length ? ` (online from USD ${Math.min(...rates)} to ${Math.max(...rates)} per room per night, taxes included)` : ''}, with free Wi-Fi, a pool, maid service and 24/7 electricity.`,
    `The hotel works with an IKO-certified kite school for hotel and lesson packages on request${weekly.length ? `, and sells weekly specials by e-mail (7 nights from USD ${Math.min(...weekly.map(w => w.price))})` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Kite Beach Inn',
    summary,
    continent: 'North America',
    country: 'Dominican Republic',
    region: 'Puerto Plata',
    spot: 'Kite Beach, Cabarete',
    ...(coords ? { spotCoords: coords } : {}),
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    // specials page: "The kiteboarding school provides beginner, advanced and custom-designed classes" (2026-10-12)
    skillLevels: /beginner, advanced/i.test(specials.join(' ')) ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: null, // lessons by partner schools, not the hotel
    equipmentRental: null,
    beginnerFriendly: null,
    includedServices: why.length ? why.filter(l => !/location|value/i.test(l)) : ['Free high speed internet', '24/7 electricity', 'Hot water', 'Maid service'],
    optionalServices: [
      'Hotel + kiteboarding lesson packages with an IKO-certified school (on request)',
      'Hotel + surf lesson packages (Encuentro Beach surf school, on request)',
      ...weekly.map(w => `Weekly special ${w.room}: 7 nights USD ${w.price} (direct booking by e-mail; not Christmas, New Year or Easter weeks)`),
      'Monthly rental rates for selected units (on request)',
      'Taxi, lessons and tours booked at the reception',
      'Laundry service (paid)',
    ],
    accommodation: 'beachfront hotel rooms and studios',
    mealPlan: null, // no meals; 3 restaurants within a 3-minute walk (about page)
    languages: ['en', 'es'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KBI_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${home.join(' ')}`,
      `about: ${aboutText}`,
      `specials: ${specials.join(' ')}`,
      `sirvoy sample ${p.sample ? `${p.sample.checkIn}..${p.sample.checkOut} ${p.sample.currency}` : '-'}: ${types.map(t => `${t.name} ${JSON.stringify(t.rates)} free ${t.freeUnits}`).join('; ')}`,
    ].join('\n'),
  };
}

export async function fetchKbiContent(ctx: FetchContext, today: string): Promise<OfferContent> {
  const home = await fetchText(KBI_HOME_URL, { accept: 'text/html' });
  const about = await fetchText(KBI_ABOUT_URL, { accept: 'text/html' });
  const specials = await fetchText(KBI_SPECIALS_URL, { accept: 'text/html' });
  let sample: KbiSample | null = null;
  const first = kbiSampleStays(today)[0];
  try { sample = await fetchKbiSample(first.checkIn, first.checkOut); }
  catch (e) { ctx.note(`Sirvoy room types not read: ${(e as Error).message}`); }
  return parseKiteBeachInnContent({ home, about, specials, sample });
}

// --- adapter ----------------------------------------------------------------------------------
export const kiteBeachInnCabarete: OfferAdapter = {
  key: 'kite-beach-inn-cabarete',
  name: 'Kite Beach Inn, Cabarete',
  kind: 'accommodation',
  operator: {
    name: 'Kite Beach Inn',
    websiteUrl: SITE,
    rootDomain: 'kitebeachinn.com',
    contactEmail: 'info@kitebeachinn.com',
    phone: '+18094905517',
    whatsapp: '+18094905517',
  },
  url: KBI_HOME_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 15,
  fetchContent: ctx => fetchKbiContent(ctx, todayIso()),
  fetchSlots: ctx => fetchKbiSlots(ctx, todayIso()),
};
