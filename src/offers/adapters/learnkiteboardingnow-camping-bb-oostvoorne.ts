// ---------------------------------------------------------------------------
// LearnKiteboardingNow / xworx Kiteboarding, Camping Deluxe B&B (Oostvoorne, South Holland, Netherlands) - the
// kite school's own "Surfers Sheds" (Sheddie Deluxe huts with two single beds) in its camp at Camping Ketjil,
// Berkenrijsweg 15, Oostvoorne. Kite link: the accommodation belongs to the VDWS kite school (run by Tim since 2004);
// the page: bookable "unabhängig davon ob Du einen Kitekurs bei uns machst oder ... nur zum Kiten vorbei kommst".
// Campsite rule: only the school's sheds are listed (no pitches; the campsite itself is not the operator).
//
// Data path (checked 2026-10-12): WordPress (Salient) + WP Booking System Premium (wpbs) + WooCommerce, German pages
// (an English copy exists at /en/camping-deluxe-bb/, not used).
//   content  /camping-bb/ (sheds, meals, price boxes "Bed & Breakfast ... Pro Person 36 €", "Frühstück 9 €",
//            "Abendessen 15,50 €"), /kontakt/ (address c/o Camping Ketjil, phones, e-mail), /uber-uns/ (school).
//   slots    /camping-bb/ server-renders the wpbs calendar "Sheddie Deluxe-Einzelbetten" for the CURRENT month only:
//            per day <div class="wpbs-date wpbs-legend-item-<id> wpbs-is-bookable" data-year data-month data-day
//            data-price="36">, legend 1 = "Verfügbar", 2 = "Gebucht"; past days carry no legend class (hidden). One
//            booking = one bed ("Eine Buchung entspricht einem Bett im Sheddie") -> EUR per person per night.
//            Other months (Nov 2026 - Oct 2027 in the month selector) load through admin-ajax with the page's
//            wpbs nonce ("token") -> not used (a token-guarded call); each daily run reads the month it is in.
// robots.txt (2026-10-12): WooCommerce defaults (wc-logs, add-to-cart, /wp-admin/ except admin-ajax) -> pages allowed.
// Requests per run: content 3, slots 1 (the camping page, memoised).
// Parsed: slots = runs of equal (price, legend) days of the current month ("shed-bed|2026-10-12"), EUR per person per
//   night incl. breakfast, available (Verfügbar) / sold_out (Gebucht).
// Known limits: only the rest of the current month is visible; at a month's end the offer shows only a few nights.
//   The map pin is missing: the site gives an address but no coordinates.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates, iso, parse, parseAmount, runsOf } from '../parse.js';
import type { Availability, ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.learnkiteboardingnow.de';
export const LKN_CAMP_URL = `${SITE}/camping-bb/`;
export const LKN_CONTACT_URL = `${SITE}/kontakt/`;
export const LKN_ABOUT_URL = `${SITE}/uber-uns/`;
export const LKN_UNIT = 'Surfers Shed bed (B&B)';

const memo = new Map<string, { at: number; p: Promise<string> }>();
function get(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text lines (scripts, styles, SVGs dropped), split at block tags. */
export function lknLines(html: string): string[] {
  const out: string[] = [];
  for (const raw of html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|a|button|figure|span)\b[^>]*>/i)) {
    const t = clean(raw.replace(/<[^>]+>/g, ' '));
    if (t && out[out.length - 1] !== t) out.push(t);
  }
  return out;
}

// --- wpbs calendar -------------------------------------------------------------------------------
export interface LknDay { date: string; price: number | null; legend: string | null; bookable: boolean }
export interface LknCalendar { title: string | null; currency: string; legends: Record<string, string>; months: string[]; days: LknDay[] }

/** The server-rendered WP Booking System calendar (current month only). */
export function parseLknCalendar(html: string): LknCalendar | null {
  const root = parse(html);
  const box = root.querySelector('.wpbs-container');
  if (!box) return null;
  const legends: Record<string, string> = {};
  for (const item of box.querySelectorAll('.wpbs-legend-item')) {
    const id = item.querySelector('.wpbs-legend-item-icon')?.getAttribute('class')?.match(/wpbs-legend-item-icon-(\d+)/)?.[1];
    const name = clean(item.querySelector('.wpbs-legend-item-name')?.text);
    if (id && name) legends[id] = name;
  }
  const days: LknDay[] = [];
  for (const d of box.querySelectorAll('.wpbs-date')) {
    const y = d.getAttribute('data-year');
    const m = d.getAttribute('data-month');
    const day = d.getAttribute('data-day');
    if (!y || !m || !day) continue; // gap cells
    const cls = d.getAttribute('class') ?? '';
    const legend = cls.match(/wpbs-legend-item-(\d+)/)?.[1] ?? null;
    const p = d.getAttribute('data-price');
    days.push({ date: iso(+y, +m, +day), price: p ? parseAmount(p) : null, legend, bookable: /wpbs-is-bookable/.test(cls) });
  }
  return {
    title: clean(box.querySelector('h2')?.text) || null,
    currency: box.getAttribute('data-currency') || 'EUR',
    legends,
    months: box.querySelectorAll('select[name="wpbs-month-selector-dropdown"] option').map(o => clean(o.text)),
    days,
  };
}

