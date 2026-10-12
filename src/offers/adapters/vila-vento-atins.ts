// ---------------------------------------------------------------------------
// Vila Vento, Atins (Lençóis Maranhenses, Maranhão, Brazil) - family boutique hotel built by kitesurfers on
// Atins beach: wooden beachfront bungalows and a beach house, own Lençóis Kiteboarding School, guests
// launch and land their kites in the yard.
//
// Data path (checked 2026-10-12):
//   content  www.vilavento.com (ASP.NET site): home (unit cards: name, "up to N guests", text), /SPAges/
//            page.aspx?s=about-us&Id=24 (story, kite yard), /SPAges/suite.aspx?s=<unit>&Id=<n> per unit
//            (description + "Amenities:" list + photos).
//   slots    BedBooking (bed-booking.com) - the site's own engine: /SPAges/bookpage.aspx?Id=24 embeds the
//            BedBooking widget (widgetId below); its booking page vilavento.bed-booking.com calls
//              GET api-widget.bed-booking.com/settings/key/<widgetId>         -> rooms, min_days, restrictions
//              GET .../offers/busy/vilavento/start/<unix>/end/<unix>/group/0  -> busy dates per room
//              GET .../offers/vilavento/start/<unix>/end/<unix>/persons/2/kids/0/age/0
//                  -> free rooms for that stay with price, price_per_night, nights
//            (unix = UTC midnight in seconds, as the widget computes it). Currency: object.currency
//            {id 26, "BRL"} in the booking page's __NEXT_DATA__ (2026-10-12), constant below.
// robots.txt (2026-10-12): www.vilavento.com disallows only ASP.NET internals (/default.aspx, /Admin/, ...);
//   api-widget.bed-booking.com and vilavento.bed-booking.com have none (404) -> allowed.
// Requests per run: content 2 + one per unit page (5) = 7; slots 2 + at most 8 sample stays.
// Parsed: per unit, bands where the BedBooking calendar changes state (runsOf): free (price per night
//   for 2 adults from one sample stay per month), booked (sold_out), or closed (every unit blocked for
//   4+ weeks: season closed or dates not released - BedBooking does not say which); BRL per room per
//   night, minNights from the engine's restrictions / min_days.
// Known limits: prices are sampled once per month (cheapest sample stay that covers the most free
//   units); a unit not free on any sampled stay keeps price null for that month.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, iso, parse, runsOf, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.vilavento.com';
export const VV_HOME_URL = `${SITE}/`;
const ABOUT_URL = `${SITE}/SPAges/page.aspx?s=about-us&Id=24`;
const BOOK_URL = `${SITE}/SPAges/bookpage.aspx?Id=24`;
const BB_API = 'https://api-widget.bed-booking.com';
const BB_SUBDOMAIN = 'vilavento';
const BB_WIDGET_ID = '4521b6fc8e236c487d89c9655e2eae6fbbc9f467'; // public widgetId in bookpage.aspx
const CURRENCY = 'BRL';
const ADULTS = 2;
const MONTHS = 6;
const MAX_SAMPLES = 8;
/** an all-units-busy stretch at least this long is a closure, not bookings */
const CLOSED_MIN_DAYS = 28;

export const vvSettingsUrl = (): string => `${BB_API}/settings/key/${BB_WIDGET_ID}`;
const unix = (isoDate: string): number => Date.parse(`${isoDate}T00:00:00Z`) / 1000;
export const vvBusyUrl = (from: string, toExclusive: string): string => `${BB_API}/offers/busy/${BB_SUBDOMAIN}/start/${unix(from)}/end/${unix(toExclusive)}/group/0`;
export const vvOffersUrl = (checkIn: string, checkOut: string): string =>
  `${BB_API}/offers/${BB_SUBDOMAIN}/start/${unix(checkIn)}/end/${unix(checkOut)}/persons/${ADULTS}/kids/0/age/0`;

