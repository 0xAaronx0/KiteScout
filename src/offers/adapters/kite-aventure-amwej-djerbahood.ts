// ---------------------------------------------------------------------------
// Kite Aventure - AMWEJ Kite Camp, Djerbahood (Erriadh, Djerba, Tunisia): "le camp de kite de notre club", a
// traditional Djerbian house with 4 suites (Gueblia to Charguiya) for up to 10 guests in the street-art village
// Djerbahood, run by the Kite Aventure kite club (Plage Souk El Guebli, Aghir; IKO instructors, lagoon spot).
// KIND = 'accommodation' (rooms "à partir de 15€/nuit", booked per night on request).
//
// Inclusion (Aaron's decision, 2026-10-14): the own site shows no date newer than "© Kite Aventure 2024" (no
//   2026/27 dates, no dated posts). Listed anyway, with PRICE ON REQUEST and confidence 'low': the printed prices
//   (rooms from EUR 15/night, all-inclusive stay 1 week EUR 675 for 1 person / EUR 990 for 2, 3 days EUR 310 /
//   490) are kept as "printed 2024" text in the room features, never as slots.
//
// Data path (checked 2026-10-14): kiteaventure.com, static HTML (French):
//   content  /sejours.html (AMWEJ block: text, "Chambres: 4", "Max. pers.: 10", "Prix: À partir de 15€/nuit",
//            room photos; activities; footer address, phone, mail, "© Kite Aventure 2024"),
//            /kitesurf.html (club: IKO instructors, max 2 students per instructor, rescue boats, courses with
//            prices; "Séjour kitesurf tout compris" block with inclusions and the 1-week / 3-day prices).
//   slots    none (Aaron: price on request). fetchSlots re-reads /sejours.html (memoised), checks the camp block is
//            still there and returns []; it notes when the footer year changes from 2024 (prices may be current
//            again -> re-check with Aaron).
//   Not used: the footer map on every page is the CLUB's Google Maps pin (!3d33.7177!2d10.9460, Plage Souk El
//            Guebli, Aghir); the site gives no coordinates for the camp in Djerbahood, so spotCoords is omitted.
// robots.txt (2026-10-14): 404 (= allow all).
// Requests per run: content 2, slots 1 (0 extra when content ran in the same process).
// Known limits: room names only as photo captions ("Guebliya Chambre Double", "Charguiya Chambre Double"); no
//   per-room details; the all-inclusive stay may also use partner hotels ("ou dans une variété d'hébergements").
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, findPrices, parse } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://kiteaventure.com';
export const KA_STAYS_URL = `${SITE}/sejours.html`;
export const KA_KITESURF_URL = `${SITE}/kitesurf.html`;

// --- local helpers ------------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share the stays page */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text lines (scripts, styles dropped), split at block tags. */
export function kaLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|figure|table|header|footer|span|a)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

export interface KaCamp { text: string[]; rooms: number | null; maxGuests: number | null; priceText: string | null; fromPerNight: number | null; roomNames: string[]; photos: string[] }

/** The AMWEJ block of /sejours.html (section#amwej-kite-camp). */
export function parseKaCamp(html: string): KaCamp | null {
  const sec = parse(html).querySelector('section#amwej-kite-camp');
  if (!sec) return null;
  const detail = (label: string): string | null => {
    const p = sec.querySelectorAll('.work-full-detail p').find(x => new RegExp(`^${label}`, 'i').test(clean(x.querySelector('strong')?.text ?? '')));
    return p ? clean(p.text.replace(p.querySelector('strong')?.text ?? '', '')) : null;
  };
  const priceText = detail('Prix');
  const photos: string[] = [];
  const roomNames: string[] = [];
  for (const img of sec.querySelectorAll('.work-full-slider img')) {
    const src = img.getAttribute('src');
    if (src) photos.push(new URL(src, `${SITE}/`).toString());
    const alt = clean(img.getAttribute('alt') ?? '');
    if (/chambre/i.test(alt)) roomNames.push(alt);
  }
  const from = priceText?.match(/(\d+)\s*€\s*\/\s*nuit/i);
  return {
    text: sec.querySelectorAll('.text-justify > p').map(p => clean(p.text)).filter(Boolean),
    rooms: Number(detail('Chambres')) || null,
    maxGuests: Number(detail('Max')) || null,
    priceText,
    fromPerNight: from ? Number(from[1]) : null,
    roomNames,
    photos,
  };
}

