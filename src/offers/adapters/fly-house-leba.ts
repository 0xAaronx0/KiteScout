// ---------------------------------------------------------------------------
// FLY House, Fly Resort Łeba (Pomerania, Poland) - holiday cottages ("domki") on the FLY Camp Łeba campsite at
// Turystyczna 2, next to the beach and the pine forest. Listed: the cottages only (the campsite's pitches are not
// listed, campsite rule). Kite link: two kite schools work on the campsite, Kite and Sun and Airman Kite (lessons
// for children, teens and adults), plus a kite & surf shop on site (/leba/atrakcje-leba/kitesurfing/; the house
// page: "Tuż obok naszej bazy działają dwie zaprzyjaźnione szkółki kitesurfingu").
//
// Data path (checked 2026-10-12): MiroArt CMS (same as kitemarina.pl), Polish only (EN/DE = Google Translate).
//   content  /leba/fly-house/ (cottage layout, site, activities, nfhotel booking link, Google Maps directions link
//            "@54.7644383,17.5273659,461m" -> spotCoords), /leba/atrakcje-leba/kitesurfing/ (the two kite schools,
//            shop), /leba/fly-house/galeria-fly-house-leba/ (photos).
//   slots    none: the site prints no cottage prices (the "cennik" page covers camping pitches only, season 2026
//            29.04.-30.09.). Cottages are sold only in the nfhotel booking engine (booking.nfhotel.pl, widget 4007,
//            preview 4153-978). Its room search does not run through a plain public request: the widget hands
//            availability requests (NfMessage GetAvailability) to a service worker in a hidden iframe
//            ("nfhotel-sw-frame"), so the endpoint is not visible without loading and reverse-engineering that
//            worker (5 discovery requests spent 2026-10-12, stopped there). -> [] = "price on request".
// robots.txt (2026-10-12): flyresort.pl allows everything except /admin, /cache, /captcha, /lib, /modules etc.
//   (fetching robots.txt itself through fetchText trips the bot-challenge check because it contains "/captcha";
//   pages are not affected). booking.nfhotel.pl has no robots.txt (404).
// Requests per run: content 3, slots 1 (the cottage page, memoised: checks whether prices appeared).
// Liveness: "© 2026 Fly Resort", camping price list "SEZON 2026", the nfhotel booking link on the cottage page.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { parse } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';
import { miroArtImages, miroLines } from './kite-marina-sarbsk.js';

const SITE = 'https://flyresort.pl';
export const FH_HOUSE_URL = `${SITE}/leba/fly-house/`;
export const FH_KITE_URL = `${SITE}/leba/atrakcje-leba/kitesurfing/`;
export const FH_GALLERY_URL = `${SITE}/leba/fly-house/galeria-fly-house-leba/`;
const FH_BOOKING_FALLBACK = 'https://booking.nfhotel.pl/preview/4153-978/4007';

