// ---------------------------------------------------------------------------
// Kitesurf Adventure (KSA) - Ilha Experience, Ilha do Guajiru (Itarema, Ceará, Brazil): a yearly kite week based at
// Vila Ybytu with breakfast, guided sessions at Almofala, Espraiado, Volta do Rio and a trip day to Patos, downwinders,
// 4x4 support, one dinner, photos and sport insurance; the beginner package adds 10 h of private lessons with gear.
// Kind 'camp' (one base, day trips from there).
//
// Data path (relaunch seen 2026-11-11): the trip is TRIPS.ilha in the static /trips.js; the shared KSA parser lives in
// kitesurf-adventure-cumbuco-classic.ts (see its header). State 2026-11-11: status "27/09 a 02/10/2027 · vagas abertas"
// -> one turma 2027-09-27..2027-10-02; the printed prices are the 2026 edition's ("Valores 2027 sob consulta") -> the
// 2027 slots carry no price, the 2026 prices go out as last published (2026 turmas 22-28 Jun, 21-27 Sep, old page).
// Before the relaunch (2026-10-19) the Wix page printed "iLHA EXPERIENCE 2026", "Turma 1: 22 a 28 de junho" etc.
// robots.txt (2026-11-11): "User-agent: * Allow: /". Requests per run: 1 (/trips.js, shared with the Classic adapter).
// ---------------------------------------------------------------------------
import { todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent } from '../types.js';
import { KSA_OPERATOR, KSA_SITE, KSA_TRIPS_JS, fetchKsaSlots, ksaDatesLine, ksaPage, ksaPriceLine, parseKsaTripsJs } from './kitesurf-adventure-cumbuco-classic.js';

export const KSA_ILHA_URL = `${KSA_SITE}/ilhaexperience`;

export function parseKsaIlhaContent(js: string, today = todayIso()): OfferContent {
  const trip = parseKsaTripsJs(js, 'ilha');
  if (!trip) throw new Error(`kitesurf-adventure: trip "ilha" not found in ${KSA_TRIPS_JS}`);
  const nights = trip.nights ?? 5;
  const t = [trip.sub, ...trip.route].join(' ');
  const spots = ['Almofala', 'Espraiado', 'Volta do Rio', 'Patos'].filter(s => t.includes(s));
  const companion = trip.priceNote.match(/companion: R\$ ?(\d[\d,.]*\d)/i)?.[1] ?? null;
  return {
    kind: 'camp',
    title: 'Kitesurf Adventure Ilha Experience, Ilha do Guajiru',
    summary: [
      `Kitesurf Adventure's kite week at Ilha do Guajiru (Itarema, Ceará, Brazil): ${nights + 1} days / ${nights} nights at Vila Ybytu by the flat-water lagoon, guided sessions${spots.length ? ` at ${spots.join(', ').replace(/, ([^,]+)$/, ' and $1')}` : ''}, downwinders with 4x4 support, professional photos and sport insurance.`,
      'The beginner package includes a course with equipment; all levels welcome.',
      `${ksaDatesLine(trip, 'ilha', today, false).replace(/^(\d{4}) dates/, 'The $1 dates')}${ksaPriceLine(trip)}`,
    ].join(' '),
    continent: 'South America',
    country: 'Brazil',
    region: 'Ceará',
    spot: 'Ilha do Guajiru',
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: trip.included.length ? trip.included : [`${nights} nights at Vila Ybytu`, 'Guided kite sessions and downwinders by the Kitesurf Adventure team'],
    optionalServices: [...trip.excluded, companion ? `Non-riding companion: BRL ${companion}` : 'Non-kiting companion (price on request)'],
    accommodation: 'pousada (Vila Ybytu), single, double or triple room',
    mealPlan: trip.included.some(x => /breakfast/i.test(x)) ? 'breakfast' : null,
    languages: ['pt', 'en', 'fr'], // site in PT / EN / FR since the relaunch (2026-11-11)
    rooms: [],
    imageUrls: trip.images.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KSA_ILHA_URL,
    bookingUrl: KSA_ILHA_URL,
    sourceText: [
      `trips.js ilha: ${trip.sub} | status: ${trip.status} | prices: ${trip.priceNote}`,
      `route: ${trip.route.join(' | ')}`,
      `included: ${trip.included.join('; ')} | not included: ${trip.excluded.join('; ')}`,
      `parsed: edition ${trip.year}; prices of ${trip.priceYear}; turmas ${trip.turmas.map(x => `${x.start}..${x.end}`).join(', ') || 'none'}; prices ${trip.prices.map(p => `${p.pkg}/${p.room} BRL ${p.price}`).join(', ')}`,
    ].join('\n'),
  };
}

export const kitesurfAdventureIlhaExperienceGuajiru: OfferAdapter = {
  key: 'kitesurf-adventure-ilha-experience-guajiru',
  name: 'Kitesurf Adventure Ilha Experience, Ilha do Guajiru',
  kind: 'camp',
  operator: KSA_OPERATOR,
  url: KSA_ILHA_URL,
  slotMethod: 'html_dates',
  liveAvailability: false,
  instantBooking: false,
  fetchBudget: 2,
  async fetchContent() { return parseKsaIlhaContent(await ksaPage(KSA_TRIPS_JS)); },
  fetchSlots: ctx => fetchKsaSlots('ilha', todayIso(), ctx),
};
