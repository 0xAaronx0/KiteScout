// ---------------------------------------------------------------------------
// TAIGA Tarifa Punta Paloma (Tarifa, Cadiz, Andalusia, Spain) - glamping campsite of the Spanish TAIGA chain on the
// N-340 km 74 at Punta Paloma, "400m from Valdevaqueros beach" (the property page's own words). It rents six glamping
// tent types (two "Premium" tents with an inside bathroom, four with a private outdoor bathroom). Kite link: the
// TAIGA Tarifa kite surf and wing foil experience - lessons with FAV / IKO certified instructors from the Pata Negra
// boat, all levels, equipment included, booked with the stay or at reception.
//
// Data path (checked 2026-10-12):
//   content  www.taigaresorts.com/en/taiga-tarifa-punta-paloma.html (Paraty CMS, English: tent cards, facilities,
//            pool and restaurant hours) + /en/kite-surf-and-wind-foil-in-taiga-tarifa.html (the kite experience).
//            The page's JSON-LD carries two contradicting geos (Hotel 34.29,-17.41 in the Atlantic; Campground
//            36.0741,-5.6825 east of Valdevaqueros, while the address is N-340 km 74, west of TAIGA Valdevaqueros at
//            km 75.5) -> no spotCoords, the geocoder places "Punta Paloma".
//   slots    the chain's Paraty Tech engine, namespace q10-teacampa (the site's own anonymous form POST to
//            www.taigaresorts.com/booking1, JSON-LD units + rate plans in the answer); engine code, sample stays and
//            slot rules live in taiga-tarifa-valdevaqueros.ts (one 7-night stay for 2 adults per month, 12 months).
// robots.txt (2026-10-12): www.taigaresorts.com allows everything.
// Requests per run: content 2, slots 12.
// Parsed: slot = tent type x month ("glamping-tent-brena|2027-06"), EUR per tent for 7 nights (priceUnit 'package',
//   packageNights 7, occupancy 2), the cheapest rate plan; months without tents in the engine (glamping season, pool
//   June-September) get no slots.
// Known limits: see the Valdevaqueros adapter (one sample week per month, tourist tax and extras not included).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { imageCandidates, todayIso } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';
import {
  fetchParatySlots, parseTgPoolSeason, parseTgServices, parseTgUnits, tgLines, tgRoom, type ParatyUnitRules,
} from './taiga-tarifa-valdevaqueros.js';

const SITE = 'https://www.taigaresorts.com';
export const TPP_PAGE_URL = `${SITE}/en/taiga-tarifa-punta-paloma.html`;
export const TPP_KITE_URL = `${SITE}/en/kite-surf-and-wind-foil-in-taiga-tarifa.html`;
export const TPP_NAMESPACE = 'q10-teacampa';

export const tppRules: ParatyUnitRules = {
  isRental: n => /glamping|tent|bungalow|tiny home/i.test(n),
  unitName: n => n,
};

export interface TppPages { page: string; kite: string }

