// ---------------------------------------------------------------------------
// UCPA "Kitesurf spécial débutant", Djerba (Tunisia) - UCPA's beginner kite week on the Djerba lagoon: 7 nights at
// the Hotel Zénon in the Mezraya tourist zone (pool, 200 m from the beach, single-sex shared rooms for 2-4), full
// board, 5 days of kitesurf on the lagoon (10 minutes by minibus), gear, spot transfers. The "Kitesurf coaching
// perfectionnement" week (water start mastered) runs on the same dates and is a second unit of this listing.
//
// Data path, slots, flags: the shared UCPA parser in ucpa-kitesurf-debutant-hurghada.ts (product page -> the booking
// box's own calendar JSON /api/product/<id>; land-only rows, EUR per person, live stock; promotional rows carry the
// previous price in the slot text).
// Pin: none on the page (its map embed says q=null,null); the geocoder places "Mezraya, Djerba".
// Requests per run: content 2, slots +2.
// State 2026-10-19: 36 land-only departures (Wednesdays/Saturdays) 21.10.2026-23.10.2027, EUR 801-1,160, almost all
//   "Plus que 2 places disponibles" (UCPA's low-stock wording); coaching week EUR 890 and up.
// ---------------------------------------------------------------------------
import { makeUcpaAdapter, type UcpaListing } from './ucpa-kitesurf-debutant-hurghada.js';
import type { OfferAdapter } from '../types.js';

export const UCPA_DJERBA: UcpaListing = {
  key: 'ucpa-kitesurf-debutant-djerba',
  name: 'UCPA Kitesurf spécial débutant, Djerba',
  title: 'UCPA Beginner Kitesurf Week Djerba',
  units: [
    { id: 'debutant', label: 'Kitesurf spécial débutant (beginners)', url: 'https://www.ucpa.com/sejour/djerba/paadjav10-kitesurf-special-debutant-vacances' },
    { id: 'coaching', label: 'Kitesurf coaching perfectionnement (water start mastered)', url: 'https://www.ucpa.com/sejour/djerba/paadjav11-kitesurf-coaching-perfectionnement-vacances' },
  ],
  continent: 'Africa',
  country: 'Tunisia',
  region: 'Djerba, Medenine',
  spot: 'Mezraya, Djerba',
  imageTokens: ['djerba'],
  summary: p => [
    `UCPA's beginner kite week on Djerba: 7 nights at the ${p.accommodationName ?? 'partner hotel'} in the Mezraya tourist zone in the north-east of the island (pool, 200 m from the beach, single-sex shared rooms for 2-4), full board, and 5 days of kitesurf with UCPA instructors.`,
    `The kite beach is a large, uncrowded lagoon 10 minutes away by minibus where you can stand everywhere, with 12-18 knot thermal wind.`,
    `Riders who already master the water start can book the coaching week on the same dates.`,
  ].join(' '),
  skillLevels: ['beginner', 'intermediate'],
  beginnerFriendly: true,
  durationDays: 8,
  nights: 7,
  includedServices: [
    '7 nights at the Hotel Zénon, Mezraya (shared rooms for 2-4)',
    'Full board',
    '5 days of kitesurf (or another activity when there is no wind)',
    'Instruction by UCPA kite instructors',
    'All kite equipment',
    'Transfers to the kite spot',
  ],
  optionalServices: [
    'Flights from Paris, Lyon, Nantes or Marseille with airport transfer (booked with the week)',
    'Double or single room (7 nights) supplement',
    'Equipment breakage cover',
    'A second week (by phone)',
  ],
  accommodation: 'hotel with pool (shared rooms for 2-4)',
  mealPlan: 'full_board',
};

export const ucpaKitesurfDebutantDjerba: OfferAdapter = makeUcpaAdapter(UCPA_DJERBA);
