// ---------------------------------------------------------------------------
// GKS Kite House, Esposende (Braga District, Northern Portugal) - guest house of GKS Go Kite School in the
// town centre, about five minutes on foot from the school's kite centre on the Cavado river estuary.
//
// STATIC SNAPSHOT, no network: Aaron allowed portal information as the data source for this property as an
// exception (2026-10-12) until the provider answers our request. The school's own site has only one
// sentence about the house, so the room and amenity facts are a manual snapshot of 2026-10-12 from the
// Airbnb listing, read once in the built-in browser like a person (airbnb.com robots.txt disallows
// /rooms/*/photos, amenities, reviews for bots: never fetch it automatically).
// Sources (all read 2026-10-12):
//   - https://en.gokiteschool.org/ (own site, Wix): "Our Guest House is located in the center of Esposende",
//     kite lessons / rental / support prices, IKO affiliation, contact. sourceUrl = this official page.
//   - https://www.airbnb.com/rooms/1179036553258423285 ("kite house-couple room", host Miguel: "We are the
//     GKS Team!", "5 min walking from our kite center", registration 30458/AL, 15 amenities, 13 reviews).
//   - Google Maps place "GKS - Go Kite School" (Centro de Atividades Nauticas, 4740-204 Esposende, the
//     address on the school's site): pin 41.5263011,-8.7795385 = spotCoords (the kite centre, not the house).
// Kite link and current operation: the host is the GKS team; Airbnb reviews from August 2026 (4) and
//   September 2026 (1); Google reviews of the school 2 and 4 months old name Miguel as the instructor.
// Photos: the school's own site (Wix media of its "Camps" section: terrace, lounge, bedroom, hallway; one
//   kitesurf photo) and the host's listing photos on Airbnb (a0.muscache.com /im/pictures/hosting/, allowed
//   by that host's robots.txt). No guest or review photos.
// Not used: Airbnb prices (dynamic OTA prices) -> fetchSlots returns [] ("price on request"); the listing's
//   map (Airbnb blurs the location). Other rooms of the house may exist as separate listings (not checked).
// Requests per run: 0. Re-check by hand when the provider answers or the listing changes.
// ---------------------------------------------------------------------------
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

export const GKS_SITE_URL = 'https://en.gokiteschool.org/';
export const GKS_AIRBNB_URL = 'https://www.airbnb.com/rooms/1179036553258423285';
export const GKS_SNAPSHOT_DATE = '2026-10-12';

const WIX = 'https://static.wixstatic.com/media';
const ABNB = 'https://a0.muscache.com/im/pictures/hosting/Hosting-1179036553258423285/original';

/** Photo candidates, best first (sizes measured 2026-10-12). */
export const GKS_PHOTOS: Array<{ url: string; source: 'gks-site' | 'airbnb-host'; shows: string }> = [
  // en.gokiteschool.org, "Camps" section next to the accommodation text
  { url: `${WIX}/60b055_1bc056f5eca045499dca2783d3e73845~mv2.png`, source: 'gks-site', shows: 'terrace with hammock (940x1277)' },
  { url: `${WIX}/60b055_1631a631486143b4ace0c005338a17a9~mv2.png`, source: 'gks-site', shows: 'lounge (940x738)' },
  { url: `${WIX}/60b055_13ecfc9031684499af3f2fd85410bc58~mv2.png`, source: 'gks-site', shows: 'double bedroom (940x1088)' },
  { url: `${WIX}/60b055_13b068ded62a4734a9c4f7d20f8bc4b1~mv2.jpg`, source: 'gks-site', shows: 'hallway with kiteboard ceiling (855x855)' },
  { url: `${WIX}/60b055_888cd93d3f7b4113a093cd1e83d2e45f~mv2.jpg`, source: 'gks-site', shows: 'kitesurfer, "Kitesurf 01" (2048x1365)' },
  // Airbnb listing photos uploaded by the host (GKS team)
  { url: `${ABNB}/001fc1cd-2d1c-4568-a562-4153d4cdbdba.jpeg`, source: 'airbnb-host', shows: 'couple room (1200x1600)' },
  { url: `${ABNB}/850f0f49-3d9f-4c43-adc8-af51ee1d3e67.jpeg`, source: 'airbnb-host', shows: 'shared terrace (1200x2133)' },
  { url: `${ABNB}/2a342837-47d9-4c22-bda4-9e6be078c401.jpeg`, source: 'airbnb-host', shows: 'kites on the estuary (1200x2400)' },
  { url: `${ABNB}/ee756fad-54bb-44aa-b44f-b59f6e9705f9.jpeg`, source: 'airbnb-host', shows: 'couple room, other side (1200x1600)' },
  { url: `${ABNB}/f5789c67-30ef-490d-9c4e-f9f5d84ffbfc.jpeg`, source: 'airbnb-host', shows: 'lockers in the room (1200x1600)' },
];