export interface KaStay { includes: string[]; prices: string[]; week1: number | null; week2: number | null; days3_1: number | null; days3_2: number | null }

/** "Séjour kitesurf tout compris" block of /kitesurf.html: "Inclus :" list + "1 semaine : 1 P : 675 €. 2 P : 990 €". */
export function parseKaStay(lines: string[]): KaStay | null {
  const at = lines.findIndex(l => /^Séjour kitesurf tout compris$/i.test(l));
  if (at < 0) return null;
  const block = lines.slice(at + 1, at + 20);
  const inc = block.findIndex(l => /^Inclus\s*:?$/i.test(l));
  const includes: string[] = [];
  const prices: string[] = [];
  for (const l of inc >= 0 ? block.slice(inc + 1) : []) {
    if (/^-/.test(l)) { includes.push(l.replace(/^-\s*/, '')); continue; }
    if (/\d\s*€/.test(l)) { prices.push(l); continue; }
    break;
  }
  const t = prices.join(' ');
  const n = (re: RegExp) => { const m = t.match(re); return m ? Number(m[1]) : null; };
  return {
    includes, prices,
    week1: n(/1 semaine\s*:\s*1 P\s*:\s*(\d+)\s*€/i), week2: n(/1 semaine\s*:\s*1 P\s*:\s*\d+\s*€\.?\s*2 P\s*:\s*(\d+)\s*€/i),
    days3_1: n(/3 jours\s*:?\s*1 P\s*:\s*(\d+)\s*€/i), days3_2: n(/3 jours\s*:?\s*1 P\s*:\s*\d+\s*€\.?\s*2 P\s*:\s*(\d+)\s*€/i),
  };
}

/** Course blocks of /kitesurf.html: heading "Stage X" + "Durée" + "Prix" lines. */
export function parseKaCourses(lines: string[]): Array<{ name: string; duration: string | null; price: string | null }> {
  const out: Array<{ name: string; duration: string | null; price: string | null }> = [];
  lines.forEach((l, i) => {
    if (!/^Stage (Découverte|Initiation|Autonome|Perfectionnement)$/i.test(l)) return;
    const block = lines.slice(i + 1, i + 25);
    const end = block.findIndex(x => /^Réserve[rz]$/i.test(x));
    const body = end >= 0 ? block.slice(0, end) : block;
    const duration = body.find(x => /^Durée\s*:/i.test(x))?.replace(/^Durée\s*:\s*/i, '') ?? null;
    const price = body.filter(x => /^(Prix|Avec équipement|Sans équipement)\s*:/i.test(x)).join('; ') || null;
    out.push({ name: l, duration, price });
  });
  return out;
}

const COURSE_EN: Record<string, string> = {
  'stage découverte': 'Kitesurf discovery course', 'stage initiation': 'Kitesurf beginner course',
  'stage autonome': 'Kitesurf independence course', 'stage perfectionnement': 'Kitesurf improvement lesson',
};
const STAY_EN: Record<string, string> = {
  'transfert aeroport': 'airport transfer', 'transfert de/vers le club': 'transfers to and from the club',
  'petit déjeuné': 'breakfast', "tour de l'ile": 'island tour', 'stand up paddle et kayaks': 'stand-up paddle and kayaks',
};
const enDuration = (s: string) => s.replace(/heures?/i, 'h').replace(/\s+h$/, ' h');
const enPrice = (s: string) => s
  .replace(/^Prix\s*:\s*/i, '')
  .replace(/Avec équipement\s*:\s*/i, 'with equipment ').replace(/Sans équipement\s*:\s*/i, 'without equipment ')
  .replace(/(\d+)\s*€/g, 'EUR $1');

