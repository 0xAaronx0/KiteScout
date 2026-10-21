// ---------------------------------------------------------------------------
// Rügen Kite Hostel, Martinshafen (Sagard, northern Rügen, Germany) - the own hostel of the VDWS kite school Rügen Kite
// (Neuhof 2, 18551 Sagard) on the Großer Jasmunder Bodden; "Vom Bett aufs Brett - unser Hostel vor Ort ist nur wenige
// Meter von unserem Kiterevier entfernt". 16 beds in two houses + 5 camper pitches (pitches not listed).
//
// Data path (checked 2026-10-14), WordPress (SiteOrigin page builder), German only:
//   content  /unterkunft (hostel text: 16 beds, Hostel 1 with two 6-bed rooms, shared kitchen and lounge, Hostel 2 with
//            two double rooms and a small kitchen; "Preise Kitehostel" list; photo galleries; dateModified 2026-04-23),
//            /kurse/kitecamp-ruegen ("Kitecamp Rügen 2026" weeks and prices, the booking form's "Unterkunft" options with
//            the footnotes "* Preise gelten inkl. MwSt. pro Nacht und Person." / "** Preis pro Zimmer inkl. MwSt.",
//            Google Maps place link of "Ostsee Kitesurfschule Rügen Kite" !3d54.364968!4d13.711491).
//   slots    the same two pages: /unterkunft "6 Bett Zimmer 25€", "Doppelzimmer 60€ - Preis pro Zimmer ... Aufbettung für
//            3. Person +15€"; the camp form adds "Doppelzimmer mit Aufbettung für 3: 75€**". No dates or year next to
//            the hostel prices; both pages are 2026 pages (camp "Kitecamp Rügen 2026", /unterkunft modified 2026-04-23).
// No booking engine: the stay is requested through the site's contact / camp form, mail or phone -> 'on_request'.
// robots.txt (2026-10-14): only /wp-admin/ disallowed (admin-ajax allowed).
// Requests per run: content 2, slots 2 (memoised with content) -> 2 for a full run.
// Parsed: 3 slots without dates (the prices carry none): bed in a 6-bed room EUR per person per night (footnote "*"),
//   double room EUR per room per night for 2, double room with extra bed for 3 (footnote "**" says "Preis pro Zimmer";
//   "per night" for the two double-room prices is INFERRED from the page layout and the camp packages, it is not
//   printed next to them). Camper pitches (18 EUR) are dropped.
// Known limits: no season dates for the hostel (kite camps 2026 ran 08.06.-02.10. in the main season, other weeks
//   "Nebensaison"); bed linen EUR 10 once per stay goes into the room features.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.ruegen-kite.de';
export const RK_STAY_URL = `${SITE}/unterkunft`;
export const RK_CAMP_URL = `${SITE}/kurse/kitecamp-ruegen`;
export const RK_ROOM_DORM = '6-bed room (Hostel 1)';
export const RK_ROOM_DOUBLE = 'Double room (Hostel 2)';

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share the pages */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text lines (scripts, styles dropped), split at block tags. */
export function rkLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|figure|figcaption|table|label)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

// --- prices -----------------------------------------------------------------------------------
export interface RkPrice { badge: string; title: string; price: number; description: string }

/** /unterkunft "Preise Kitehostel": .pricing-list__item (badge, title, price, description). */
export function parseRkPriceList(html: string): RkPrice[] {
  return parse(html).querySelectorAll('.pricing-list__item').map(el => ({
    badge: collapse(el.querySelector('.pricing-list__badge')?.text ?? ''),
    title: collapse(el.querySelector('.pricing-list__title')?.text ?? ''),
    price: parseAmount(el.querySelector('.pricing-list__price')?.text ?? '') ?? 0,
    description: collapse(el.querySelector('.pricing-list__description')?.text ?? ''),
  })).filter(x => x.title && x.price > 0);
}

export interface RkCampForm { options: Array<{ label: string; price: number; mark: string }>; footnotes: Record<string, string> }

