// ---------------------------------------------------------------------------
// Boardrooms, Blouberg (Cape Town, South Africa) - self-catering kite and co-living villa at 16 Spray Road, Blouberg,
// "minutes from Blouberg's world-famous kite beach": five en-suite rooms (villa sleeps 10), gear storage, outdoor
// showers, co-working space, mini gym and hot tub. The same owner rents OysterRock in Langebaan (own adapter).
//
// Liveness (checked 2026-10-12): WordPress modified dates (wp-json) - home 2026-08-18T07:38:17, rooms page
//   2026-08-18T07:19:42, villa page 2026-08-18T07:37:34; uploads 2025/10-2025/11.
// Kite link: home "The Ultimate Kitesurfing Base ... perfectly positioned for wind chasers kitesurfers, windsurfers,
//   wingers and surfers. Store your gear safely, rinse off in outdoor showers"; page title "Boardrooms Kite
//   Accommodation".
//
// Data path (checked 2026-10-12): boardrooms.capetown, WordPress (Thrive).
//   content  / (kite base, co-working, location), /rooms/ (room cards, prices, shared facilities).
//   slots    /rooms/: per room a heading "Deluxe Double - Room Six" followed by "R 1600 / room per night - minimum stay
//            4 nights ..." - ZAR per room per night, no dates; direct booking by e-mail / WhatsApp ("book direct for a
//            better rate"), so 'on_request'.
// Booking engines: the rooms page embeds an InnStyle availability calendar (account "escapingblouberglangebaan");
//   InnStyle's robots.txt disallows /availability/, /book/, /nights/ and /enquiries/ for all bots -> not used.
//   Airbnb / Booking.com links on the page are platforms -> not used.
// robots.txt (2026-10-12): WordPress default, pages allowed.
// Requests per run: content 2, slots 1.
// Parsed: 5 slots (Rooms Two to Six), ZAR per room per night, occupancy 2, minNights 4.
// Known limits: no season dates; long-stay discounts ("looking for 30 days or more") are not structured; no whole-
//   villa price on the site.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates, parseAmount } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://boardrooms.capetown';
export const BR_HOME_URL = `${SITE}/`;
export const BR_ROOMS_URL = `${SITE}/rooms/`;

/** Visible text split at block tags (script/style bodies dropped). */
export function brLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|article|header|footer|nav)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

const NUM: Record<number, string> = { 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven' };

// --- pure parsers -----------------------------------------------------------------------------
export interface BrRoom { type: string; room: string; subtitle: string | null; amount: number; minNights: number | null; priceText: string }

/** "Deluxe Double - Room Six" / "Room Six - Self catering ..." / "R 1600 / room per night - minimum stay 4 nights". */
export function parseBrRooms(html: string): BrRoom[] {
  const lines = brLines(html);
  const out: BrRoom[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^((?:Deluxe|Standard) (?:Double|Twin)) - (Room \w+)$/);
    if (!h || out.some(r => r.room === h[2])) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
      const p = lines[j].match(/^R\s?(\d[\d\s,]*)\s*\/\s*room per night/i);
      if (!p) continue;
      const sub = lines[i + 1] && /^Room \w+ - /.test(lines[i + 1]) ? lines[i + 1] : null;
      out.push({
        type: h[1],
        room: h[2],
        subtitle: sub,
        amount: parseAmount(p[1].replace(/\s/g, ''))!,
        minNights: Number(lines[j].match(/minimum stay (\d+) nights?/i)?.[1]) || null,
        priceText: lines[j],
      });
      break;
    }
  }
  return out.filter(r => r.amount);
}

export function buildBrSlots(rooms: BrRoom[]): Slot[] {
  return rooms.map(r => ({
    key: r.room.toLowerCase().replace(/\s+/g, '-'),
    startDate: null,
    endDate: null,
    unit: `${r.type} - ${r.room}`,
    price: r.amount,
    currency: 'ZAR',
    priceUnit: 'per_night',
    priceBasis: 'room',
    occupancy: 2,
    availability: 'on_request',
    availabilityText: 'book direct by e-mail or WhatsApp',
    spotsLeft: null,
    minNights: r.minNights,
  }));
}

export interface BrPages { home: string; rooms: string }