export interface VvRoom { id: number; name: string; capacity: number | null }
export interface VvRestriction { room: number; from: string; to: string; minStay: number }
export interface VvSettings { rooms: VvRoom[]; minDays: number; restrictions: VvRestriction[] }
export interface VvSample { checkIn: string; checkOut: string; nights: number; rooms: number[] }
export interface VvSampleResult { stay: VvSample; prices: Map<number, number> }

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** "VILA ALIZE BEACH HOUSE" / "Casa do pescador" -> "Vila Alize Beach House" / "Casa do Pescador" */
const titleCase = (s: string): string => s.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()).replace(/ (Do|Da|De|Dos|Das) /g, m => m.toLowerCase());
function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysIn(year: number, month: number): number { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
const fromUnix = (s: number): string => new Date(s * 1000).toISOString().slice(0, 10);

/** today .. last day of month +(MONTHS-1) */
export function vvWindow(today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4)); const m = Number(today.slice(5, 7));
  const k = m - 1 + MONTHS - 1;
  const ey = y + Math.floor(k / 12); const em = (k % 12) + 1;
  return { from: today, to: iso(ey, em, daysIn(ey, em)) };
}

// --- pure parsers -----------------------------------------------------------------------------
export function parseVvSettings(json: string): VvSettings {
  const d = (JSON.parse(json) as { data?: Record<string, unknown> }).data ?? {};
  const rooms = ((d.rooms as Array<Record<string, unknown>> | undefined) ?? [])
    .filter(r => Number(r.deleted ?? 0) === 0 && Number(r.show_in_search ?? 1) === 1)
    .map(r => ({ id: Number(r.id), name: titleCase(collapse(String(r.name ?? ''))), capacity: Number(r.capacity) || null }))
    .filter(r => r.id && r.name);
  const restrictions = ((d.restrictions as Array<Record<string, unknown>> | undefined) ?? []).map(r => ({
    room: Number(r.id_room),
    from: fromUnix(Number(r.restriction_day_from)),
    to: fromUnix(Number(r.restriction_day_to)),
    minStay: Number(r.restriction_min_stay) || 1,
  }));
  return { rooms, minDays: Number(d.min_days) || 1, restrictions };
}

/** busy dates per room id */
export function parseVvBusy(json: string): Map<number, Set<string>> {
  const d = (JSON.parse(json) as { data?: { busy?: Record<string, string[]> } }).data ?? {};
  const out = new Map<number, Set<string>>();
  for (const [id, days] of Object.entries(d.busy ?? {})) out.set(Number(id), new Set(days));
  return out;
}

/** /offers answer: free room id -> price per night (for the stay that was asked) */
export function parseVvOffers(json: string): Map<number, number> {
  const d = JSON.parse(json) as { data?: Array<{ id_room?: number; price_per_night?: number; price?: number; nights?: number }> };
  const out = new Map<number, number>();
  for (const o of Array.isArray(d.data) ? d.data : []) {
    const per = Number(o.price_per_night) || (Number(o.price) && Number(o.nights) ? Number(o.price) / Number(o.nights) : 0);
    if (o.id_room && per > 0) out.set(Number(o.id_room), Math.round(per * 100) / 100);
  }
  return out;
}

export function vvMinStay(s: VvSettings, room: number, date: string): number {
  const r = s.restrictions.find(x => x.room === room && x.from <= date && date <= x.to);
  return Math.max(1, r?.minStay ?? s.minDays);
}

function windowDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Days on which every unit is busy, in runs of at least CLOSED_MIN_DAYS (closure, not bookings). */
export function vvClosedDays(rooms: VvRoom[], busy: Map<number, Set<string>>, days: string[]): Set<string> {
  const all = days.filter(d => rooms.length > 0 && rooms.every(r => busy.get(r.id)?.has(d))).map(date => ({ date }));
  const out = new Set<string>();
  for (const run of runsOf(all, () => 'x')) if (run.days.length >= CLOSED_MIN_DAYS) run.days.forEach(d => out.add(d.date));
  return out;
}

