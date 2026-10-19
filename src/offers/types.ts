// ---------------------------------------------------------------------------
// Offer adapters: one adapter per provider offer page (kiezdad style: direct
// adapters, stable keys, mandatory availability, history only on change).
//
// An adapter reads two things, on two cadences:
//   content  - title, description, location, inclusions, image candidates
//              (changes rarely; refreshed weekly, images only on request)
//   slots    - the bookable units in time with price + availability
//              (refreshed daily; this is what "live" means for us)
// ---------------------------------------------------------------------------

/** Product types we ingest through adapters (package_offers.package_type). */
export type OfferKind = 'accommodation' | 'tour' | 'camp' | 'course' | 'experience';

/** Availability of one slot. Ordered roughly from best to worst. */
export const AVAILABILITY = [
  'available',   // bookable, no shortage signal
  'limited',     // "few spots left", "1 place left", low room count
  'on_request',  // provider confirms by mail/WhatsApp; no live inventory
  'waitlist',
  'sold_out',
  'closed',      // outside season / not offered on that date
  'unknown',     // page gives price/date but says nothing about availability
] as const;
export type Availability = (typeof AVAILABILITY)[number];

/** What a guest can still book today (on_request + unknown count: we cannot rule them out). */
export function isBookable(a: Availability): boolean {
  return a === 'available' || a === 'limited' || a === 'on_request' || a === 'unknown';
}

/** How the provider prices a slot. */
export type SlotPriceUnit = 'package' | 'per_night' | 'per_day' | 'per_week';
/** Who the price is for. */
export type SlotPriceBasis = 'person' | 'room' | 'group';

/**
 * One bookable unit in time: a departure (tour), a camp week, a night/season
 * band of a room type (accommodation). `key` must be stable across runs so the
 * history can follow it (e.g. "2026-10-26", "double|2026-07", "classic|2026-10-17").
 */
export interface Slot {
  key: string;
  startDate: string | null;     // YYYY-MM-DD; null = any date in the band below
  endDate: string | null;       // YYYY-MM-DD (inclusive last night / last day)
  /** room type, package variant or route; null = the offer itself */
  unit: string | null;
  /** the content room (ContentRoom.name) this slot prices, when `unit` names it differently */
  room?: string | null;
  price: number | null;         // null = price on request
  currency: string | null;      // ISO 4217, original currency (never converted)
  priceUnit: SlotPriceUnit | null;
  priceBasis: SlotPriceBasis | null;
  /** persons the price assumes (e.g. 2 for "double room, 2 guests") */
  occupancy: number | null;
  availability: Availability;
  /** the provider's own words ("Waitlist only", "1 place left", "Sold out") */
  availabilityText: string | null;
  spotsLeft: number | null;
  /** 'month' / 'season' when the provider gives no exact day (e.g. "August 2026"); default 'day' */
  datePrecision?: 'day' | 'month' | 'season';
  /** the price only holds until this booking date (early bird), YYYY-MM-DD */
  priceValidUntil?: string | null;
  /** raw total as printed when `price` was normalized per person (suite for 2, package for 3) */
  priceTotal?: number | null;
  /** nights a 'package' price covers when it is not the whole tour/camp (e.g. a 5-night stay) */
  packageNights?: number | null;
  /** minimum stay when arriving in this slot (booking-engine restriction) */
  minNights?: number | null;
}

/** The business behind an offer (stored in public.providers, linked as package_offers.operator_id). */
export interface OperatorRef {
  name: string;
  websiteUrl: string;
  /** providers.root_domain, e.g. "kite-village.com" */
  rootDomain: string;
  contactEmail?: string | null;
  whatsapp?: string | null;
  phone?: string | null;
}

export interface ItinerarySpot {
  name: string;
  country: string | null;
  region: string | null;
  order: number;
}

/** A room / unit type for accommodations (mirrors src/lib/rooms.ts Room, without price sampling). */
export interface ContentRoom {
  name: string;
  description: string | null;
  features: string[];
}