export function lknAvailability(legendName: string | null, bookable: boolean): Availability {
  const n = (legendName ?? '').toLowerCase();
  if (/gebucht|booked|belegt|ausgebucht|besetzt/.test(n)) return 'sold_out';
  if (/verfügbar|available|frei/.test(n)) return bookable ? 'available' : 'closed';
  return 'unknown';
}

export function buildLknSlots(cal: LknCalendar): Slot[] {
  // days without a legend class are past days the calendar hides
  const days = cal.days.filter(d => d.legend !== null).sort((a, b) => a.date.localeCompare(b.date));
  return runsOf(days, d => `${d.price}|${d.legend}|${d.bookable}`).map(r => {
    const legendName = cal.legends[r.first.legend!] ?? null;
    return {
      key: `shed-bed|${r.start}`,
      startDate: r.start,
      endDate: r.end,
      unit: LKN_UNIT,
      price: r.first.price,
      currency: r.first.price !== null ? cal.currency : null,
      priceUnit: r.first.price !== null ? 'per_night' : null,
      priceBasis: r.first.price !== null ? 'person' : null,
      occupancy: 1,
      availability: lknAvailability(legendName, r.first.bookable),
      availabilityText: legendName,
      spotsLeft: null,
    };
  });
}

// --- price boxes + content -----------------------------------------------------------------------
export interface LknPrices { bnb: number | null; breakfast: number | null; dinner: number | null }

/**
 * Price boxes: "Bed & Breakfast | Übernachtung im Surfers Shed inkl. Frühstück | Pro Person | 36 €", "Frühstück |
 * Reichhaltiges Frühstückbuffet ... | 9 €", "Abendessen | All-You-Can-Eat Buffet ... | 15,50 €". Anchored on the box
 * text, not the headings ("Frühstück & / Abendessen" also appears as an icon caption higher up).
 */
export function parseLknPrices(html: string): LknPrices {
  const lines = lknLines(html);
  const after = (anchor: RegExp): number | null => {
    const i = lines.findIndex(l => anchor.test(l));
    if (i < 0) return null;
    for (const l of lines.slice(i + 1, i + 6)) if (/€/.test(l)) return parseAmount(l);
    return null;
  };
  return { bnb: after(/^Übernachtung im Surfers Shed/i), breakfast: after(/^Reichhaltiges Frühstückbuffet/i), dinner: after(/^All-You-Can-Eat Buffet/i) };
}

export interface LknPages { camp: string; contact: string; about: string }

