// ---------------------------------------------------------------------------
// Omnibees booking engine (book.omnibees.com), shared by every property that books through it.
// Extracted from the Vila Guará adapter (2026-10-12); behaviour unchanged.
//
//   GET /availability_v4/q/<hotel>/<currencyId>/<from>/<to>/<adults>/0/0 (X-Requested-With: XMLHttpRequest)
//       -> per day: status (Open/OnRequest/...), hotel-wide lowest price, min-stay restriction;
//          at most ~3 months per call (7 months returned []).
//   GET /hotelresults?q=<hotel>&c=<chain>&lang=en-US&currencyId=<id>&version=4&CheckIn=ddMMyyyy
//       &CheckOut=ddMMyyyy&ad=<adults>&ch=0&ag=  -> per room type: rate plans with daily rates
//          (data-daily-rates), bookable count (data-max-quantity) and "There are 2 rooms left".
// robots.txt (2026-10-09): book.omnibees.com only disallows /extras, /bookdetails and some hotel ids;
//   check the property's own id before adding it.
// Slots: price bands from the daily calendar (buildRunSlots) plus room x month samples: per month
//   ONE sample stay, the cheapest open arrival day that satisfies its min-stay (buildRoomMonthSlots).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { availabilityFromText, collapse, iso, parse, parseAmount, runsOf, spotsLeftFromText, todayIso } from '../parse.js';
import type { Availability, FetchContext, Slot } from '../types.js';

export const OMNIBEES = 'https://book.omnibees.com';

export interface OmnibeesHotel {
  hotelId: number;
  /** chain id in the hotel page path (/chain/<chainPath>/hotel/<id>) */
  chainPath: number;
  /** chain id the results page expects (c=); can differ from chainPath (Vila Guará: 2706 vs 9888) */
  chainId: number;
  currencyId: number;
  currency: string;
  adults?: number;
  months?: number;
}

export interface OmnibeesDay { date: string; status: string; price: number | null; minStay: number; closedArrival: boolean }
export interface OmnibeesRoomRate {
  room: string;
  roomId: string;
  rateName: string;
  nightly: number[];      // daily rates of the searched stay
  avgNightly: number | null;
  maxQuantity: number | null;
  roomsLeftText: string | null;
  board: string | null;
}
export interface OmnibeesRoomCard { name: string; features: string[]; photo: string | null }

