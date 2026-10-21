// ---------------------------------------------------------------------------
// Uncharted Kite Sessions - "Fred Hope Foil Master 2027" (Kite Beach, Cabarete, Dominican Republic): the 7th edition
// of the school's yearly foil week with world champion Fred Hope (kite foil or wing foil), 4-10 April 2027, max 6
// guests: 6 nights at Uncharted Villas (oceanfront condos on Kite Beach, own bedroom + bath), 5 days of one-on-one
// coaching with bbTalkin headsets and daily video review, private chef with all food and drinks, an advanced
// kite-flying course, local transport, Slingshot demo gear. KIND = 'camp'.
// This file also holds the Uncharted page helpers; the "Choose Your Strapless Week" listing
// (uncharted-kite-sessions-strapless-week-cabarete.ts) imports them.
//
// Data path (checked 2026-10-21): Joomla + K2, one item page per camp (/destinations/<slug>):
//   facts    <dl> with dd.dates "April 4th to 10th, 2027", dd.number-of-guests "Only 6", dd.price "$4800 USD",
//            dd.pro "Fred Hope"; div.introtext (story), div.package-includes (first <p>: "•"-separated bullets),
//            div.not-included, h1.uk-article-title.
//   images   the item's K2 image (XL) + the "image one/two/three" banners (photos with the camp title printed on
//            them) + /uncharted-villas (featured banner + the five villa cards, K2 _M upscaled to _XL): the camp's
//            accommodation. The page's YouTube iframe is not used.
// Slots: one dated slot per printed range (2027-04-04..2027-04-10), USD 4,800, package of 6 nights.
//   priceBasis 'person' INFERRED: "Price: $4800 USD" without "p/p", but every guest has an own bedroom and gets
//   one-on-one coaching (the sister page prints "p/p"). Currency "USD" printed. Availability 'on_request' ("Book
//   Now" = /contact-us form; "Only 6" guests is the capacity, not a shortage signal). Past dates are dropped; once
//   the April 2027 edition is past, slots = [] and the summary says the next edition is not published yet. The URL
//   carries the year: a new edition gets a new URL (the nav link "Fred Hope Foil Master <year>" is checked and a
//   newer one is reported as a note).
// robots.txt (2026-10-21): Joomla default (/administrator/, /cli/, /includes/, ... disallowed; /images/ and /media/
//   allowed, their Disallow lines are commented out).
// Requests per run: content 2 (camp page + /uncharted-villas), slots 1 (memoised: 2 for a full run).
// Kite link: "Whether wing foil or kite foil", "Advanced kite-flying course", Slingshot kite demo gear; the camp
//   photos show wing foiling as well. Guests bring their own gear ("Do You Need Your Own Gear? Yes").
// Flags: liveAvailability no (static page), instantBooking false (contact form).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse, parseAmount, todayIso, type HTMLElement } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';
import { weekRange } from './kite-sisters-brazil.js';

export const UKS_SITE = 'https://www.unchartedkitesessions.com';
export const UKS_FRED_URL = `${UKS_SITE}/destinations/fred-hope-foil-master-2027`;
export const UKS_VILLAS_URL = `${UKS_SITE}/uncharted-villas`;
export const UKS_CONTACT_URL = `${UKS_SITE}/contact-us`;
export const UKS_OPERATOR: OperatorRef = {
  name: 'Uncharted Kite Sessions',
  websiteUrl: `${UKS_SITE}/`,
  rootDomain: 'unchartedkitesessions.com',
};

const memo = new Map<string, { at: number; p: Promise<string> }>();
export function uksPage(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '').replace(/\s*[—–]\s*/g, ' - ');

export interface UksCamp {
  title: string;
  dates: string | null;          // raw dd.dates
  range: { start: string; end: string } | null;
  guests: string | null;         // raw dd.number-of-guests
  maxGuests: number | null;
  priceText: string | null;
  price: number | null;
  currency: string | null;
  perPerson: boolean;            // "p/p" printed
  from: boolean;                 // "Starting @"
  pro: string | null;
  nights: number | null;         // "6 night accommodations"
  includes: string[];
  notIncluded: string | null;
  intro: string;
}