const memo = new Map<string, { at: number; p: Promise<string> }>();
function get(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Kite schools named on the kitesurfing page ("Szkoły kitesurfingu na campie:" followed by name / "– description" pairs). */
export function parseFhKiteSchools(html: string): string[] {
  const lines = miroLines(html);
  const i = lines.findIndex(l => /Szkoły kitesurfingu na campie/i.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(i + 1, i + 8)) {
    if (/^[–-]/.test(l) || l.length > 40) continue;
    if (/^Obie szkoły|^Sklep/i.test(l)) break;
    out.push(l);
  }
  return out;
}

/** Directions link "maps/dir/...Fly Resort.../@lat,lng,461m" (footer of every page). */
export function fhCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/google\.[a-z.]+\/maps\/dir\/[^"']*?\/@(-?\d+\.\d+),(-?\d+\.\d+),\d+m/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
}

/** Visible prices on the cottage page (none on 2026-10-12; a hit means the adapter should read them). */
export function fhVisiblePrices(html: string): string[] {
  const t = miroLines(html).join('\n');
  return [...t.matchAll(/\d[\d\s.,]*\s?(?:zł|PLN)\b/gi)].map(m => m[0].trim());
}

export interface FhPages { house: string; kite: string; gallery: string }

export function parseFlyHouseContent(p: FhPages): OfferContent {
  const house = miroLines(p.house);
  const kite = miroLines(p.kite);
  const houseText = house.join('\n');
  const kiteText = kite.join('\n');
  const schools = parseFhKiteSchools(p.kite);
  const booking = p.house.match(/https:\/\/booking\.nfhotel\.pl\/preview\/[\w-]+\/\d+/)?.[0] ?? FH_BOOKING_FALLBACK;
  const yoga = houseText.match(/Poniedziałek, środa, piątek\s*[–-]\s*godz\.\s*(\d{1,2}:\d{2})/i)?.[1] ?? null;
  const kidsHours = houseText.match(/Godziny:\s*(\d{1,2}:\d{2})\s*oraz\s*(\d{1,2}:\d{2})/i);
  const pets = /zwierzaki są mile widziane/i.test(houseText);

  const features = [
    /Dwie oddzielne sypialnie/i.test(houseText) ? 'Two separate bedrooms: one with a double bed, one with two single beds' : null,
    /Salon z aneksem kuchennym/i.test(houseText) ? 'Living room with kitchenette, sofa bed, dining table and TV' : null,
    /lodówkę, płytę grzewczą, czajnik/i.test(houseText) ? 'Kitchen: fridge, hob, kettle, dishes and pots' : null,
    /łazienka z prysznicem/i.test(houseText) ? 'Bathroom with shower, washbasin and toilet' : null,
    /taras od strony południowej/i.test(houseText) ? 'South-facing terrace with a view of the forest' : null,
    pets ? 'Pets welcome' : null,
  ].filter((x): x is string => !!x);
  const rooms: ContentRoom[] = [{
    name: 'FLY House cottage',
    description: 'Holiday cottage on the FLY campsite in Łeba, next to the beach and the pine forest.',
    features,
  }];

  const imageUrls: string[] = [];
  for (const u of [
    ...miroArtImages(p.house, SITE, 'w2000-h-q80-p1'),
    ...miroArtImages(p.kite, SITE, 'w2000-h-q80-p1'),
    ...miroArtImages(p.gallery, SITE, 'w2000-h-q80-p1'),
  ]) {
    const f = u.split('/').pop()!.toLowerCase();
    if (!imageUrls.some(x => x.split('/').pop()!.toLowerCase() === f)) imageUrls.push(u);
  }

  const schoolText = schools.length >= 2 ? `${schools.slice(0, -1).join(', ')} and ${schools[schools.length - 1]}` : schools[0] ?? null;
  const summary = [
    'FLY House is a group of holiday cottages on the FLY Resort campsite in Łeba on the Polish Baltic coast, right by the beach and surrounded by pine forest.',
    `Each cottage has two bedrooms (a double and a twin), a living room with kitchenette and sofa bed, a shower room and a south-facing terrace; the fenced, monitored site has a reception and a food point${pets ? ', and pets are welcome' : ''}.`,
    `Two kite schools work on the campsite${schoolText ? ` (${schoolText})` : ''} and teach children, teenagers and adults, and a kite and surf shop is on site.`,
    'Cottages are booked online in the resort\'s booking engine; the site prints no cottage prices.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'FLY House Łeba',
    summary,
    continent: 'Europe',
    country: 'Poland',
    region: 'Łeba, Pomerania',
    spot: 'Łeba',
    spotCoords: fhCoords(p.house),
    itinerarySpots: [],
    durationDays: null,
    // kite page: "od totalnych podstaw po bardziej zaawansowane manewry" (2026-10-12)
    skillLevels: /od totalnych podstaw/i.test(kiteText) ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: schools.length > 0 || /szkoły kitesurfingu/i.test(kiteText) ? true : null,
    equipmentRental: null,
    beginnerFriendly: /od totalnych podstaw/i.test(kiteText) ? true : null,
    includedServices: [
      ...(yoga ? [`Free yoga and relaxation sessions (Monday, Wednesday, Friday ${yoga})`] : []),
      ...(kidsHours ? [`Free kids' animation (Monday to Friday, ${kidsHours[1]} and ${kidsHours[2]})`] : []),
      'Fenced and monitored grounds',
    ],
    optionalServices: [
      `Kitesurf lessons with the kite schools on the campsite${schoolText ? ` (${schoolText})` : ''}`,
      'Kite and surf shop on site (boards, kites, wetsuits, accessories)',
      'Food point and Windy Bar on site',
    ],
    accommodation: 'holiday cottages on a beachside campsite',
    mealPlan: 'self_catering',
    languages: ['pl'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: FH_HOUSE_URL,
    bookingUrl: booking,
    sourceText: [`fly house: ${houseText}`, `kitesurfing: ${kiteText}`].join('\n'),
  };
}

export const flyHouseLeba: OfferAdapter = {
  key: 'fly-house-leba',
  name: 'Fly Resort Łeba - FLY House',
  kind: 'accommodation',
  operator: {
    name: 'Fly Resort (ATLANTIS Kułakowscy Sp.J.)',
    websiteUrl: SITE,
    rootDomain: 'flyresort.pl',
    contactEmail: 'leba@flyresort.pl',
    phone: '+48 500 240 142',
  },
  url: FH_HOUSE_URL,
  slotMethod: 'booking_engine',
  fetchBudget: 4,
  confidence: 'low', // no prices on the site; the nfhotel engine is not read (service-worker channel)
  async fetchContent() {
    const house = await get(FH_HOUSE_URL);
    const kite = await get(FH_KITE_URL);
    const gallery = await get(FH_GALLERY_URL);
    if (!/Fly HOUSE/i.test(parse(house).querySelector('title')?.text ?? house.slice(0, 2000))) {
      throw new Error('fly-house-leba: cottage page title changed (layout changed?)');
    }
    return parseFlyHouseContent({ house, kite, gallery });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    const html = await get(FH_HOUSE_URL);
    if (!/booking\.nfhotel\.pl/.test(html)) ctx.note('nfhotel booking link missing on the cottage page (engine changed?)');
    const prices = fhVisiblePrices(html);
    if (prices.length) ctx.note(`prices appeared on the cottage page (${prices.slice(0, 5).join(', ')}): extend the adapter`);
    ctx.note('no slot source: cottages are priced only inside the nfhotel booking engine (service-worker channel, not read)');
    return [];
  },
};
