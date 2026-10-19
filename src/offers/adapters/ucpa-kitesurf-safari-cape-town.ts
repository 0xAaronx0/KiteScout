// ---------------------------------------------------------------------------
// UCPA "Kitesurf & Safari", Cape Town (South Africa) - UCPA's kite week for riders who are past the beginner stage
// (the page: "séjour non ouvert aux débutants"): 6 nights in a private villa with pool near Cape Town (about 15
// guests, single-sex rooms for 2-4) + 1 night in the Buffelsfontein game reserve (1h30 away, 3-hour game drive,
// barbecue), full board with a local cook, 6 coached kite sessions of 2 hours over 3 days on the Cape Peninsula
// spots, gear, spot transfers.
//
// Kind 'camp' (one base; the safari is a one-night excursion from it, not a route).
// Data path, slots, flags: the shared UCPA parser in ucpa-kitesurf-debutant-hurghada.ts (product page -> the booking
// box's own calendar JSON /api/product/<id>; land-only rows, EUR per person, live stock).
// Duration: the page sells "8 jours / 7 nuits" on site; the calendar JSON says pD 10 / pN 7 for every row (it seems
//   to count the overnight flights) - durationDays 8, slots end 7 nights after the start date.
// Pin: none on the page; the geocoder places "Cape Town".
// Requests per run: content 1, slots +1.
// State 2026-10-19: 6 land-only departures (Fridays) 23.10.2026-19.02.2027, EUR 1,270-1,330, all "Plus que 1 place
//   disponible".
// ---------------------------------------------------------------------------
import { makeUcpaAdapter, type UcpaListing } from './ucpa-kitesurf-debutant-hurghada.js';
import type { OfferAdapter } from '../types.js';

export const UCPA_CAPE_TOWN: UcpaListing = {
  key: 'ucpa-kitesurf-safari-cape-town',
  name: 'UCPA Kitesurf & Safari, Cape Town',
  title: 'UCPA Kitesurf & Safari Cape Town',
  units: [
    { id: 'safari', label: 'Kitesurf & Safari', url: 'https://www.ucpa.com/sejour/afrique-du-sud-cape-town/paalcpx10-kitesurf-and-decouverte-vie-sauvage-vacances' },
  ],
  continent: 'Africa',
  country: 'South Africa',
  region: 'Western Cape',
  spot: 'Cape Town',
  imageTokens: ['cape-town'],
  summary: () => [
    `UCPA's kite and safari week at Cape Town for riders past the beginner stage: 6 nights in a private villa with pool (about 15 guests, shared rooms for 2-4) plus one night in the Buffelsfontein game reserve, 1h30 away, with a 3-hour game drive.`,
    `Full board is cooked at the villa; the kite part is 6 coached sessions of 2 hours over 3 days on the Cape Peninsula spots, grouped by level.`,
  ].join(' '),
  skillLevels: ['intermediate', 'advanced'],
  beginnerFriendly: false,
  durationDays: 8,
  nights: 7,
  includedServices: [
    '6 nights in a private villa with pool near Cape Town (shared rooms for 2-4)',
    '1 night in the Buffelsfontein game reserve with a 3-hour game drive',
    'Full board (local cook at the villa)',
    '6 kite coaching sessions of 2 hours',
    'All kite equipment',
    'Transfers to the kite spots',
  ],
  optionalServices: [
    'Flights from Paris, Nice, Nantes or Lyon with airport transfer (booked with the week)',
    'Room for two (couple room)',
    'Tandem paragliding flight over Cape Town',
    'A second week (by phone)',
  ],
  accommodation: 'private villa with pool (shared rooms for 2-4) + 1 night in a game reserve',
  mealPlan: 'full_board',
};

export const ucpaKitesurfSafariCapeTown: OfferAdapter = makeUcpaAdapter(UCPA_CAPE_TOWN);