export function parseLknContent(p: LknPages): OfferContent {
  const camp = lknLines(p.camp);
  const contact = lknLines(p.contact);
  const about = lknLines(p.about);
  const campText = camp.join('\n');
  const contactText = contact.join('\n');
  const aboutText = about.join('\n');
  const prices = parseLknPrices(p.camp);
  const cal = parseLknCalendar(p.camp);
  const since = aboutText.match(/VDWS Kiteschule in ([A-Za-zäöü-]+) bereits seit (\d{4})/);
  const eur = (n: number) => `EUR ${n.toFixed(2).replace(/\.00$/, '')}`;

  const rooms: ContentRoom[] = [{
    name: LKN_UNIT,
    description: 'Bed in a Sheddie Deluxe hut with two single beds in the kite school\'s camp; one booking is one bed (the school allocates the huts, on request where possible).',
    features: [
      'Real beds, bedside table with reading lamp and power socket, room for luggage',
      'Bring a sheet (80x200 cm), bedding or sleeping bag and covers, or order them with the booking',
      ...(prices.bnb ? [`${eur(prices.bnb)} per person and night including breakfast`] : []),
      ...(prices.dinner ? [`Dinner buffet ${eur(prices.dinner)} per person (optional)`] : []),
    ],
  }];

  const imageUrls: string[] = [];
  const add = (u: string) => {
    if (/\.svg|logo|flags\/|salad|favicon|cropped-/i.test(u)) return;
    if (!imageUrls.includes(u)) imageUrls.push(u);
  };
  imageCandidates(p.camp, LKN_CAMP_URL, null, 40).forEach(add);
  for (const m of p.camp.matchAll(/data-bg="(https:\/\/www\.learnkiteboardingnow\.de\/wp-content\/uploads\/[^"]+\.(?:jpe?g|png|webp))"/gi)) add(m[1]);

  const email = contactText.match(/([\w.+-]+)\(at\)([\w.-]+\.[a-z]{2,})/i);
  const summary = [
    `The Camping Deluxe B&B is the accommodation of the LearnKiteboardingNow / xworx kite school ${/c\/o Camping Ketjil/i.test(contactText) ? 'at Camping Ketjil ' : ''}in Oostvoorne, South Holland: guests sleep in the school's Surfers Sheds, huts with two single beds, a bedside table with reading lamp and a power socket.`,
    `A bed costs ${prices.bnb ? eur(prices.bnb) : 'a fixed rate'} per person and night including breakfast and can be booked online at short notice, with or without a kite course${prices.dinner ? `; the dinner buffet is ${eur(prices.dinner)} extra` : ''}.`,
    `Guests share the station building's common room with fireplace, a BBQ lounge and Wi-Fi across the site${since ? `; the VDWS kite school has been running in ${since[1]} since ${since[2]}` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'LearnKiteboardingNow Camping Deluxe B&B',
    summary,
    continent: 'Europe',
    country: 'Netherlands',
    region: 'Oostvoorne, South Holland',
    spot: 'Oostvoorne',
    itinerarySpots: [],
    durationDays: null,
    // menu: "Kitesurf Kurse", "Betreutes Kitesurfen", "VDWS Lizenz"; title "Kitesurfen lernen im top Stehrevier"
    skillLevels: ['beginner', 'intermediate'],
    kiteLessons: true,
    equipmentRental: /Mietpreise Materialpool/i.test(campText) ? true : null,
    beginnerFriendly: true,
    includedServices: [
      'Breakfast buffet (coffee, tea, juices, lunch pack)',
      'Common room with fireplace in the station building',
      'BBQ lounge',
      'Wi-Fi across the site',
    ],
    optionalServices: [
      ...(prices.dinner ? [`All-you-can-eat dinner buffet (${eur(prices.dinner)} per person, also vegetarian and vegan)`] : []),
      'Bed linen or full bedding to order',
      'Kitesurf courses and 3-, 4- and 5-day kite camps (also youth and kite & yoga camps)',
      'Supervised kitesurfing and the VDWS licence',
      'Kite equipment rental (material pool)',
    ],
    accommodation: 'kite school surf huts (shared, two single beds)',
    mealPlan: 'breakfast',
    languages: ['de', 'nl', 'en'],
    rooms,
    imageUrls: imageUrls.slice(0, 20),
    heroVideoUrl: null,
    sourceUrl: LKN_CAMP_URL,
    bookingUrl: LKN_CAMP_URL,
    sourceText: [
      `camping b&b: ${camp.slice(Math.max(0, camp.findIndex(l => /^Willkommen im/i.test(l))), camp.findIndex(l => /^Startdatum/i.test(l)) + 1 || undefined).join(' | ')}`,
      `prices: bnb ${prices.bnb} / breakfast ${prices.breakfast} / dinner ${prices.dinner}`,
      `calendar: ${cal?.title ?? '-'} ${cal ? `${cal.months[0]} - ${cal.months[cal.months.length - 1]}` : ''}`,
      `contact: ${contact.slice(Math.max(0, contact.findIndex(l => /^Unsere Kiteschule/i.test(l))), contact.findIndex(l => /^Unsere Kiteschule/i.test(l)) + 6).join(' | ')}`,
      `about: ${since?.[0] ?? ''}`,
      `email: ${email ? `${email[1]}@${email[2]}` : '-'}`,
    ].join('\n'),
  };
}

// --- adapter ---------------------------------------------------------------------------------------
export const learnkiteboardingnowCampingBbOostvoorne: OfferAdapter = {
  key: 'learnkiteboardingnow-camping-bb-oostvoorne',
  name: 'LearnKiteboardingNow Camping Deluxe B&B Oostvoorne',
  kind: 'accommodation',
  operator: {
    name: 'LearnKiteboardingNow / xworx Kiteboarding',
    websiteUrl: SITE,
    rootDomain: 'learnkiteboardingnow.de',
    contactEmail: 'info@learnkiteboardingnow.de',
    phone: '+31 6 17448961',
  },
  url: LKN_CAMP_URL,
  slotMethod: 'booking_engine',
  fetchBudget: 4,
  async fetchContent() {
    const camp = await get(LKN_CAMP_URL);
    const contact = await get(LKN_CONTACT_URL);
    const about = await get(LKN_ABOUT_URL);
    return parseLknContent({ camp, contact, about });
  },
  async fetchSlots(ctx: FetchContext) {
    const html = await get(LKN_CAMP_URL);
    const cal = parseLknCalendar(html);
    if (!cal) throw new Error('learnkiteboardingnow: wpbs calendar missing on /camping-bb/ (layout changed?)');
    const slots = buildLknSlots(cal);
    if (slots.length === 0) ctx.note('calendar shows no day with a status (end of month?)');
    const printed = parseLknPrices(html).bnb;
    const cal0 = slots.find(s => s.price !== null)?.price ?? null;
    if (printed && cal0 && printed !== cal0) ctx.note(`calendar price ${cal0} differs from the printed B&B price ${printed}`);
    return slots;
  },
};