export interface OfferContent {
  kind: OfferKind;
  title: string;
  /** 2-4 sentences, plain English, no marketing superlatives */
  summary: string;
  continent: string | null;
  country: string;
  region: string | null;
  /** where it happens (accommodation/camp: the spot; tour: start point) */
  spot: string | null;
  /** map pin for `spot` when the geocoder cannot place it (the KCS map only pins located spots) */
  spotCoords?: { lat: number; lng: number } | null;
  itinerarySpots: ItinerarySpot[];
  durationDays: number | null;  // tours/camps: nights + 1; accommodation: null
  skillLevels: string[];        // 'beginner' | 'intermediate' | 'advanced'
  kiteLessons: boolean | null;
  equipmentRental: boolean | null;
  beginnerFriendly: boolean | null;
  includedServices: string[];
  optionalServices: string[];
  accommodation: string | null; // "beachfront bungalows", "shared villa", ...
  mealPlan: string | null;      // 'breakfast' | 'half_board' | 'full_board' | 'self_catering' | free text
  languages: string[];
  rooms: ContentRoom[];
  /** gallery candidates, best first; the ingest downloads, filters and curates them */
  imageUrls: string[];
  heroVideoUrl: string | null;
  sourceUrl: string;
  bookingUrl: string | null;
  /** raw text the content was read from (kept for re-extraction / audits) */
  sourceText: string | null;
}

/** How an adapter gets its slots - drives the refresh strategy. */
export type SlotMethod =
  | 'booking_engine'  // JSON/XHR behind a booking widget (live inventory)
  | 'jsonld'          // schema.org offers in the page
  | 'html_dates'      // dated departures/weeks with status text on the page
  | 'price_table'     // static seasonal price table, no inventory
  | 'platform';       // marketplace calendar data (BookSurfCamps, bstoked, ...)

export interface FetchContext {
  /** note for the run report; does not fail the source */
  note(text: string): void;
  /** partial delivery (a detail page failed): the ingest keeps old slots instead of retracting them */
  incomplete(reason: string): void;
}

/**
 * How the product app can ask the booking engine live for exact dates (stored in
 * offer_sources.quote; the KCS route /api/catalog/quote executes it). Only engines whose
 * public endpoints robots.txt allows.
 */
export type QuoteRecipe =
  | { engine: 'omnibees'; hotelId: number; chainId: number; currencyId: number; currency: string }
  /** leao: per room type the 1-night product id per guest count; the engine prices any stay length itself */
  | { engine: 'leao'; stationId: number; rooms: Array<{ unit: string; resource: number; products: Record<string, number> }> };

export interface OfferAdapter {
  /** stable id, also package_offers.source_listing_id as `site:<key>` */
  key: string;
  name: string;
  kind: OfferKind;
  operator: OperatorRef;
  /** the page a human would open */
  url: string;
  slotMethod: SlotMethod;
  /** true when fetchSlots reads availability from the provider's own booking system / inventory on every run
   *  (an engine, API or shop stock), not from printed price tables or page text; written to
   *  package_offers.live_availability and shown in the app */
  liveAvailability?: boolean;
  /** true when the provider's own website takes online bookings with immediate confirmation (engine or checkout),
   *  false for request-only booking; independent of liveAvailability; written to package_offers.instant_booking */
  instantBooking?: boolean;
  /** max fetches per run we allow ourselves against this host (politeness budget) */
  fetchBudget: number;
  /** package_offers.extraction_confidence; 'low' when prices/dates cannot be read live (default 'high') */
  confidence?: 'high' | 'medium' | 'low';
  /** live quote recipe for exact dates (booking engines only) */
  quote?: QuoteRecipe;
  /** lower photo size floor for a provider that only publishes small photos (Aaron's call per listing) */
  imageMinSize?: { width: number; height: number };
  fetchContent(ctx: FetchContext): Promise<OfferContent>;
  fetchSlots(ctx: FetchContext): Promise<Slot[]>;
}