export interface KaPages { stays: string; kitesurf: string }

export function parseKiteAventureContent(p: KaPages): OfferContent {
  const camp = parseKaCamp(p.stays);
  if (!camp) throw new Error('kite-aventure: AMWEJ block (section#amwej-kite-camp) missing on /sejours.html');
  const stayLines = kaLines(p.stays);
  const kLines = kaLines(p.kitesurf);
  const stay = parseKaStay(kLines);
  const courses = parseKaCourses(kLines);
  const copyright = stayLines.find(l => /^©\s*Kite Aventure\s+\d{4}$/i.test(l)) ?? null;
  const year = copyright?.match(/(\d{4})/)?.[1] ?? null;
  const address = stayLines[stayLines.findIndex(l => /^Adresse$/i.test(l)) + 1] ?? null;
  const ktext = kLines.join(' ');
  const iko = /certifiés IKO/i.test(ktext);
  const twoPerInstructor = /élèves par moniteur est limité à 2/i.test(ktext);
  const printed = `printed on the site, © ${year ?? '2024'}`;

  const summary = [
    `AMWEJ Kite Camp is the kite camp of the Kite Aventure club: a traditional Djerbian house with ${camp.rooms ?? 4} suites for up to ${camp.maxGuests ?? 10} guests in Djerbahood, an art village on Djerba.`,
    `The club itself sits on the lagoon at ${address ? address.replace(/, Djerba$/i, '') : 'Aghir'}${iko ? ', with IKO-certified instructors' : ''}${twoPerInstructor ? ' (at most two students per instructor)' : ''}, and offers courses, downwinders and activities such as yoga, stand-up paddle, kayak, boat trips and desert excursions.`,
    `Rooms and all-inclusive stays are booked on request; the prices on the site date from ${year ?? '2024'}.`,
  ].join(' ');

  const stayIncl = stay?.includes.map(i => STAY_EN[i.toLowerCase()] ?? i) ?? [];
  const features = [
    camp.rooms ? `${camp.rooms} rooms (suites)` : null,
    camp.maxGuests ? `Up to ${camp.maxGuests} guests` : null,
    ...camp.roomNames.map(n => `Room: ${n.replace(/\s*Chambre Double$/i, ' (double room)')}`),
    camp.fromPerNight ? `Rooms from EUR ${camp.fromPerNight} per night (${printed})` : null,
    stay?.week1 && stay.week2 ? `All-inclusive stay, 1 week: EUR ${stay.week1} for 1 person, EUR ${stay.week2} for 2 persons (${printed})` : null,
    stay?.days3_1 && stay.days3_2 ? `All-inclusive stay, 3 days: EUR ${stay.days3_1} for 1 person, EUR ${stay.days3_2} for 2 persons (${printed})` : null,
    stayIncl.length ? `All-inclusive stay includes: ${stayIncl.join(', ')}; 10% off kite courses` : null,
  ].filter((x): x is string => !!x);

  return {
    kind: 'accommodation',
    title: 'AMWEJ Kite Camp (Kite Aventure)',
    summary,
    continent: 'Africa',
    country: 'Tunisia',
    region: 'Djerba, Medenine',
    spot: 'Erriadh (Djerbahood), Djerba',
    // no spotCoords: the site's only map pin is the club at Plage Souk El Guebli (33.7177, 10.9460), not the camp
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: courses.length > 0,
    equipmentRental: /Avec équipement/i.test(ktext) ? true : null,
    beginnerFriendly: /pour les débutants|accessibles à tous/i.test(ktext),
    includedServices: [],
    optionalServices: [
      ...courses.map(c => `${COURSE_EN[c.name.toLowerCase()] ?? c.name}${c.duration ? ` (${enDuration(c.duration)})` : ''}${c.price ? `: ${enPrice(c.price)}` : ''} (${printed})`),
      ...(stay ? [`All-inclusive kite stay with ${stayIncl.join(', ')} (1 week or 3 days, prices in the room features)`] : []),
      'Downwinders and one-day kite raids with boat support',
      'Yoga, stand-up paddle and kayak trips, boat trips, horse riding, desert excursions, barbecue evenings',
      'Therapeutic massage and local cooking',
    ],
    accommodation: 'traditional Djerbian house with 4 suites (kite camp)',
    mealPlan: null,
    languages: ['fr', 'en'], // site in French with an English version (index_en.html)
    rooms: [{
      name: 'Suite (AMWEJ Kite Camp)',
      description: 'Suites named Gueblia to Charguiya in a traditional Djerbian house, with facilities for kiters; booked per night on request.',
      features,
    }],
    imageUrls: [
      ...camp.photos,
      `${SITE}/images/kitesurf-club-djerba.webp`, // kitesurf.html AMWEJ block photo (alt "AMWEJ Kite Camp")
    ].filter((u, i, a) => a.indexOf(u) === i),
    heroVideoUrl: null,
    sourceUrl: KA_STAYS_URL,
    bookingUrl: `${SITE}/contact.html`,
    sourceText: [
      `camp (sejours.html): ${camp.text.join(' ')} | Chambres: ${camp.rooms ?? '-'} | Max. pers.: ${camp.maxGuests ?? '-'} | Prix: ${camp.priceText ?? '-'} | photos: ${camp.roomNames.join(', ')}`,
      `all-inclusive stay (kitesurf.html): includes ${stay?.includes.join(', ') ?? '-'}; prices ${stay?.prices.join(' / ') ?? '-'}`,
      `courses: ${courses.map(c => `${c.name} ${c.duration ?? '-'} ${c.price ?? '-'}`).join('; ')}`,
      `club: ${address ?? '-'}; IKO ${iko}; footer ${copyright ?? '-'}`,
    ].join('\n'),
  };
}