/** Per month: sample stays (arrival from tomorrow) that together cover the units free in that month; most units first. */
export function vvSampleStays(s: VvSettings, busy: Map<number, Set<string>>, today: string): VvSample[] {
  const win = vvWindow(today);
  const tomorrow = addDays(today, 1);
  const out: VvSample[] = [];
  const free = (room: number, d: string, n: number): boolean => {
    for (let k = 0; k < n; k++) { const x = addDays(d, k); if (x > win.to || busy.get(room)?.has(x)) return false; }
    return true;
  };
  const yms = [...new Set(windowDays(win.from, win.to).map(d => d.slice(0, 7)))];
  for (const ym of yms) {
    const arrivals = windowDays(win.from, win.to).filter(d => d.startsWith(ym) && d >= tomorrow);
    const nightsFor = (d: string) => Math.max(...s.rooms.map(r => vvMinStay(s, r.id, d)));
    let uncovered = s.rooms.filter(r => arrivals.some(d => free(r.id, d, nightsFor(d)))).map(r => r.id);
    for (let pick = 0; pick < 2 && uncovered.length && out.length < MAX_SAMPLES; pick++) {
      let best: { d: string; n: number; rooms: number[] } | null = null;
      for (const d of arrivals) {
        const n = nightsFor(d);
        const hit = uncovered.filter(id => free(id, d, n));
        if (hit.length && (!best || hit.length > best.rooms.length)) best = { d, n, rooms: hit };
      }
      if (!best) break;
      out.push({ checkIn: best.d, checkOut: addDays(best.d, best.n), nights: best.n, rooms: best.rooms });
      uncovered = uncovered.filter(id => !best!.rooms.includes(id));
    }
  }
  return out;
}

/** Bands per unit where the calendar state or the month's sampled price changes. */
export function buildVvSlots(s: VvSettings, busy: Map<number, Set<string>>, samples: VvSampleResult[], today: string): Slot[] {
  const win = vvWindow(today);
  const days = windowDays(win.from, win.to);
  const closed = vvClosedDays(s.rooms, busy, days);
  const out: Slot[] = [];
  for (const room of s.rooms) {
    // month -> lowest sampled nightly price for this unit (and the stay it came from)
    const monthPrice = new Map<string, { price: number; stay: VvSample }>();
    for (const r of samples) {
      const p = r.prices.get(room.id);
      const ym = r.stay.checkIn.slice(0, 7);
      if (p !== undefined && (!monthPrice.has(ym) || p < monthPrice.get(ym)!.price)) monthPrice.set(ym, { price: p, stay: r.stay });
    }
    const state = (d: string): string => {
      if (closed.has(d)) return 'closed';
      if (busy.get(room.id)?.has(d)) return 'busy';
      return `free|${monthPrice.get(d.slice(0, 7))?.price ?? '-'}|${vvMinStay(s, room.id, d)}`;
    };
    for (const run of runsOf(days.map(date => ({ date })), d => state(d.date))) {
      const st = state(run.start);
      const sample = st.startsWith('free') ? monthPrice.get(run.start.slice(0, 7)) ?? null : null;
      const minStay = vvMinStay(s, room.id, run.start);
      out.push({
        key: `${keyPart(room.name)}|${run.start}`,
        startDate: run.start,
        endDate: run.end,
        unit: room.name,
        price: sample?.price ?? null,
        currency: sample ? CURRENCY : null,
        priceUnit: sample ? 'per_night' : null,
        priceBasis: 'room',
        occupancy: ADULTS,
        availability: st === 'closed' ? 'closed' : st === 'busy' ? 'sold_out' : 'available',
        availabilityText: st === 'closed'
          ? 'every unit blocked in the BedBooking calendar (season closed or dates not released)'
          : st === 'busy'
            ? 'booked or blocked in the BedBooking calendar'
            : sample
              ? `free in the BedBooking calendar; price for ${ADULTS} adults from the sample stay ${sample.stay.checkIn}..${sample.stay.checkOut}`
              : 'free in the BedBooking calendar; no sample stay priced this unit in this month',
        spotsLeft: null,
        minNights: st.startsWith('free') && minStay > 1 ? minStay : null,
      });
    }
  }
  return out;
}

// --- content ----------------------------------------------------------------------------------
export interface VvUnitCard { name: string; guests: number | null; text: string; url: string | null }
export interface VvSuite { name: string; guests: number | null; description: string; amenities: string[] }