/** The K2 item page: facts list, bullets, not-included, intro. */
export function parseUksCamp(html: string): UksCamp {
  const root = parse(html);
  const dd = (c: string) => txt(root.querySelector(`dd.${c}`)) || null;
  const title = txt(root.querySelector('h1.uk-article-title')) || txt(root.querySelector('title')).replace(/\s*\|.*$/, '');
  const dates = dd('dates');
  const guests = dd('number-of-guests');
  const priceText = dd('price');
  const amount = priceText?.match(/\$\s?([\d,.]+)/)?.[1];
  const incP = root.querySelector('div.package-includes p');
  const includes = (incP ? incP.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '') : '')
    .split(/•|\n/).map(s => collapse(parse(`<p>${s}</p>`).text)).filter(s => s.length > 2)
    .map(s => s.replace(/^(.{0,140}?[.!])\s.*$/, '$1').replace(/\.$/, '').trim());
  const nights = includes.join(' ').match(/(\d+)\s+nights?\s+accommodations?/i)?.[1];
  const maxG = guests?.match(/(\d+)\s*$/)?.[1];
  return {
    title,
    dates,
    range: dates && /\d{4}/.test(dates) ? weekRange(dates) : null,
    guests,
    maxGuests: maxG ? Number(maxG) : null,
    priceText,
    price: amount ? parseAmount(amount) : null,
    currency: priceText && /USD|\$/.test(priceText) ? 'USD' : null,
    perPerson: !!priceText && /p\s*\/\s*p|per person/i.test(priceText),
    from: !!priceText && /starting|from/i.test(priceText),
    pro: dd('pro'),
    nights: nights ? Number(nights) : null,
    includes,
    notIncluded: txt(root.querySelector('div.not-included p')) || null,
    intro: txt(root.querySelector('div.introtext')),
  };
}

/** Nav links of the "Kitesurfing Camps" menu: [text, absolute url]. */
export function uksCampLinks(html: string): Array<{ text: string; url: string }> {
  const out: Array<{ text: string; url: string }> = [];
  for (const a of parse(html).querySelectorAll('a[href^="/destinations/"]')) {
    const url = new URL(a.getAttribute('href')!, UKS_SITE).toString();
    if (!out.some(x => x.url === url)) out.push({ text: txt(a), url });
  }
  return out;
}

const k2xl = (u: string) => u.replace(/_(?:XS|S|M|L|Generic)\.jpg$/, '_XL.jpg');
/** The camp page's K2 image + banners (logos dropped), then the villas page photos (K2 cards upscaled to XL). */
export function uksImages(campHtml: string, villasHtml: string | null): string[] {
  const out: string[] = [];
  for (const html of [campHtml, villasHtml]) {
    if (!html) continue;
    for (const img of parse(html).querySelectorAll('img')) {
      const src = img.getAttribute('src');
      if (!src || /logo|\/website\/|\.svg|\.gif/i.test(src)) continue;
      const u = k2xl(new URL(src, UKS_SITE).toString());
      if (!out.includes(u)) out.push(u);
    }
  }
  return out;
}

export function uksSlot(c: UksCamp, key: string, unit: string, start: string | null, end: string | null, availabilityText: string | null): Slot {
  return {
    key,
    startDate: start,
    endDate: end,
    unit,
    price: c.price,
    currency: c.price ? c.currency : null,
    priceUnit: c.price ? 'package' : null,
    priceBasis: c.price ? 'person' : null, // "p/p" printed on the strapless page; inferred for the Fred Hope week
    occupancy: 1,
    availability: 'on_request',              // "Book Now" -> contact form
    availabilityText,
    spotsLeft: null,
    packageNights: c.nights,
  };
}

// --- Fred Hope Foil Master -------------------------------------------------------------------------
export function buildUksFredSlots(c: UksCamp, today: string): Slot[] {
  if (!c.range || c.range.start < today) return [];
  return [uksSlot(c, c.range.start, c.title, c.range.start, c.range.end, c.guests ? `Number of guests: ${c.guests}` : null)];
}