/** Camp booking form: "Unterkunft" options ("Doppelzimmer: 60€**") and the footnotes below them. */
export function parseRkCampForm(html: string): RkCampForm {
  const options = [...html.matchAll(/name="Unterkunft\[\]" value="([^"]+)"/g)].map(m => {
    const label = clean(m[1]);
    const p = label.match(/([\d.,]+)\s*€(\**)$/);
    return { label: label.replace(/:?\s*[\d.,]+\s*€\**$/, ''), price: parseAmount(p?.[1] ?? '') ?? 0, mark: p?.[2] ?? '' };
  }).filter(o => o.price > 0);
  const footnotes: Record<string, string> = {};
  for (const l of rkLines(html)) {
    const m = l.match(/^(\*{1,2})\s*(Preis[^*]+?)(?=\s*\*|$)/);
    if (m && !footnotes[m[1]]) footnotes[m[1]] = m[2].trim();
    for (const f of l.matchAll(/(\*{1,2})\s*(Preis(?:e gelten| pro)[^*]+?)(?=\s*\*|$)/g)) if (!footnotes[f[1]]) footnotes[f[1]] = f[2].trim();
  }
  return { options, footnotes };
}

export function buildRkSlots(list: RkPrice[], form: RkCampForm): Slot[] {
  const out: Slot[] = [];
  const base = { startDate: null, endDate: null, currency: 'EUR', priceUnit: 'per_night' as const, availability: 'on_request' as const, availabilityText: null, spotsLeft: null };
  const dorm = list.find(x => /kitehostel/i.test(x.badge) && /^6.?Bett/i.test(x.title));
  if (dorm) out.push({ ...base, key: 'bed-6-bed-room', unit: 'Bed in a 6-bed room', room: RK_ROOM_DORM, price: dorm.price, priceBasis: 'person', occupancy: 1 });
  const dbl = list.find(x => /kitehostel/i.test(x.badge) && /^Doppelzimmer$/i.test(x.title));
  if (dbl) out.push({ ...base, key: 'double-room', unit: 'Double room', room: RK_ROOM_DOUBLE, price: dbl.price, priceBasis: 'room', occupancy: 2 });
  // the same Hostel 2 double room with its extra bed (/unterkunft: "Aufbettung für 3. Person +15€" = 60 + 15)
  const triple = form.options.find(o => /Doppelzimmer mit Aufbettung für 3/i.test(o.label));
  if (dbl && triple) out.push({ ...base, key: 'double-room-3', unit: 'Double room with extra bed (3 people)', room: RK_ROOM_DOUBLE, price: triple.price, priceBasis: 'room', occupancy: 3 });
  return out;
}

// --- content ----------------------------------------------------------------------------------
/** Google Maps place link of the school: !3d<lat>!4d<lng>. */
export function rkCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/google\.[a-z.]+\/maps\/place\/[^"']*?!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  return m ? { lat: Math.round(Number(m[1]) * 1e5) / 1e5, lng: Math.round(Number(m[2]) * 1e5) / 1e5 } : null;
}

/** Camp prices: "Nebensaison Kitecamp Rügen 2026 429€", "Hauptsaison … 449€", packages with 4 nights, VDWS licence, dated weeks. */
export function parseRkCamp(html: string): { year: number | null; off: number | null; main: number | null; packages: Array<{ name: string; price: number }>; licence: number | null; weeks: string[] } {
  const lines = rkLines(html);
  const t = lines.join('\n');
  const eur = (re: RegExp): number | null => parseAmount(t.match(re)?.[1] ?? '');
  const packages: Array<{ name: string; price: number }> = [];
  for (const [re, name] of [[/Kitecamp & Stellplatz für Camper ([\d.,]+)\s*€/, 'camper pitch'], [/Kitecamp & 6-Bett Zimmer ([\d.,]+)\s*€/, '6-bed room'], [/Kitecamp & Doppelzimmer ([\d.,]+)\s*€/, 'double room']] as const) {
    const p = eur(re);
    if (p) packages.push({ name, price: p });
  }
  const start = lines.findIndex(l => /Terminwahl$/.test(l));
  const weeks: string[] = [];
  if (start >= 0) for (const l of lines.slice(start + 1)) { if (/^\d{1,2}\.[^€]*\d+€$/.test(l)) weeks.push(l); else if (weeks.length) break; }
  return {
    year: Number(t.match(/Kitecamp Rügen (20\d{2})/)?.[1] ?? NaN) || null,
    off: eur(/^Nebensaison[^\n]*?([\d.,]+)\s*€$/m),
    main: eur(/^Hauptsaison[^\n]*?([\d.,]+)\s*€$/m),
    packages,
    licence: eur(/Kosten: ([\d.,]+)\s*€ pro Person/),
    weeks,
  };
}