export function parseVvCards(homeHtml: string): VvUnitCard[] {
  return parse(homeHtml).querySelectorAll('.project-card').map(c => {
    const href = c.querySelector('a[href*="suite.aspx"]')?.getAttribute('href') ?? null;
    return {
      name: collapse(c.querySelector('.content-title')?.text ?? ''),
      guests: Number(c.querySelector('.custom-span')?.text.match(/up to (\d+) guests/i)?.[1]) || null,
      text: collapse(c.querySelector('.content-text')?.text ?? ''),
      url: href ? new URL(href, `${SITE}/SPAges/`).toString() : null,
    };
  }).filter(c => c.name);
}

/** Unit page URLs from the menu (absolute links). */
export function vvSuiteUrls(homeHtml: string): string[] {
  const out: string[] = [];
  for (const a of parse(homeHtml).querySelectorAll('a[href*="suite.aspx"]')) {
    const u = new URL(a.getAttribute('href')!, `${SITE}/SPAges/`).toString().replace('/SPages/', '/SPAges/');
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

export function parseVvSuite(html: string): VvSuite {
  const root = parse(html);
  const block = root.querySelectorAll('.o-text').find(b => /amenities|guests|bed/i.test(b.text)) ?? root.querySelector('.o-text');
  const paras = (block?.querySelectorAll('p') ?? []).map(p => collapse(p.text)).filter(Boolean);
  const ai = paras.findIndex(p => /^amenities:?$/i.test(p));
  const description = (ai >= 0 ? paras.slice(0, ai) : paras).join(' ');
  const amenities = ai >= 0 ? paras.slice(ai + 1).join(', ').split(/,\s*/).map(x => x.trim().replace(/\.$/, '')).filter(Boolean) : [];
  const guestsEl = root.querySelectorAll('.custom-span').map(e => e.text).find(t => /guests/i.test(t)) ?? '';
  return {
    name: collapse(root.querySelectorAll('h5.c-banner-title__top')[0]?.text ?? ''),
    guests: Number(guestsEl.match(/up to (\d+)/i)?.[1]) || null,
    description,
    amenities,
  };
}

function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav, iframe')) el.remove();
  return collapse(root.querySelector('body')?.text ?? root.text);
}

export interface VvPages { home: string; about: string; suites: string[] }

export function parseVilaVentoContent(p: VvPages): OfferContent {
  const home = pageText(p.home);
  const about = pageText(p.about);
  const cards = parseVvCards(p.home);
  const suites = p.suites.map(parseVvSuite);
  const suiteFor = (card: VvUnitCard) => suites.find(s => keyPart(s.name).includes(keyPart(card.name).replace(/^bungalow-/, '').split('-')[0])) ?? null;

  const rooms: ContentRoom[] = cards.map(c => {
    const s = suiteFor(c);
    const soon = /coming soon/i.test(c.text);
    return {
      name: titleCase(s?.name || c.name),
      description: s?.description || c.text || null,
      features: [
        c.guests ? `Up to ${c.guests} guests` : null,
        soon ? 'Marked "coming soon" on the website' : null,
        ...(s?.amenities ?? []),
      ].filter((x): x is string => !!x),
    };
  });

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const [html, base] of [[p.home, VV_HOME_URL], ...p.suites.map(h => [h, `${SITE}/SPAges/`] as const), [p.about, ABOUT_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 60)) {
      if (!/vilavento\.com\/(data\/sites\/1\/GalleryImages|SPages\/home_files\/images)\//i.test(u)) continue;
      if (/logo|symbol|person-male|icon|captura-de-tela|screenshot|\.png$/i.test(u)) continue;
      const k = u.split('/').pop()!.toLowerCase().replace(/\(\d+\)(?=\.[a-z]+$)/, '');
      if (seen.has(k)) continue;
      seen.add(k); imageUrls.push(u);
    }
  }

  const kite = home.match(/(We are a pristine location to learn kitesurfing[^.]*\.)/i)?.[1] ?? '';
  const yard = about.match(/(Here you have the privilege to launch and land your kite right at our yard\.)/i)?.[1] ?? '';
  const breakfast = home.match(/(All our bookings include a daily local homemade full breakfast[^.]*\.)/i)?.[1] ?? '';
  const units = cards.map(c => `${titleCase(c.name)}${c.guests ? ` (up to ${c.guests})` : ''}${/coming soon/i.test(c.text) ? ' - coming soon' : ''}`);

  const summary = [
    'Vila Vento is a family boutique hotel built by kitesurfers on Atins beach, at the edge of the Lençóis Maranhenses National Park in Maranhão, Brazil, with its own Lençóis Kiteboarding School (lessons, rental, kite tours and guides); guests launch and land their kites in the hotel yard.',
    `It rents ${cards.length || 'a few'} beachfront wooden units: ${units.join(', ')}.`,
    'Every booking includes a homemade local breakfast; the hotel also arranges 4x4, quad, boat, horse riding and trekking tours into the park.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Vila Vento',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Maranhão',
    spot: 'Atins',
    itinerarySpots: [],
    durationDays: null,
    // home: "The flat water suits freestyle riders from all levels" + "perfect learning ground" (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /kite lessons|learn kitesurfing/i.test(home),
    equipmentRental: /rentals?/i.test(home) ? true : null,
    beginnerFriendly: /perfect learning ground|learn kitesurfing/i.test(home) ? true : null,
    includedServices: ['Homemade local breakfast', 'Wi-Fi', 'Beach towels', 'Kite launch and landing in the hotel yard'],
    optionalServices: [
      'Kite lessons, rental, kite tours and guides (Lençóis Kiteboarding School)',
      'Private 4x4 tours (Toyota Hilux with driver and guide)',
      'Quad (ATV) tours',
      'Boat tours on the Preguiças river',
      'Horse riding',
      'Trekking in the dunes',
    ],
    accommodation: 'beachfront wooden bungalows and a beach house',
    mealPlan: 'breakfast',
    languages: ['en'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null, // the site's videos are Vimeo embeds, not files
    sourceUrl: VV_HOME_URL,
    bookingUrl: BOOK_URL,
    sourceText: [
      `home: ${home}`,
      `about: ${about}`,
      `kite: ${kite} ${yard}`,
      `breakfast: ${breakfast}`,
      ...suites.map(s => `unit ${s.name} (up to ${s.guests ?? '?'}): ${s.description} | amenities: ${s.amenities.join(', ')}`),
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
async function fetchVvSlots(ctx: FetchContext): Promise<Slot[]> {
  const today = todayIso();
  const win = vvWindow(today);
  const settings = parseVvSettings(await fetchText(vvSettingsUrl(), { accept: 'application/json' }));
  if (settings.rooms.length === 0) throw new Error('vila-vento: BedBooking settings list no rooms');
  const busy = parseVvBusy(await fetchText(vvBusyUrl(win.from, addDays(win.to, 1)), { accept: 'application/json' }));
  if (busy.size === 0) ctx.note('BedBooking busy calendar returned no rooms (all free?)');
  const results: VvSampleResult[] = [];
  for (const stay of vvSampleStays(settings, busy, today)) {
    try {
      results.push({ stay, prices: parseVvOffers(await fetchText(vvOffersUrl(stay.checkIn, stay.checkOut), { accept: 'application/json' })) });
    } catch (e) {
      ctx.incomplete(`offers ${stay.checkIn}..${stay.checkOut}: ${(e as Error).message}`);
    }
  }
  return buildVvSlots(settings, busy, results, today);
}

export const vilaVentoAtins: OfferAdapter = {
  key: 'vila-vento-atins',
  name: 'Vila Vento Atins',
  kind: 'accommodation',
  operator: {
    name: 'Vila Vento',
    websiteUrl: SITE,
    rootDomain: 'vilavento.com',
    contactEmail: 'info@vilavento.com',
    phone: '+5598992371313',
    whatsapp: '+559892251212',
  },
  url: VV_HOME_URL,
  slotMethod: 'booking_engine',
  fetchBudget: 12,
  async fetchContent() {
    const home = await fetchText(VV_HOME_URL, { accept: 'text/html' });
    const about = await fetchText(ABOUT_URL, { accept: 'text/html' });
    const suites: string[] = [];
    for (const u of vvSuiteUrls(home)) suites.push(await fetchText(u, { accept: 'text/html' }));
    return parseVilaVentoContent({ home, about, suites });
  },
  fetchSlots: fetchVvSlots,
};
