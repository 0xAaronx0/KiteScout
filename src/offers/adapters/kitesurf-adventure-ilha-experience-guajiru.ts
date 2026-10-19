// ---------------------------------------------------------------------------
// Kitesurf Adventure (KSA) - Ilha Experience, Ilha do Guajiru (Itarema, Ceará, Brazil): a yearly kite week based at
// Vila Ybytu with breakfast, guided sessions at Almofala, Espraiado, Volta do Rio and a trip day to Patos, downwinders,
// 4x4 support, one dinner, photos and sport insurance; the beginner package adds 10 h of private lessons with gear.
// Kind 'camp' (one base, day trips from there).
//
// Data path (checked 2026-10-19): same Wix layout as the Cumbuco Classic page; the shared KSA parser lives in
// kitesurf-adventure-cumbuco-classic.ts (see its header for the rules: year from the page title "iLHA EXPERIENCE
// 2026", the page's own "DATAS" turmas "Turma 1: 22 a 28 de junho", "Turma 2: 21 a 27 de setembro", prices
// "Pacote Velejador | Quarto Triplo: R$ 6.734,00 ( lote 1) | Duplo R$ 7.574,00 | Single R$ 9.684,00", "Pacote
// Iniciante | Triplo R$ 9.234,00 | Duplo R$ 9.990,00"; BRL, per person INFERRED, on request via WhatsApp / e-mail).
// State 2026-10-19: both 2026 turmas are past -> 0 slots until the page shows the 2027 dates.
// robots.txt (2026-10-19): "User-agent: * Allow: /". Requests per run: 1.
// ---------------------------------------------------------------------------
import { imageCandidates, todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent } from '../types.js';
import { KSA_OPERATOR, KSA_SITE, fetchKsaSlots, ksaDatesLine, ksaPage, ksaPriceLine, ksaText, parseKsaTrip } from './kitesurf-adventure-cumbuco-classic.js';

export const KSA_ILHA_URL = `${KSA_SITE}/ilhaexperience`;
export const KSA_ILHA_TITLE = /EXPERIENCE\s*\|?\s*(20\d{2})/i;

export function parseKsaIlhaContent(html: string, today = todayIso()): OfferContent {
  const trip = parseKsaTrip(html, KSA_ILHA_TITLE);
  const nights = trip.nights ?? 6;
  const t = ksaText(html);
  const spots = ['Almofala', 'Espraiado', 'Volta do Rio', 'Patos'].filter(s => t.includes(s));
  const imgs = imageCandidates(html, KSA_ILHA_URL, null, 40).filter(u => !/logo|whatsapp|icon/i.test(u));
  return {
    kind: 'camp',
    title: 'Kitesurf Adventure Ilha Experience, Ilha do Guajiru',
    summary: [
      `Kitesurf Adventure's kite week at Ilha do Guajiru (Itarema, Ceará, Brazil): ${nights + 1} days / ${nights} nights at Vila Ybytu with breakfast, guided sessions${spots.length ? ` at ${spots.join(', ').replace(/, ([^,]+)$/, ' and $1')}` : ''}, downwinders with 4x4 support, one special dinner, professional photos and sport insurance.`,
      'Warm, shallow water and 18-35 knots in season; the beginner package adds 10 hours of private lessons with equipment; all levels welcome.',
      `${ksaDatesLine(trip, today, false).replace(/^(\d{4}) dates/, 'The $1 dates')}${ksaPriceLine(trip)}`,
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
    includedServices: [
      `${nights} nights at Vila Ybytu with breakfast`,
      'Guided kite sessions, downwinders and explorations by the Kitesurf Adventure team',
      'Internal transfers and transport to the spots (4x4 support)',
      'Water and fruit, one special dinner, professional photos, sport insurance',
      'Beginner package: 10 hours of private lessons with equipment',
    ],
    optionalServices: ['Equipment rental', 'Private advanced lessons', 'Flights', 'Non-kiting companion (price on request)'],
    accommodation: 'pousada (Vila Ybytu), single, double or triple room',
    mealPlan: 'breakfast',
    languages: ['pt'],
    rooms: [],
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KSA_ILHA_URL,
    bookingUrl: KSA_ILHA_URL,
    sourceText: [
      `page: ${t}`,
      `parsed: year ${trip.year}; turmas ${trip.turmas.map(x => `${x.start}..${x.end}`).join(', ')}; prices ${trip.prices.map(p => `${p.pkg}/${p.room} BRL ${p.price}`).join(', ')}`,
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
  async fetchContent() { return parseKsaIlhaContent(await ksaPage(KSA_ILHA_URL)); },
  fetchSlots: ctx => fetchKsaSlots(KSA_ILHA_URL, KSA_ILHA_TITLE, todayIso(), ctx),
};