export function parseBrContent(p: BrPages): OfferContent {
  const home = brLines(p.home).join(' ');
  const roomsText = brLines(p.rooms).join(' ');
  const rooms = parseBrRooms(p.rooms);
  const prices = rooms.map(r => r.amount).sort((a, b) => a - b);
  const minN = rooms.find(r => r.minNights)?.minNights ?? null;
  const fmt = (n: number) => `R${n.toLocaleString('en-US')}`;

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: `${r.type} - ${r.room}`,
    description: r.subtitle,
    features: [
      'Private en-suite bathroom with walk-in shower',
      'Private fridge',
      /terrace view/i.test(r.subtitle ?? '') ? 'Terrace view' : null,
      /twin/i.test(r.type) ? '2 single beds set apart' : '2 single beds (set apart or joined as a king)',
      `${fmt(r.amount)} per room per night${r.minNights ? `, minimum ${r.minNights} nights` : ''}`,
    ].filter((x): x is string => !!x),
  }));

  const imgs: string[] = [];
  for (const [html, base] of [[p.rooms, BR_ROOMS_URL], [p.home, BR_HOME_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 80)) {
      if (!/boardrooms\.capetown\/wp-content\/uploads\//.test(u) || /logo|icon|trustindex|cropped-|\.png$|\.svg$/i.test(u)) continue;
      const k = u.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
      if (!imgs.includes(k)) imgs.push(k);
    }
  }

  const summary = [
    'Boardrooms is a self-catering villa at 16 Spray Road in Blouberg, Cape Town, a few minutes from the Blouberg kite beach, set up for kitesurfers, wingers, windsurfers and remote workers.',
    `${NUM[rooms.length] ?? rooms.length} private en-suite double and twin rooms (the villa sleeps 10) share a large kitchen, lounge, garden with braai, an outdoor mini gym and hot tub and a co-working space with fibre internet; gear is stored on site and rinsed in outdoor showers.`,
    prices.length ? `Rooms cost ${fmt(prices[0])}${prices[prices.length - 1] !== prices[0] ? ` to ${fmt(prices[prices.length - 1])}` : ''} per night${minN ? ` with a minimum stay of ${minN} nights` : ''}, with long-stay rates on request; bookings go directly by e-mail or WhatsApp.` : 'Rates on request; bookings go directly by e-mail or WhatsApp.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Boardrooms Kite & Co-working Villa',
    summary,
    continent: 'Africa',
    country: 'South Africa',
    region: 'Western Cape',
    spot: 'Blouberg, Cape Town',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: null,
    equipmentRental: null,
    beginnerFriendly: null,
    includedServices: [
      /Store your gear safely/i.test(home) ? 'Gear storage' : null,
      /outdoor showers/i.test(home) ? 'Outdoor showers' : null,
      /coworking|co-working/i.test(home) ? 'Co-working space with fibre internet' : null,
      /mini gym/i.test(home) ? 'Outdoor mini gym' : null,
      /hot tub/i.test(home) ? 'Hot tub' : null,
      /yoga mats/i.test(home) ? 'Yoga mats' : null,
      /braai/i.test(roomsText) ? 'Shared kitchen, lounge and braai area' : null,
    ].filter((x): x is string => !!x),
    optionalServices: [],
    accommodation: 'self-catering villa rooms (en-suite)',
    mealPlan: 'self_catering',
    languages: ['en'],
    rooms: contentRooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: BR_ROOMS_URL,
    bookingUrl: 'mailto:book@boardrooms.capetown',
    sourceText: [
      `home: ${brLines(p.home).filter(l => l.length > 40 && !/ti-|trustindex/.test(l)).join(' | ')}`,
      `rooms: ${rooms.map(r => `${r.type} - ${r.room}: ${r.subtitle ?? ''}; ${r.priceText}`).join(' | ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const boardroomsBlouberg: OfferAdapter = {
  key: 'boardrooms-blouberg',
  name: 'Boardrooms Kite & Co-working Villa',
  kind: 'accommodation',
  operator: {
    name: 'Boardrooms',
    websiteUrl: SITE,
    rootDomain: 'boardrooms.capetown',
    contactEmail: 'book@boardrooms.capetown',
    whatsapp: '+27834482177',
    phone: '+27834482177',
  },
  url: BR_ROOMS_URL,
  slotMethod: 'price_table',
  fetchBudget: 3,
  confidence: 'medium', // undated room rates on a page edited 2026-08-18; direct booking by mail / WhatsApp
  async fetchContent() {
    const home = await fetchText(BR_HOME_URL, { accept: 'text/html' });
    const rooms = await fetchText(BR_ROOMS_URL, { accept: 'text/html' });
    return parseBrContent({ home, rooms });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    const rooms = parseBrRooms(await fetchText(BR_ROOMS_URL, { accept: 'text/html' }));
    if (rooms.length === 0) throw new Error('boardrooms-blouberg: no "R N / room per night" room cards on /rooms/ (layout changed?)');
    if (rooms.length < 5) ctx.note(`only ${rooms.length} priced rooms (5 expected)`);
    return buildBrSlots(rooms);
  },
};
