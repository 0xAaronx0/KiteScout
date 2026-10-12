// ---------------------------------------------------------------------------
// Pousada Vila Guará, Atins (Lençóis Maranhenses, Maranhão, Brazil) - beachfront chalets with own kite school.
//
// Data path (checked 2026-10-09):
//   content  www.vilaguara.com/en (Duda site: texts, gallery, hero video) + the Omnibees hotel page
//            book.omnibees.com/chain/2706/hotel/18675?lang=en-US (description, room cards, amenities,
//            original-size photos media.omnibees.com/Images/18675/<Property|RoomTypes>/<id>.jpg).
//   slots    Omnibees booking engine (hotel 18675, chain 9888, currency id 16 = BRL):
//            GET /availability_v4/q/18675/16/<from>/<to>/2/0/0 (X-Requested-With: XMLHttpRequest)
//                -> per day: status (Open/OnRequest/...), hotel-wide lowest price, min-stay restriction;
//                   the engine answers at most ~3 months per call (7 months returned []).
//            GET /hotelresults?q=18675&c=9888&lang=en-US&currencyId=16&version=4&CheckIn=ddMMyyyy
//                &CheckOut=ddMMyyyy&ad=2&ch=0&ag=  -> per room type: rate plans with daily rates
//                   (data-daily-rates), bookable count (data-max-quantity) and "There are 2 rooms left".
//            Per month we search ONE sample stay: the cheapest open arrival day of the month that
//            satisfies its min-stay, for that many nights, 2 adults.
// robots.txt (2026-10-09): book.omnibees.com only disallows /extras, /bookdetails and other hotels'
//   ids (not 18675 / chain 9888 / 2706); www.vilaguara.com allows everything.
// Requests per run: content 2, slots 2 calendar + up to 6 results = 8.
// Parsed: slot = room type x month ("kite-house|2026-11"), BRL per room per night for 2 adults incl.
//   breakfast, price = lowest daily rate of the sample stay, availability from the room's inventory
//   ("rooms left" -> limited) or the month's calendar (no open day -> sold_out).
// Known limits: one sample stay per month (the hotel-wide calendar is exact per day, per-room prices
//   are sampled); a room missing from the sample stay is "unknown" for that month.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { availabilityFromText, collapse, imageCandidates, iso, parse, parseAmount, runsOf, spotsLeftFromText, todayIso } from '../parse.js';
import type { Availability, ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const OB = 'https://book.omnibees.com';
const HOTEL = 18675;
const CHAIN = 9888;
const CURRENCY_ID = 16; // BRL ("R$", data-curr="16" on the hotel page)
const ADULTS = 2;
const MONTHS = 6;
export const VG_HOTEL_URL = `${OB}/chain/2706/hotel/${HOTEL}?lang=en-US`;
export const VG_SITE_URL = 'https://www.vilaguara.com/en';

export interface VgDay { date: string; status: string; price: number | null; minStay: number; closedArrival: boolean }
export interface VgRoomRate {
  room: string;
  roomId: string;
  rateName: string;
  nightly: number[];      // daily rates of the searched stay
  avgNightly: number | null;
  maxQuantity: number | null;
  roomsLeftText: string | null;
  board: string | null;
}

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysIn(year: number, month: number): number { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
const ddmmyyyy = (isoDate: string) => `${isoDate.slice(8, 10)}${isoDate.slice(5, 7)}${isoDate.slice(0, 4)}`;

// --- URLs -------------------------------------------------------------------------------------
export function vgCalendarUrl(from: string, to: string): string {
  return `${OB}/availability_v4/q/${HOTEL}/${CURRENCY_ID}/${from}/${to}/${ADULTS}/0/0`;
}
export function vgResultsUrl(checkIn: string, checkOut: string): string {
  return `${OB}/hotelresults?q=${HOTEL}&c=${CHAIN}&lang=en-US&currencyId=${CURRENCY_ID}&version=4&CheckIn=${ddmmyyyy(checkIn)}&CheckOut=${ddmmyyyy(checkOut)}&ad=${ADULTS}&ch=0&ag=`;
}
/** Two calendar windows of <= 3 months: today..end of month+2, first of month+3..end of month+5. */
export function vgCalendarWindows(today: string): Array<{ from: string; to: string }> {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const at = (k: number) => ({ y: y + Math.floor((m - 1 + k) / 12), m: ((m - 1 + k) % 12) + 1 });
  const e1 = at(2); const s2 = at(3); const e2 = at(MONTHS - 1);
  return [
    { from: today, to: iso(e1.y, e1.m, daysIn(e1.y, e1.m)) },
    { from: iso(s2.y, s2.m, 1), to: iso(e2.y, e2.m, daysIn(e2.y, e2.m)) },
  ];
}

// --- pure parsers -----------------------------------------------------------------------------
/** /availability_v4 JSON -> days (RestrictionType 0 = min stay, 5 = closed to arrival, as in becalendar_init_v4.js). */
export function parseVgCalendar(json: string): VgDay[] {
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

/** Cheapest open arrival day of a month whose min-stay nights are all open (calendar days only). */
export function vgSampleStay(days: VgDay[], ym: string): { checkIn: string; checkOut: string; nights: number } | null {
  const byDate = new Map(days.map(d => [d.date, d]));
  const candidates = days.filter(d => d.date.startsWith(ym) && OPEN(d.status) && !d.closedArrival && d.price !== null)
    .filter(d => { for (let k = 1; k < d.minStay; k++) { const n = byDate.get(addDays(d.date, k)); if (!n || !OPEN(n.status)) return false; } return true; })
    .sort((a, b) => a.price! - b.price! || a.date.localeCompare(b.date));
  const c = candidates[0];
  return c ? { checkIn: c.date, checkOut: addDays(c.date, Math.max(1, c.minStay)), nights: Math.max(1, c.minStay) } : null;
}

/** hotelresults HTML -> one entry per room x rate plan; "rooms left" belongs to the preceding rate plan. */
export function parseVgResults(html: string): VgRoomRate[] {
  const out: VgRoomRate[] = [];
  const marks: Array<{ at: number; rate?: VgRoomRate; left?: string }> = [];
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
  let cur: VgRoomRate | null = null;
  for (const m of marks) {
    if (m.rate) cur = m.rate;
    else if (cur && m.left) cur.roomsLeftText = m.left;
  }
  return out;
}

/** Room x month slots from the calendar months and one results page per month (null = not searched). */
export function buildVgSlots(
  roomNames: string[],
  days: VgDay[],
  months: Array<{ ym: string; stay: { checkIn: string; checkOut: string } | null; results: VgRoomRate[] | null }>,
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
        availability = 'sold_out';
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
        currency: price !== null ? 'BRL' : null,
        priceUnit: price !== null ? 'per_night' : null,
        priceBasis: 'room',
        occupancy: ADULTS,
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
 * price, minimum stay and arrival rule. Band limits sit where Omnibees changes the price (it
 * prices almost day by day), not at month ends. The price is the hotel's lowest room for
 * 2 adults that night; per-room prices come from the monthly samples (buildVgSlots).
 */
export function buildVgRunSlots(days: VgDay[]): Slot[] {
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
      currency: d.price !== null ? 'BRL' : null,
      priceUnit: d.price !== null ? 'per_night' : null,
      priceBasis: 'room',
      occupancy: ADULTS,
      availability: !open ? 'sold_out' : d.status === 'OnRequest' ? 'on_request' : 'available',
      availabilityText: notes,
      spotsLeft: null,
      minNights: d.minStay > 1 ? d.minStay : null,
    } satisfies Slot;
  });
}

export interface VgRoomCard { name: string; features: string[]; photo: string | null }
export function parseVgRoomCards(hotelHtml: string): VgRoomCard[] {
  return parse(hotelHtml).querySelectorAll('.hotel-landing__room-card').map(card => ({
    name: collapse(card.querySelector('.hotel-landing__room-name')?.text ?? ''),
    features: [card.querySelector('.hotel-landing__room-occupancy'), card.querySelector('.hotel-landing__room-view')]
      .map(e => collapse(e?.text ?? '')).filter(Boolean).map(f => f.replace(/^Maximum (\d+)$/, 'Up to $1 guests')),
    photo: card.querySelector('img')?.getAttribute('src') ?? null,
  })).filter(c => c.name);
}

/** Omnibees thumbnails (/Images/18675/Property/600x400/123.jpg) -> original (/Images/18675/Property/123.jpg). */
function omnibeesOriginal(u: string): string {
  return u.replace(/\/(Images\/\d+\/(?:Property|RoomTypes))\/\d+x\d+\//, '/$1/');
}

export function parseVilaGuaraContent(siteHtml: string, hotelHtml: string): OfferContent {
  const site = parse(siteHtml);
  for (const el of site.querySelectorAll('script, style, noscript, header, nav')) el.remove();
  const siteText = collapse(site.text);
  const hotel = parse(hotelHtml);
  const description = collapse(hotel.querySelector('.hotel-landing__description')?.text ?? '');
  const amenities = hotel.querySelectorAll('.amenity-group').map(g => ({
    group: collapse(g.querySelector('.amenity-category-text')?.text ?? ''),
    items: g.querySelectorAll('.amenity-item').map(i => collapse(i.text)).filter(Boolean),
  }));
  const hours = collapse(hotel.querySelector('.hotel-landing__hours')?.text ?? '');
  const fromPrice = collapse(hotel.querySelector('.hotel-landing__price-value')?.text ?? '');
  const cards = parseVgRoomCards(hotelHtml);

  const kite = siteText.match(/KITESURFING\s+(Located[\s\S]*?unforgettable for kiters\.)/)?.[1] ?? '';
  const season = kite.match(/between\s+([A-Z][a-z]+)\s+and\s+([A-Z][a-z]+)/);
  const knots = kite.match(/(\d+)\s+to\s+(\d+)\s+knots/);
  const restaurant = siteText.match(/RESTAURANT\s+(With regional[\s\S]*?your day\.)/)?.[1] ?? '';
  const others = siteText.match(/OTHERS ACTIVITIES\s+([\s\S]*?scenery of Atins\.)/)?.[1] ?? '';
  const chalets = siteText.match(/(The wooden chalets[\s\S]*?getaway in Maranhão\.)/)?.[1] ?? '';

  const summary = [
    'Pousada Vila Guará is a small beachfront guesthouse in Atins, at the edge of the Lençóis Maranhenses National Park in Maranhão, Brazil, with a bar and restaurant, a spa and its own fully equipped kitesurf school.',
    `Guests stay in naturally ventilated wooden chalets (fans and mosquito nets, no air conditioning) with private balcony and bathroom; ${cards.length ? `${cards.length} room types (${cards.map(c => c.name).join(', ')}) are bookable and ` : ''}breakfast is included.`,
    season || knots ? `The kite season runs ${season ? `from ${season[1]} to ${season[2]}` : ''}${knots ? ` with ${knots[1]} to ${knots[2]} knots` : ''} on the Preguiças river delta's lagoons and sandbanks.` : null,
  ].filter(Boolean).join(' ');

  const rooms: ContentRoom[] = cards.map(c => ({
    name: c.name,
    description: null,
    features: [...c.features, 'Private balcony', 'Private bathroom with hot shower', 'Fan and mosquito nets', 'Minibar', 'Wi-Fi', 'Breakfast included'],
  }));

  // images: own site gallery (minus logos/flags), then Omnibees originals (property + room types)
  const own: string[] = [];
  const seen = new Set<string>();
  for (const cand of imageCandidates(siteHtml, VG_SITE_URL, null, 80)) {
    const u = cand.match(/https:\/\/irp\.cdn-website\.com\/[^"'\\\s%]+/)?.[0];
    if (!u || /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/.test(u) || /\.svg|flags|whatsapp/i.test(u)) continue;
    const k = u.split('/').pop()!.replace(/-\d+w(?=\.[a-z]+$)/i, '');
    if (seen.has(k)) continue;
    seen.add(k); own.push(u);
  }
  const ob: string[] = [];
  for (const m of hotelHtml.matchAll(/https:\/\/media\.omnibees\.com\/Images\/\d+\/(?:Property|RoomTypes)\/\d+x\d+\/\d+\.jpg/g)) {
    const u = omnibeesOriginal(m[0]);
    if (!ob.includes(u)) ob.push(u);
  }
  const video = siteHtml.match(/https:\/\/vid\.cdn-website\.com\/[^"'\s]+\.mp4/)?.[0] ?? null;

  const sourceLines = [
    `omnibees description: ${description}`,
    `from price: ${fromPrice}`,
    `rooms: ${cards.map(c => `${c.name} (${c.features.join(', ')})`).join('; ')}`,
    ...amenities.map(a => `${a.group}: ${a.items.join(', ')}`),
    `hours: ${hours}`,
    `chalets: ${chalets}`,
    `restaurant: ${restaurant}`,
    `kitesurfing: ${kite}`,
    `other activities: ${others}`,
  ];
  const included = ['Breakfast', 'Wi-Fi', 'Parking', 'Kite equipment storage (Kite Wardrobe)'];
  return {
    kind: 'accommodation',
    title: 'Pousada Vila Guará',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Maranhão',
    spot: 'Atins',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    // "a fully equipped kitesurfing school - perfect for those who want to learn or already practice" (Omnibees, 2026-10-09)
    kiteLessons: /kitesurf(?:ing)? school/i.test(description) || /school/i.test(kite),
    equipmentRental: null,
    beginnerFriendly: /want to learn/i.test(description) ? true : null,
    includedServices: included,
    optionalServices: ['Kitesurf lessons (own school)', 'Massage / spa', 'Restaurant lunch and dinner', 'Stand-up paddle', 'Tours to the Lençóis Maranhenses dunes and lagoons'],
    accommodation: 'beachfront wooden chalets',
    mealPlan: 'breakfast',
    languages: ['en', 'pt', 'fr'], // vilaguara.com language switch EN / PT / FR (2026-10-09)
    rooms,
    imageUrls: [...own, ...ob].slice(0, 30),
    heroVideoUrl: video,
    sourceUrl: VG_HOTEL_URL,
    bookingUrl: VG_HOTEL_URL,
    sourceText: sourceLines.join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

export const vilaGuaraAtins: OfferAdapter = {
  key: 'vila-guara-atins',
  name: 'Pousada Vila Guará Atins',
  kind: 'accommodation',
  operator: {
    name: 'Pousada Vila Guará',
    websiteUrl: 'https://www.vilaguara.com',
    rootDomain: 'vilaguara.com',
    contactEmail: 'admin@vilaguara.com',
    phone: '+5598992325200',
  },
  url: VG_HOTEL_URL,
  quote: { engine: 'omnibees', hotelId: HOTEL, chainId: CHAIN, currencyId: CURRENCY_ID, currency: 'BRL' },
  slotMethod: 'booking_engine',
  fetchBudget: 10,
  async fetchContent() {
    // Duda answers a JSON payload instead of HTML when Accept lists application/json (http.ts default)
    const site = await fetchText(VG_SITE_URL, { accept: 'text/html' });
    const hotel = await fetchText(VG_HOTEL_URL, { accept: 'text/html' });
    return parseVilaGuaraContent(site, hotel);
  },
  async fetchSlots(ctx) {
    const today = todayIso();
    const days: VgDay[] = [];
    for (const w of vgCalendarWindows(today)) {
      const part = parseVgCalendar(await fetchText(vgCalendarUrl(w.from, w.to), { accept: 'application/json', headers: XHR }));
      if (part.length === 0) ctx.note(`calendar ${w.from}..${w.to} returned no days`);
      days.push(...part);
    }
    if (days.length === 0) throw new Error('vila-guara: Omnibees calendar returned no days for 6 months');
    const yms = [...new Set(days.map(d => d.date.slice(0, 7)))].sort().slice(0, MONTHS);
    const months: Array<{ ym: string; stay: { checkIn: string; checkOut: string } | null; results: VgRoomRate[] | null }> = [];
    const roomNames = new Set<string>();
    for (const ym of yms) {
      const stay = vgSampleStay(days, ym);
      let results: VgRoomRate[] | null = null;
      if (stay) {
        try {
          results = parseVgResults(await fetchText(vgResultsUrl(stay.checkIn, stay.checkOut), { accept: 'text/html' }));
          for (const r of results) roomNames.add(r.room);
        } catch (e) {
          ctx.incomplete(`results ${ym}: ${(e as Error).message}`);
        }
      }
      months.push({ ym, stay, results });
    }
    return [...buildVgRunSlots(days), ...buildVgSlots([...roomNames], days, months)];
  },
};