const adultsOf = (h: OmnibeesHotel) => h.adults ?? 2;
const monthsOf = (h: OmnibeesHotel) => h.months ?? 6;
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysIn(year: number, month: number): number { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
const ddmmyyyy = (isoDate: string) => `${isoDate.slice(8, 10)}${isoDate.slice(5, 7)}${isoDate.slice(0, 4)}`;

// --- URLs -------------------------------------------------------------------------------------
export function hotelUrl(h: OmnibeesHotel, lang = 'en-US'): string {
  return `${OMNIBEES}/chain/${h.chainPath}/hotel/${h.hotelId}?lang=${lang}`;
}
export function calendarUrl(h: OmnibeesHotel, from: string, to: string): string {
  return `${OMNIBEES}/availability_v4/q/${h.hotelId}/${h.currencyId}/${from}/${to}/${adultsOf(h)}/0/0`;
}
export function resultsUrl(h: OmnibeesHotel, checkIn: string, checkOut: string): string {
  return `${OMNIBEES}/hotelresults?q=${h.hotelId}&c=${h.chainId}&lang=en-US&currencyId=${h.currencyId}&version=4&CheckIn=${ddmmyyyy(checkIn)}&CheckOut=${ddmmyyyy(checkOut)}&ad=${adultsOf(h)}&ch=0&ag=`;
}
/** Two calendar windows of <= 3 months: today..end of month+2, first of month+3..end of month+(months-1). */
export function calendarWindows(today: string, months = 6): Array<{ from: string; to: string }> {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const at = (k: number) => ({ y: y + Math.floor((m - 1 + k) / 12), m: ((m - 1 + k) % 12) + 1 });
  const e1 = at(2); const s2 = at(3); const e2 = at(months - 1);
  return [
    { from: today, to: iso(e1.y, e1.m, daysIn(e1.y, e1.m)) },
    { from: iso(s2.y, s2.m, 1), to: iso(e2.y, e2.m, daysIn(e2.y, e2.m)) },
  ];
}

// --- pure parsers -----------------------------------------------------------------------------
/** /availability_v4 JSON -> days (RestrictionType 0 = min stay, 5 = closed to arrival, as in becalendar_init_v4.js). */
export function parseCalendar(json: string): OmnibeesDay[] {
  const arr = JSON.parse(json) as Array<{ status?: string; date?: string; price?: number; restrictions?: Array<{ RestrictionType: number; Time?: number }> | null }>;
  if (!Array.isArray(arr)) return [];
  return arr.filter(d => d.date).map(d => {
    const r = d.restrictions ?? [];
    return {
      date: d.date!.slice(0, 10),
      status: d.status ?? 'Unknown',
      price: typeof d.price === 'number' && d.price > 0 ? d.price : null,
      minStay: r.find(x => x.RestrictionType === 0)?.Time ?? 1,
      closedArrival: r.some(x => x.RestrictionType === 5),
    };
  });
}

const OPEN = (s: string) => s === 'Open' || s === 'OnRequest';
// "Close" = the hotel is not selling these days (season closed / rates not loaded), not booked up.
const CLOSED = (s: string) => /^clos/i.test(s);

/** Cheapest open arrival day of a month whose min-stay nights are all open (calendar days only). */
export function sampleStay(days: OmnibeesDay[], ym: string): { checkIn: string; checkOut: string; nights: number } | null {
  const byDate = new Map(days.map(d => [d.date, d]));
  const candidates = days.filter(d => d.date.startsWith(ym) && OPEN(d.status) && !d.closedArrival && d.price !== null)
    .filter(d => { for (let k = 1; k < d.minStay; k++) { const n = byDate.get(addDays(d.date, k)); if (!n || !OPEN(n.status)) return false; } return true; })
    .sort((a, b) => a.price! - b.price! || a.date.localeCompare(b.date));
  const c = candidates[0];
  return c ? { checkIn: c.date, checkOut: addDays(c.date, Math.max(1, c.minStay)), nights: Math.max(1, c.minStay) } : null;
}

/** hotelresults HTML -> one entry per room x rate plan; "rooms left" belongs to the preceding rate plan. */
export function parseResults(html: string): OmnibeesRoomRate[] {
  const out: OmnibeesRoomRate[] = [];
  const marks: Array<{ at: number; rate?: OmnibeesRoomRate; left?: string }> = [];
  const root = parse(html);
  for (const el of root.querySelectorAll('[data-daily-rates]')) {
    const room = el.getAttribute('data-room-name');
    if (!room) continue;
    let nightly: number[] = [];
    try {
      const rates = JSON.parse(el.getAttribute('data-daily-rates') ?? '[]') as Array<{ value?: string }>;
      nightly = rates.map(r => parseAmount(collapse(parse(r.value ?? '').text))).filter((x): x is number => x !== null);
    } catch { /* keep empty */ }
    const avg = Number(el.getAttribute('data-price'));
    const maxQ = Number(el.getAttribute('data-max-quantity'));
    out.push({
      room: collapse(room),
      roomId: el.getAttribute('data-room-id') ?? '',
      rateName: collapse(el.getAttribute('data-rate-name') ?? ''),
      nightly,
      avgNightly: Number.isFinite(avg) && avg > 0 ? Math.round(avg * 100) / 100 : null,
      maxQuantity: Number.isFinite(maxQ) ? maxQ : null,
      roomsLeftText: null,
      board: el.getAttribute('data-board') ?? null,
    });
  }
  // positions in the raw HTML: each "room_left" span follows its rate plan
  let from = 0;
  for (const r of out) {
    const at = html.indexOf(`data-roomrate-uid='${r.roomId}-`, from);
    if (at >= 0) { marks.push({ at, rate: r }); from = at + 1; }
  }
  for (const m of html.matchAll(/class="room_left">\s*([^<]*?)\s*</g)) marks.push({ at: m.index!, left: collapse(m[1]) });
  marks.sort((a, b) => a.at - b.at);
  let cur: OmnibeesRoomRate | null = null;
  for (const m of marks) {
    if (m.rate) cur = m.rate;
    else if (cur && m.left) cur.roomsLeftText = m.left;
  }
  return out;
}

/** Room x month slots from the calendar months and one results page per month (null = not searched). */
export function buildRoomMonthSlots(
  h: OmnibeesHotel,
  roomNames: string[],
  days: OmnibeesDay[],
  months: Array<{ ym: string; stay: { checkIn: string; checkOut: string } | null; results: OmnibeesRoomRate[] | null }>,
): Slot[] {
  const out: Slot[] = [];
  for (const { ym, stay, results } of months) {
    const y = Number(ym.slice(0, 4)); const m = Number(ym.slice(5, 7));
    const monthDays = days.filter(d => d.date.startsWith(ym));
    const openDays = monthDays.filter(d => OPEN(d.status)).length;
    const names = [...new Set([...roomNames, ...(results ?? []).map(r => r.room)])];
    for (const name of names) {
      const rates = (results ?? []).filter(r => r.room === name);
      let availability: Availability = 'unknown';
      let text: string | null = null;
      let spotsLeft: number | null = null;
      let price: number | null = null;
      if (rates.length) {
        const all = rates.flatMap(r => (r.nightly.length ? r.nightly : r.avgNightly !== null ? [r.avgNightly] : []));
        price = all.length ? Math.min(...all) : null;
        const left = rates.map(r => r.roomsLeftText).find(Boolean) ?? null;
        availability = (left && availabilityFromText(left)) || 'available';
        spotsLeft = left ? spotsLeftFromText(left) : null;
        text = `${left ? `${left}; ` : ''}sample stay ${stay?.checkIn}..${stay?.checkOut}; ${openDays} of ${monthDays.length} calendar days open`;
      } else if (monthDays.length && openDays === 0) {
        availability = monthDays.every(d => CLOSED(d.status)) ? 'closed' : 'sold_out';
        text = `no open day in ${ym} (${[...new Set(monthDays.map(d => d.status))].join('/')})`;
      } else if (stay && results) {
        text = `not offered for the sample stay ${stay.checkIn}..${stay.checkOut}`;
      }
      out.push({
        key: `${keyPart(name)}|${ym}`,
        startDate: iso(y, m, 1),
        endDate: iso(y, m, daysIn(y, m)),
        unit: name,
        price,
        currency: price !== null ? h.currency : null,
        priceUnit: price !== null ? 'per_night' : null,
        priceBasis: 'room',
        occupancy: adultsOf(h),
        availability,
        availabilityText: text,
        spotsLeft,
      });
    }
  }
  return out;
}

/**
 * Price bands from the daily calendar: one slot per run of days with the same status, lowest
 * price, minimum stay and arrival rule. Band limits sit where Omnibees changes the price, not at
 * month ends. The price is the hotel's lowest room for the adults searched that night.
 */
export function buildRunSlots(h: OmnibeesHotel, days: OmnibeesDay[]): Slot[] {
  const sorted = [...days].sort((x, y) => x.date.localeCompare(y.date));
  return runsOf(sorted, d => `${d.status}|${d.price}|${d.minStay}|${d.closedArrival}`).map(r => {
    const d = r.first;
    const open = OPEN(d.status);
    const notes = [
      `Omnibees ${d.status}`,
      d.minStay > 1 ? `min ${d.minStay} nights` : null,
      d.closedArrival ? 'no arrival on these days' : null,
    ].filter(Boolean).join('; ');
    return {
      key: `lowest|${r.start}`,
      startDate: r.start,
      endDate: r.end,
      unit: null,
      price: d.price,
      currency: d.price !== null ? h.currency : null,
      priceUnit: d.price !== null ? 'per_night' : null,
      priceBasis: 'room',
      occupancy: adultsOf(h),
      availability: !open ? (CLOSED(d.status) ? 'closed' : 'sold_out') : d.status === 'OnRequest' ? 'on_request' : 'available',
      availabilityText: notes,
      spotsLeft: null,
      minNights: d.minStay > 1 ? d.minStay : null,
    } satisfies Slot;
  });
}

/** Room cards on the Omnibees hotel page (name, occupancy/view, photo). */
export function parseRoomCards(hotelHtml: string): OmnibeesRoomCard[] {
  return parse(hotelHtml).querySelectorAll('.hotel-landing__room-card').map(card => ({
    name: collapse(card.querySelector('.hotel-landing__room-name')?.text ?? ''),
    features: [card.querySelector('.hotel-landing__room-occupancy'), card.querySelector('.hotel-landing__room-view')]
      .map(e => collapse(e?.text ?? '')).filter(Boolean).map(f => f.replace(/^Maximum (\d+)$/, 'Up to $1 guests')),
    photo: card.querySelector('img')?.getAttribute('src') ?? null,
  })).filter(c => c.name);
}

/** Omnibees thumbnails (/Images/<id>/Property/600x400/123.jpg) -> original (/Images/<id>/Property/123.jpg). */
export function originalImage(u: string): string {
  return u.replace(/\/(Images\/\d+\/(?:Property|RoomTypes))\/\d+x\d+\//, '/$1/');
}

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

/** Live slots for one Omnibees property: calendar bands + room x month samples. */
export async function fetchOmnibeesSlots(h: OmnibeesHotel, ctx: FetchContext, label: string): Promise<Slot[]> {
  const today = todayIso();
  const days: OmnibeesDay[] = [];
  for (const w of calendarWindows(today, monthsOf(h))) {
    const part = parseCalendar(await fetchText(calendarUrl(h, w.from, w.to), { accept: 'application/json', headers: XHR }));
    if (part.length === 0) ctx.note(`calendar ${w.from}..${w.to} returned no days`);
    days.push(...part);
  }
  if (days.length === 0) throw new Error(`${label}: Omnibees calendar returned no days for ${monthsOf(h)} months`);
  const yms = [...new Set(days.map(d => d.date.slice(0, 7)))].sort().slice(0, monthsOf(h));
  const months: Array<{ ym: string; stay: { checkIn: string; checkOut: string } | null; results: OmnibeesRoomRate[] | null }> = [];
  const roomNames = new Set<string>();
  for (const ym of yms) {
    const stay = sampleStay(days, ym);
    let results: OmnibeesRoomRate[] | null = null;
    if (stay) {
      try {
        results = parseResults(await fetchText(resultsUrl(h, stay.checkIn, stay.checkOut), { accept: 'text/html' }));
        for (const r of results) roomNames.add(r.room);
      } catch (e) {
        ctx.incomplete(`results ${ym}: ${(e as Error).message}`);
      }
    }
    months.push({ ym, stay, results });
  }
  return [...buildRunSlots(h, days), ...buildRoomMonthSlots(h, [...roomNames], days, months)];
}
