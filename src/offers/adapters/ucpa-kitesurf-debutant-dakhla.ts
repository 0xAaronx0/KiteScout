// ---------------------------------------------------------------------------
// UCPA "Kitesurf spécial débutant", Dakhla (Morocco) - UCPA's beginner kite week at the Eco Camps Dream Kite on the
// Dakhla lagoon (PK25): 7 nights in an earth eco-dome for 3 on the spot (own bathroom), full board, 5 days of
// kitesurf with 1 instructor for 4 students, gear. The "Kitesurf coaching perfectionnement" week (water start
// mastered) runs on the same dates and is a second unit of this listing.
//
// Data path, slots, flags: the shared UCPA parser in ucpa-kitesurf-debutant-hurghada.ts (product page -> the booking
// box's own calendar JSON /api/product/<id>; land-only rows, EUR per person, live stock).
// Pin: the page's Google Maps embed (q=23.908982,-15.780399, on the lagoon north of the city).
// Requests per run: content 2, slots +2.
// State 2026-10-19: 40 land-only departures (Mondays) 21.10.2026-25.10.2027; the 3 autumn 2026 weeks are "Complet",
//   then Feb-Oct 2027 open (EUR 1,090-1,320); coaching week EUR 1,120 and up.
// ---------------------------------------------------------------------------
import { makeUcpaAdapter, type UcpaListing } from './ucpa-kitesurf-debutant-hurghada.js';
import type { OfferAdapter } from '../types.js';

export const UCPA_DAKHLA: UcpaListing = {
  key: 'ucpa-kitesurf-debutant-dakhla',
  name: 'UCPA Kitesurf spécial débutant, Dakhla',
  title: 'UCPA Beginner Kitesurf Week Dakhla',
  units: [
    { id: 'debutant', label: 'Kitesurf spécial débutant (beginners)', url: 'https://www.ucpa.com/sejour/dakhla/paadakv10-kitesurf-special-debutant-vacances' },
    { id: 'coaching', label: 'Kitesurf coaching perfectionnement (water start mastered)', url: 'https://www.ucpa.com/sejour/dakhla/paadakv13-kitesurf-coaching-perfectionnement-vacances' },
  ],
  continent: 'Africa',
  country: 'Morocco',
  region: 'Dakhla-Oued Ed-Dahab',
  spot: 'PK25, Dakhla Lagoon',
  imageTokens: ['dakhla'],
  summary: () => [
    `UCPA's beginner kite week on the Dakhla lagoon: 7 nights in an earth eco-dome for 3 with its own bathroom right on the spot (Eco Camps Dream Kite, PK25), full board, and 5 days of kitesurf with 1 instructor for 4 students, beginners working in pairs until the water start.`,
    `The lagoon is shallow and wave-free in front of the water-sports base, with reliable wind; a free day (or an optional excursion) falls mid-week or on the least windy day.`,
    `Riders who already master the water start can book the coaching week on the same dates.`,
  ].join(' '),
  skillLevels: ['beginner', 'intermediate'],
  beginnerFriendly: true,
  durationDays: 8,
  nights: 7,
  includedServices: [
    '7 nights in an eco-dome for 3 on the kite spot (own bathroom, towels)',
    'Full board',
    '5 days of kitesurf (or another activity when there is no wind)',
    'Instruction: 1 instructor for 4 students',
    'All kite equipment',
  ],
  optionalServices: [
    'Flights from Paris with airport transfer (booked with the week)',
    'Double or single room (7 nights) supplement',
    'Equipment breakage cover',
  ],
  accommodation: 'eco-domes on the spot (3 per dome, own bathroom)',
  mealPlan: 'full_board',
};

export const ucpaKitesurfDebutantDakhla: OfferAdapter = makeUcpaAdapter(UCPA_DAKHLA);