/** Full-size gallery photos (lightbox links), then the camp page photos; logos and -WxH thumbnails dropped. */
export function rkImages(stayHtml: string, campHtml: string): string[] {
  const out: string[] = [];
  const add = (u: string) => {
    if (!/\/wp-content\/uploads\//.test(u) || /logo|Rund_Blau|-\d+x\d+\./i.test(u) || out.includes(u)) return;
    out.push(u);
  };
  for (const m of stayHtml.matchAll(/<a href=['"](https:\/\/www\.ruegen-kite\.de\/wp-content\/uploads\/[^'"]+?\.(?:jpe?g|png))['"]/gi)) add(m[1]);
  for (const m of campHtml.matchAll(/(?:src|href|data-src)=['"](https:\/\/www\.ruegen-kite\.de\/wp-content\/uploads\/[^'"]+?\.(?:jpe?g|png))['"]/gi)) add(m[1]);
  return out;
}

export interface RkPages { stay: string; camp: string }

export function parseRuegenKiteContent(p: RkPages): OfferContent {
  const stay = rkLines(p.stay);
  const stayText = stay.join('\n');
  const list = parseRkPriceList(p.stay);
  const form = parseRkCampForm(p.camp);
  const camp = parseRkCamp(p.camp);
  const slots = buildRkSlots(list, form);
  const coords = rkCoords(p.camp);
  const beds = stayText.match(/insgesamt (\d+) Schlafplätze/)?.[1] ?? null;
  const linen = parseAmount(list.find(x => /Bettwäsche einmalig/i.test(x.description))?.description.match(/Bettwäsche einmalig ([\d.,]+)\s*€/)?.[1] ?? '');
  const price = (key: string) => slots.find(s => s.key === key)?.price ?? null;

  const rooms: ContentRoom[] = [
    {
      name: RK_ROOM_DORM,
      description: 'Simple 6-bed rooms in Hostel 1, which has two of them, a large shared kitchen and a lounge; showers in the house.',
      features: [
        price('bed-6-bed-room') ? `EUR ${price('bed-6-bed-room')} per person and night` : null,
        linen ? `Bed linen EUR ${linen} once` : null,
        'Shared kitchen, lounge',
      ].filter((x): x is string => !!x),
    },
    {
      name: RK_ROOM_DOUBLE,
      description: 'Two double rooms in Hostel 2 with a small kitchen and bathroom; an extra bed for a third person is possible.',
      features: [
        price('double-room') ? `EUR ${price('double-room')} per room (per night inferred)` : null,
        price('double-room-3') ? `EUR ${price('double-room-3')} per room with extra bed for 3` : null,
        linen ? `Bed linen EUR ${linen} once` : null,
        'Small kitchen',
      ].filter((x): x is string => !!x),
    },
  ];

  const summary = [
    `Rügen Kite is a VDWS-certified kite school at Martinshafen near Sagard on northern Rügen that teaches in the standing-depth water of the Großer Jasmunder Bodden; its own Kite Hostel${beds ? ` (${beds} beds)` : ''} is a few minutes' walk from the spot.`,
    `Hostel 1 has two 6-bed rooms, a large shared kitchen and a lounge; Hostel 2 has two double rooms with a small kitchen, where an extra bed for a third person is possible${price('bed-6-bed-room') ? `. A bed in a 6-bed room costs EUR ${price('bed-6-bed-room')} per night, a double room EUR ${price('double-room')}${price('double-room-3') ? ` (EUR ${price('double-room-3')} for 3)` : ''}${linen ? `, bed linen EUR ${linen} once` : ''}` : ''}.`,
    camp.main ? `The school's 5-day kite camps (Monday to Friday)${camp.year ? ` in ${camp.year}` : ''} cost EUR ${camp.off ?? camp.main}-${camp.main}, or EUR ${camp.packages.map(x => x.price).join(' / ')} with 4 nights on a camper pitch, in a 6-bed room or in a double room.` : '',
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'Rügen Kite Hostel',
    summary,
    continent: 'Europe',
    country: 'Germany',
    region: 'Sagard, Rügen',
    spot: 'Martinshafen, Großer Jasmunder Bodden',
    ...(coords ? { spotCoords: coords } : {}),
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: ['Shared kitchen', 'Lounge'],
    optionalServices: [
      ...(camp.main ? [`Kite camp ${camp.year ?? ''} (5 days, Monday to Friday): EUR ${camp.off ?? '-'} off-season, EUR ${camp.main} June to September`.replace('  ', ' ')] : []),
      ...camp.packages.map(x => `Kite camp (main season) incl. 4 nights, ${x.name}: EUR ${x.price}`),
      ...(camp.licence ? [`VDWS kite licence EUR ${camp.licence} per person`] : []),
      'Kite rental, wing foil and SUP courses at the school',
    ],
    accommodation: 'kite hostel with dorm and double rooms',
    mealPlan: 'self_catering',
    languages: ['de'],
    rooms,
    imageUrls: rkImages(p.stay, p.camp).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: RK_STAY_URL,
    bookingUrl: RK_CAMP_URL,
    sourceText: [
      `unterkunft: ${stay.filter(l => /Kitehostel|Hostel 1|Hostel 2|Schlafplätze|Kiterevier|Kitespot|Bodden/i.test(l)).join(' | ')}`,
      `price list: ${list.map(x => `${x.badge} ${x.title} ${x.price} (${x.description})`).join('; ')}`,
      `camp form: ${form.options.map(o => `${o.label} ${o.price}${o.mark}`).join('; ')} | ${Object.entries(form.footnotes).map(([k, v]) => `${k} ${v}`).join(' ')}`,
      `camp ${camp.year}: off ${camp.off} main ${camp.main} | ${camp.packages.map(x => `${x.name} ${x.price}`).join('; ')} | licence ${camp.licence} | weeks: ${camp.weeks.join(', ')}`,
    ].join('\n'),
  };
}

export const ruegenKiteHostelMartinshafen: OfferAdapter = {
  key: 'ruegen-kite-hostel-martinshafen',
  name: 'Rügen Kite Hostel, Martinshafen',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Rügen Kite',
    websiteUrl: SITE,
    rootDomain: 'ruegen-kite.de',
    contactEmail: 'info@ruegen-kite.de',
    phone: '+491726669200',
  },
  url: RK_STAY_URL,
  slotMethod: 'price_table',
  fetchBudget: 2,
  async fetchContent() {
    const stay = await page(RK_STAY_URL);
    const camp = await page(RK_CAMP_URL);
    if (!/Kiterevier|Kitespot|Kiteschule/i.test(stay)) throw new Error('ruegen-kite: kite text missing on /unterkunft');
    return parseRuegenKiteContent({ stay, camp });
  },
  async fetchSlots() {
    const list = parseRkPriceList(await page(RK_STAY_URL));
    const form = parseRkCampForm(await page(RK_CAMP_URL));
    const slots = buildRkSlots(list, form);
    if (slots.length < 2) throw new Error(`ruegen-kite: hostel price list ("6 Bett Zimmer" / "Doppelzimmer") not found on /unterkunft (${slots.length} slots)`);
    return slots;
  },
};