export function parseTaigaPuntaPalomaContent(p: TppPages): OfferContent {
  const lines = tgLines(p.page);
  const kiteLines = tgLines(p.kite);
  const units = parseTgUnits(p.page, TPP_NAMESPACE).filter(u => tppRules.isRental(u.name));
  const premium = units.filter(u => /premium/i.test(u.name)).length;
  const caps = units.map(u => Number(u.capacity?.match(/(\d+)/)?.[1])).filter(n => n > 0);
  const capText = caps.length ? `for ${Math.min(...caps)} to ${Math.max(...caps)} guests` : 'for couples and families';
  const services = parseTgServices(p.page);
  const poolText = parseTgPoolSeason(lines);
  const intro = lines.find(l => /^Enjoy an unparalleled experience/.test(l)) ?? '';
  const kiteIntro = kiteLines.find(l => /^Embark on an exciting water adventure/.test(l)) ?? '';
  const levels = kiteLines.find(l => /Levels: All levels/i.test(l)) ?? '';
  const included = kiteLines.filter(l => /^(What's Included: )?• /.test(l)).slice(0, 6).map(l => l.replace(/^What's Included: /, '').replace(/^•\s*/, '').replace(/\.$/, ''));

  const imageUrls: string[] = [];
  for (const u of [...units.flatMap(u => u.images.slice(0, 2)), ...units.flatMap(u => u.images.slice(2)),
    ...imageCandidates(p.page, TPP_PAGE_URL, null, 120).filter(x => x.startsWith(`https://cdn2.paraty.es/${TPP_NAMESPACE}/images/`))]) {
    if (!imageUrls.includes(u)) imageUrls.push(u);
  }

  const summary = [
    `TAIGA Tarifa Punta Paloma is a glamping campsite of the Spanish TAIGA chain on the N-340 at Punta Paloma, Tarifa, 400 m from Valdevaqueros beach.`,
    `It rents ${units.length} glamping tent types ${capText}: ${premium} premium tents with a living area and a bathroom inside, the others with a private outdoor bathroom and a furnished terrace.`,
    `Kitesurf and wing foil lessons with FAV and IKO certified instructors run from the Pata Negra boat for all levels and can be booked with the stay${poolText ? `; the pool is open from ${poolText}` : ''}, with a bar-restaurant and minimarket on site.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'TAIGA Tarifa Punta Paloma',
    summary,
    continent: 'Europe',
    country: 'Spain',
    // grouped with Valdevaqueros on the map: the page places it "400m from Valdevaqueros beach"
    region: 'Valdevaqueros, Tarifa',
    spot: 'Punta Paloma',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: /from beginners to advanced/i.test(levels) ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: /learn kitesurfing/i.test(kiteIntro),
    equipmentRental: null, // the lessons include the equipment; no stand-alone rental is offered
    beginnerFriendly: /beginners/i.test(levels),
    includedServices: services.filter(s => !/^Private bathrooms$/i.test(s)).map(s => (/pool/i.test(s) && poolText ? `${s} (${poolText})` : s)),
    optionalServices: [
      `Kitesurf and wing foil lessons from the Pata Negra boat${included.length ? ` (${included.join('; ')})` : ''}`,
      'Excursions: Tarifa town tour, day trip to Tangier, aquatic banana, hiking',
    ],
    accommodation: 'glamping tents',
    mealPlan: null,
    languages: [],
    rooms: units.map(tgRoom),
    imageUrls: imageUrls.slice(0, 40),
    heroVideoUrl: null,
    sourceUrl: TPP_PAGE_URL,
    bookingUrl: TPP_PAGE_URL,
    sourceText: [
      `intro: ${intro}`,
      `services: ${services.join(', ')}; pool: ${poolText ?? '-'}`,
      `kite: ${kiteIntro} | ${levels} | included: ${included.join('; ')}`,
      `units: ${units.map(u => `${u.name} (${[u.size, u.bedrooms, u.capacity].filter(Boolean).join(', ')}): ${u.summary ?? ''}`).join(' | ')}`,
    ].join('\n'),
  };
}

export async function fetchTaigaPuntaPalomaSlots(ctx: FetchContext, today: string): Promise<Slot[]> {
  return fetchParatySlots(ctx, TPP_NAMESPACE, today, tppRules, 'taiga-tarifa-punta-paloma');
}

export const taigaTarifaPuntaPaloma: OfferAdapter = {
  key: 'taiga-tarifa-punta-paloma',
  name: 'TAIGA Tarifa Punta Paloma',
  kind: 'accommodation',
  operator: {
    name: 'TAIGA Campings & Resorts',
    websiteUrl: SITE,
    rootDomain: 'taigaresorts.com',
    contactEmail: 'hola.tarifa@taigaresorts.com',
    phone: '+34951204531',
  },
  url: TPP_PAGE_URL,
  slotMethod: 'booking_engine',
  fetchBudget: 15,
  async fetchContent() {
    const page = await fetchText(TPP_PAGE_URL, { accept: 'text/html' });
    const kite = await fetchText(TPP_KITE_URL, { accept: 'text/html' });
    return parseTaigaPuntaPalomaContent({ page, kite });
  },
  async fetchSlots(ctx) {
    return fetchTaigaPuntaPalomaSlots(ctx, todayIso());
  },
};