// --- adapter ------------------------------------------------------------------------------------------
export const kiteAventureAmwejDjerbahood: OfferAdapter = {
  key: 'kite-aventure-amwej-djerbahood',
  name: 'Kite Aventure - AMWEJ Kite Camp Djerbahood',
  kind: 'accommodation',
  operator: {
    name: 'Kite Aventure',
    websiteUrl: SITE,
    rootDomain: 'kiteaventure.com',
    contactEmail: 'contact@kiteaventure.com',
    whatsapp: '+21654762434', // footer "Appelez-nous +216 54 762 434", wa.me/21654762434
    phone: '+21654762434',
  },
  url: KA_STAYS_URL,
  slotMethod: 'price_table',
  fetchBudget: 3,
  confidence: 'low', // Aaron 2026-10-14: no sign of life after © 2024; listed with price on request
  async fetchContent() {
    const stays = await page(KA_STAYS_URL);
    const kitesurf = await page(KA_KITESURF_URL);
    return parseKiteAventureContent({ stays, kitesurf });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const stays = await page(KA_STAYS_URL);
    if (!parseKaCamp(stays)) throw new Error('kite-aventure: AMWEJ block (section#amwej-kite-camp) missing on /sejours.html');
    const year = kaLines(stays).find(l => /^©\s*Kite Aventure\s+\d{4}$/i.test(l))?.match(/(\d{4})/)?.[1];
    if (year && year !== '2024') ctx.note(`footer now reads © Kite Aventure ${year}: the printed prices may be current again (ask Aaron before turning them into slots)`);
    const prices = findPrices(kaLines(stays).join(' ')).filter(p => p.amount !== 15);
    if (prices.length) ctx.note(`new prices on /sejours.html (${prices.slice(0, 5).map(p => p.raw).join(', ')})`);
    return [];
  },
};