export function parseUksFredContent(campHtml: string, villasHtml: string | null, today: string): OfferContent {
  const c = parseUksCamp(campHtml);
  if (!c.price) throw new Error('uncharted fred hope: price (dd.price) not found');
  const nights = c.nights ?? 6;
  const edition = c.intro.match(/(\d+)(?:st|nd|rd|th) edition/i)?.[1];
  const upcoming = !!c.range && c.range.start >= today;
  const dateSentence = upcoming && c.range
    ? `The ${c.range.start.slice(0, 4)} week runs ${c.range.start} to ${c.range.end} for ${c.maxGuests ? `at most ${c.maxGuests}` : 'a few'} guests and costs USD ${c.price.toLocaleString('en-US')} per guest; booking is by contact form.`
    : `It runs every year in April; the next edition is not published yet (last printed: ${c.dates ?? 'unknown'}, USD ${c.price.toLocaleString('en-US')} per guest).`;
  const summary = [
    `Uncharted Kite Sessions runs a yearly foil camp with world champion Fred Hope at Kite Beach in Cabarete, on the north coast of the Dominican Republic${edition ? ` (edition ${edition})` : ''}, for kite foilers and wing foilers.`,
    `The package covers ${nights} nights at the oceanfront Uncharted Villas with an own bedroom and bathroom, ${/5 days of coaching/i.test(c.includes.join(' ')) ? '5 days' : 'daily'} of one-on-one coaching with bluetooth headsets and daily video review, an advanced kite-flying course, a private chef with all food and drinks and local transport; riders bring their own gear (Slingshot demo kites available).`,
    dateSentence,
  ].join(' ');
  return {
    kind: 'camp',
    title: c.title.replace(/\s+20\d{2}$/, '') + ' (Uncharted Kite Sessions, Cabarete)',
    summary,
    continent: 'North America',
    country: 'Dominican Republic',
    region: 'Puerto Plata',            // as cabarete-boutique-kite-hotel.ts / kite-beach-inn-cabarete.ts
    spot: 'Kite Beach, Cabarete',
    spotCoords: { lat: 19.76256, lng: -70.42241 }, // same beach pin as kite-beach-inn-cabarete (the geocoder finds no 'Kite Beach, Cabarete'), set by the lead 2026-10-21
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['intermediate', 'advanced'], // foil coaching "for all levels of riders who are passionate about foiling"
    kiteLessons: true,
    equipmentRental: false,            // "Do You Need Your Own Gear? Yes." (Slingshot demo gear in limited quantities)
    beginnerFriendly: false,
    includedServices: c.includes,
    optionalServices: [
      ...(/personalized video is available for purchase for \$\s?(\d+)/i.test(campHtml) ? [`Personalized camp video (USD ${campHtml.match(/personalized video is available for purchase for \$\s?(\d+)/i)![1]})`] : []),
      'Airport transfer by the school\'s drivers (flat taxi rates from POP, STI, AZS, SDQ)',
    ],
    accommodation: 'Own bedroom and bathroom in the oceanfront Uncharted Villas condos on Kite Beach (pool)',
    mealPlan: 'full_board',            // "All food and drinks", private chef
    languages: ['en'],
    rooms: [],
    imageUrls: uksImages(campHtml, villasHtml),
    heroVideoUrl: null,
    sourceUrl: UKS_FRED_URL,
    bookingUrl: UKS_CONTACT_URL,
    sourceText: [`facts: ${JSON.stringify({ ...c, intro: undefined })}`, `intro: ${c.intro}`].join('\n'),
  };
}

export async function uksVillas(ctx: FetchContext): Promise<string | null> {
  try { return await uksPage(UKS_VILLAS_URL); } catch (e) { ctx.note(`villas page (images only) failed: ${(e as Error).message}`); return null; }
}

export const unchartedKiteSessionsFredHopeFoilMasterCabarete: OfferAdapter = {
  key: 'uncharted-kite-sessions-fred-hope-foil-master-cabarete',
  name: 'Uncharted Kite Sessions - Fred Hope Foil Master, Cabarete',
  disciplines: ['kitesurf', 'wingfoil'],
  kind: 'camp',
  operator: UKS_OPERATOR,
  url: UKS_FRED_URL,
  slotMethod: 'html_dates',
  instantBooking: false,
  fetchBudget: 3,
  async fetchContent(ctx) {
    const camp = await uksPage(UKS_FRED_URL);
    return parseUksFredContent(camp, await uksVillas(ctx), todayIso());
  },
  async fetchSlots(ctx) {
    const html = await uksPage(UKS_FRED_URL);
    const newer = uksCampLinks(html).find(l => /Fred Hope/i.test(l.text) && l.url !== UKS_FRED_URL);
    if (newer) ctx.note(`nav links another Fred Hope edition: ${newer.text} ${newer.url}`);
    const c = parseUksCamp(html);
    if (!c.price) throw new Error('uncharted fred hope: price (dd.price) not found');
    if (!c.range) throw new Error(`uncharted fred hope: dates not parsed ("${c.dates}")`);
    const slots = buildUksFredSlots(c, todayIso());
    if (slots.length === 0) ctx.note(`edition ${c.dates} is past; next one not published yet`);
    return slots;
  },
};
