// ---------------------------------------------------------------------------
// UCPA "Kitesurf spécial débutant", Essaouira (Morocco) - UCPA's beginner kite week in Essaouira bay: 7 nights at the
// Hotel Miramar on the seafront near the port medina (rooms for 3, own bathroom), full board, 5 days of kitesurf with
// 1 instructor for 4 students, gear, spot transfers. The "Kitesurf coaching perfectionnement" week (water start
// mastered) runs on the same dates and is a second unit of this listing.
//
// Data path, slots, flags: the shared UCPA parser in ucpa-kitesurf-debutant-hurghada.ts (product page -> the booking
// box's own calendar JSON /api/product/<id>; land-only rows, EUR per person, live stock).
// Pin: none on the page (its map embed is empty); the geocoder places "Essaouira".
// Requests per run: content 2, slots +2.
// State 2026-10-19: ONE land-only departure, 24.12.2026 (EUR 1,040; coaching EUR 1,070) - UCPA sells this site only
//   around the year end; later dates appear in the same JSON when UCPA opens them.
// ---------------------------------------------------------------------------
import { makeUcpaAdapter, type UcpaListing } from './ucpa-kitesurf-debutant-hurghada.js';
import type { OfferAdapter } from '../types.js';

export const UCPA_ESSAOUIRA: UcpaListing = {
  key: 'ucpa-kitesurf-debutant-essaouira',
  name: 'UCPA Kitesurf spécial débutant, Essaouira',
  title: 'UCPA Beginner Kitesurf Week Essaouira',
  units: [
    { id: 'debutant', label: 'Kitesurf spécial débutant (beginners)', url: 'https://www.ucpa.com/sejour/essaouira/paaessv11-kitesurf-special-debutant-vacances' },
    { id: 'coaching', label: 'Kitesurf coaching perfectionnement (water start mastered)', url: 'https://www.ucpa.com/sejour/essaouira/paaessv12-kitesurf-coaching-perfectionnement' },
  ],
  continent: 'Africa',
  country: 'Morocco',
  region: 'Marrakech-Safi',
  spot: 'Essaouira',
  imageTokens: ['essaouira'],
  summary: p => [
    `UCPA's beginner kite week in Essaouira: 7 nights at the ${p.accommodationName ?? 'partner hotel'} on the seafront near the port medina (Moroccan-style rooms for 3 with own bathroom), full board, and 5 days of kitesurf in Essaouira bay with 1 instructor for 4 students, beginners working in pairs until the water start.`,
    `A free day falls mid-week or on the least windy day; evenings are in the medina.`,
    `Riders who already master the water start can book the coaching week on the same dates.`,
  ].join(' '),
  skillLevels: ['beginner', 'intermediate'],
  beginnerFriendly: true,
  durationDays: 8,
  nights: 7,
  includedServices: [
    '7 nights at the Hotel Miramar, Essaouira (rooms for 3, own bathroom)',
    'Full board',
    '5 days of kitesurf (or another activity when there is no wind)',
    'Instruction: 1 instructor for 4 students',
    'All kite equipment',
    'Transfers to the kite spots',
  ],
  optionalServices: [
    'Flights from Paris with airport transfer (booked with the week)',
    'Double room supplement',
    'Equipment breakage cover',
    'Day trip to Marrakech',
  ],
  accommodation: 'seafront hotel (rooms for 3)',
  mealPlan: 'full_board',
};

export const ucpaKitesurfDebutantEssaouira: OfferAdapter = makeUcpaAdapter(UCPA_ESSAOUIRA);