/** Hand-read facts (snapshot 2026-10-12). */
export const GKS_FACTS = {
  room: {
    name: 'Couple room',
    description: 'One bed and a dedicated bathroom, for up to 2 guests (Airbnb listing "kite house-couple room")',
    features: ['1 bed', 'Dedicated bathroom', 'Maximum 2 guests', 'Lock on the bedroom door', 'Cotton bed linen'],
  },
  amenities: [
    'Wifi',
    'Shared kitchen (fridge, microwave, kettle, Nespresso coffee maker)',
    'Washing machine',
    'Bed linen and hot water',
    'Shared patio or balcony with an outdoor dining area',
  ],
  notIncluded: ['TV', 'dryer', 'air conditioning', 'heating', 'smoke and carbon monoxide alarms (not reported)'],
  // en.gokiteschool.org kitesurf section (prices in EUR as printed)
  school: [
    'Private kite lessons: 90 min EUR 120, beginner course of 6 h in 3 sessions EUR 400 (equipment, insurance, boat transfer to the beach, support boat, hot showers, parking)',
    'Kite equipment rental for independent riders: 2 h EUR 80, 1 day EUR 120 (boat transfer, rescue boat)',
    'Support for riders with their own gear: day pass EUR 20, week pass EUR 100 (boat transfer, rescue boat, storage, free SUP on windless days)',
    'SUP on the Cavado estuary: lesson EUR 20 (1 h), rental EUR 10 (1 h) / EUR 15 (2 h)',
    'No-wind programme: tandem paragliding, wakeboard, trekking in Geres National Park, climbing, SUP tour on the Neiva river',
  ],
  registration: '30458/AL',
  spotCoords: { lat: 41.5263011, lng: -8.7795385 }, // Google Maps place of the school's own address
};

export function gksKiteHouseContent(): OfferContent {
  const f = GKS_FACTS;
  return {
    kind: 'accommodation',
    title: 'GKS Kite House',
    summary: [
      "GKS Kite House is the guest house of GKS Go Kite School in the centre of Esposende, a small fishing town in northern Portugal between Porto and Braga, about five minutes on foot from the school's kite centre on the Cavado river estuary.",
      'The IKO-affiliated school teaches and rents gear on the flat, shallow lagoon behind the river mouth and takes riders to the beach by boat, with a rescue boat, storage and hot showers at the centre.',
      'The listed couple room has one bed and a dedicated bathroom for up to two guests, who share the kitchen, the patio and a washing machine; there are no meals, and prices are on request.',
    ].join(' '),
    continent: 'Europe',
    country: 'Portugal',
    region: 'Braga District, Northern Portugal',
    spot: 'Esposende, Cavado river estuary',
    spotCoords: f.spotCoords,
    itinerarySpots: [],
    durationDays: null,
    // site: "If you are a beginner ... If you are at an intermediate or advanced level the class will be adapted"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: f.amenities,
    optionalServices: f.school,
    accommodation: 'Guest house of the kite school in Esposende town centre, private room with shared kitchen and patio',
    mealPlan: 'self_catering',
    languages: ['en', 'pt'],
    rooms: [{ ...f.room, features: [...f.room.features] }],
    imageUrls: GKS_PHOTOS.map(p => p.url),
    heroVideoUrl: null,
    sourceUrl: GKS_SITE_URL,
    bookingUrl: null, // booked through the school (contact) or its Airbnb listing; no own booking page
    sourceText: [
      `MANUAL SNAPSHOT ${GKS_SNAPSHOT_DATE} (portal exception allowed by Aaron 2026-10-12; no network at run time)`,
      `own site ${GKS_SITE_URL}: "Our Guest House is located in the center of Esposende, a small fishing town in the North of Portugal. It is close to Porto and Braga." IKO affiliated center No. 42910, RNAAT 42/2013, Centro de Actividades Nauticas - Forum Esposendense, 4740-204 Esposende, +351 961 962 197, gogogo.gks@gmail.com`,
      `school: ${f.school.join(' | ')}`,
      `Airbnb ${GKS_AIRBNB_URL}: "kite house-couple room", room in Esposende, 1 bed, dedicated bathroom, 2 guests maximum, host Miguel ("We love kite and fun! We are the GKS Team!"), "in this house we breath kitesurfing and sports, the house it's well located in the city center of Esposende 1 min from the supermarket and gym, 5 min walking from our kite center", registration ${f.registration}; amenities: ${f.amenities.join('; ')}; not included: ${f.notIncluded.join(', ')}; 4.85 from 13 reviews, latest August and September 2026`,
      `map pin: Google Maps place "GKS - Go Kite School" ${f.spotCoords.lat},${f.spotCoords.lng} (kite centre)`,
      `photos: ${GKS_PHOTOS.map(p => `${p.source}: ${p.shows}`).join('; ')}`,
    ].join('\n'),
  };
}

export const gksKiteHouseEsposende: OfferAdapter = {
  key: 'gks-kite-house-esposende',
  name: 'GKS Kite House (Esposende)',
  kind: 'accommodation',
  operator: {
    name: 'GKS Go Kite School',
    websiteUrl: 'https://en.gokiteschool.org',
    rootDomain: 'gokiteschool.org',
    contactEmail: 'gogogo.gks@gmail.com', // own site, 2026-10-12
    phone: '+351961962197',               // own site, 2026-10-12
  },
  url: GKS_SITE_URL,
  slotMethod: 'price_table', // no prices: always [] (price on request)
  fetchBudget: 0,
  confidence: 'low', // hand-read snapshot, partly from a portal
  async fetchContent() {
    return gksKiteHouseContent();
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    ctx.note(`static snapshot of ${GKS_SNAPSHOT_DATE}: no prices (Airbnb prices are dynamic OTA prices), price on request`);
    return [];
  },
};
