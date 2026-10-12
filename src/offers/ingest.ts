// ---------------------------------------------------------------------------
// Offer ingest: adapter → validate → operator (providers) → package_offers →
// images (curated, private bucket) → slots (offer_slots + history on change).
//
// Modes:
//   full   content + images (only if none yet, or --refresh-images) + slots
//   slots  slots only (the daily price/availability refresh)
//
// Slots go to public.offer_slots when migration 20261009120000 is applied;
// before that a capped summary lives in package_offers.pricing.slots.
// ---------------------------------------------------------------------------
import { createHash } from 'node:crypto';
import { supabase } from '../lib/supabase.js';
import { curateAndStoreImages, slugify, type StoredImage, type VisionBrief } from '../lib/images.js';
import { geocodeSpot } from '../lib/geocode.js';
import { mergeItinerarySpots, type StoredSpot } from '../lib/itinerary-spots.js';
import { checkSlots, contentProblem } from './validate.js';
import { BlockedByHost, countRequests } from './http.js';
import { isBookable, type OfferAdapter, type OfferContent, type OfferKind, type Slot } from './types.js';

export const SOURCE_PREFIX = 'site:';
/** an empty slot list while at least this many slots were active keeps the stock (kiezdad LEER_SCHUTZ_AB) */
export const EMPTY_GUARD = 3;
const ADAPTER_TIMEOUT_MS = 4 * 60_000;
const PRICING_SLOT_CAP = 24; // interim jsonb summary only; the full set belongs in offer_slots
const HISTORY_KEEP = 30;

export type IngestMode = 'full' | 'slots';

export interface AdapterReport {
  key: string;
  /** blocked = the host refused us on purpose (403 / captcha); needs the provider, not a code fix */
  status: 'ok' | 'error' | 'blocked' | 'dry_run';
  mode: IngestMode;
  offerId: string | null;
  operatorId: string | null;
  slots: number;
  bookable: number;
  minPrice: string | null;
  images: number | null;
  contentChanged: boolean | null;
  slotsChanged: boolean | null;
  slotStore: 'offer_slots' | 'pricing_jsonb' | 'none';
  retracted: number;
  problems: string[];
  notes: string[];
  requests: number;
  ms: number;
  error?: string;
  /** full mode only: slots could not be read (blocked host, ...); content was still written */
  slotError?: string;
}

const BRIEFS: Record<OfferKind, VisionBrief> = {
  accommodation: {
    offerLabel: 'kite guesthouse / kite hotel',
    wanted: 'the HOUSE (exterior, rooms, pool, terrace), the kite SPOT or beach in front of it, or people kiting there',
  },
  tour: {
    offerLabel: 'guided kite tour (downwinder / road trip)',
    wanted: 'riders KITING on the route, the coastline and spots of the tour, the group or support vehicles on the beach',
  },
  camp: {
    offerLabel: 'kite camp package (lessons + stay)',
    wanted: 'people KITING or in lessons, the kite SPOT, the camp accommodation, the group',
  },
  course: {
    offerLabel: 'kitesurf course / lessons',
    wanted: 'students and instructors in LESSONS on the water or beach, the kite SPOT, the school station',
  },
  experience: {
    offerLabel: 'kite getaway / experience package',
    wanted: 'people KITING, the kite SPOT, the accommodation and activities that are part of the package',
  },
};

function sha(v: unknown): string {
  return createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<T>((_, rej) => { timer = setTimeout(() => rej(new Error(`${what}: timeout after ${ms / 1000}s`)), ms); });
  // clear the timer either way, or the CLI stays alive until it fires
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

let slotTableKnown: boolean | null = null;
export async function slotTablesExist(): Promise<boolean> {
  if (slotTableKnown !== null) return slotTableKnown;
  const { error } = await supabase.from('offer_slots').select('id').limit(1);
  slotTableKnown = !error;
  return slotTableKnown;
}

// --- operator --------------------------------------------------------------------
async function upsertOperator(a: OfferAdapter): Promise<string> {
  const op = a.operator;
  const { data: found, error } = await supabase
    .from('providers').select('id,name,website_url,contact_email,whatsapp,phone,trip_types')
    .eq('root_domain', op.rootDomain).maybeSingle();
  if (error) throw new Error(`providers read failed: ${error.message}`);
  if (found) {
    // fill gaps only; a human may have curated the existing row
    const patch: Record<string, unknown> = {};
    if (!found.name) patch.name = op.name;
    if (!found.website_url) patch.website_url = op.websiteUrl;
    if (!found.contact_email && op.contactEmail) patch.contact_email = op.contactEmail;
    if (!found.whatsapp && op.whatsapp) patch.whatsapp = op.whatsapp;
    if (!found.phone && op.phone) patch.phone = op.phone;
    const types = (found.trip_types as string[] | null) ?? [];
    if (!types.includes(a.kind)) patch.trip_types = [...types, a.kind];
    if (Object.keys(patch).length) {
      const { error: upErr } = await supabase.from('providers').update(patch).eq('id', found.id);
      if (upErr) throw new Error(`providers update failed: ${upErr.message}`);
    }
    return found.id as string;
  }
  const { data, error: insErr } = await supabase.from('providers').insert({
    name: op.name,
    root_domain: op.rootDomain,
    website_url: op.websiteUrl,
    contact_email: op.contactEmail ?? null,
    whatsapp: op.whatsapp ?? null,
    phone: op.phone ?? null,
    trip_types: [a.kind],
    discovery_source: 'offer_adapter',
    status: 'new',
  }).select('id').single();
  if (insErr) throw new Error(`providers insert failed: ${insErr.message}`);
  return data.id as string;
}

// --- what is still ahead ---------------------------------------------------------------
/**
 * A dated departure (tour/camp) is gone once it has started; a band (room x month, season,
 * month-only departure) is gone once its last day has passed.
 */
export function isAhead(kind: OfferKind, s: Slot, today: string): boolean {
  if (kind !== 'accommodation' && s.startDate && (s.datePrecision ?? 'day') === 'day') return s.startDate >= today;
  return s.endDate === null || s.endDate >= today;
}

// --- price summary ------------------------------------------------------------------
interface PriceSummary {
  min: Slot | null;
  priceUnit: 'package' | 'per_night' | 'per_day' | 'other';
  note: string | null;
  raw: string | null;
}

export function summarizePrice(kind: OfferKind, slots: Slot[], today: string): PriceSummary {
  const future = slots.filter(s => s.price !== null && isBookable(s.availability) && isAhead(kind, s, today));
  // compare like with like: the most common currency + unit among future priced slots
  const tally = new Map<string, number>();
  for (const s of future) tally.set(`${s.currency}|${s.priceUnit}|${s.priceBasis}`, (tally.get(`${s.currency}|${s.priceUnit}|${s.priceBasis}`) ?? 0) + 1);
  const top = [...tally.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  const pool = top ? future.filter(s => `${s.currency}|${s.priceUnit}|${s.priceBasis}` === top) : [];
  const min = pool.sort((x, y) => x.price! - y.price!)[0] ?? null;
  const fallbackUnit = kind === 'accommodation' ? 'per_night' : 'package';
  const priceUnit = !min ? fallbackUnit
    : min.priceUnit === 'per_week' ? 'other'
    : (min.priceUnit ?? fallbackUnit);
  if (!min) return { min: null, priceUnit, note: 'Price on request', raw: 'Price on request' };
  const per = { person: ' p.p.', room: ' per room', group: ' per group' }[min.priceBasis ?? 'person'] ?? '';
  const period = min.priceUnit === 'package' && min.packageNights ? ` / ${min.packageNights} nights`
    : { package: '', per_night: ' / night', per_day: ' / day', per_week: ' / week' }[min.priceUnit ?? 'package'] ?? '';
  const amount = min.price!.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const raw = `From ${min.currency} ${amount}${period}${per}`;
  const what = min.unit ? `${min.unit}${min.startDate ? `, ${min.startDate}` : ''}` : (min.startDate ?? 'season');
  return { min, priceUnit, raw, note: `${raw} (cheapest bookable: ${what}; as of ${today})` };
}

function slotJson(s: Slot) {
  return {
    key: s.key, start_date: s.startDate, end_date: s.endDate, unit: s.unit,
    price: s.price, currency: s.currency, price_unit: s.priceUnit, price_basis: s.priceBasis,
    occupancy: s.occupancy, status: s.availability, status_text: s.availabilityText, spots_left: s.spotsLeft,
    date_precision: s.datePrecision ?? 'day', price_valid_until: s.priceValidUntil ?? null, price_total: s.priceTotal ?? null,
    package_nights: s.packageNights ?? null, min_nights: s.minNights ?? null,
  };
}

// --- map pins --------------------------------------------------------------------------
// The KCS map pins an offer only from itinerary_spots with lat/lng. Route stops if the adapter
// has them, else its one spot. Order: known pin, stored coordinates, geocoder.

/** Stops and spots the geocoder places wrongly or not at all (checked 2026-10-12); keys are lower-case names. */
const KNOWN_PINS: Record<string, { lat: number; lng: number }> = {
  // "Jericoacoara, Ceará" resolves to the municipality, 11 km inland; this is the village
  jericoacoara: { lat: -2.7952, lng: -40.5152 },
  // end of the Dakhla downwind; Nominatim returns a Dakhla street and a namesake in southern Morocco
  lagouira: { lat: 20.8333, lng: -17.0833 },
  // spot names the geocoder cannot place (checked 2026-10-12); simpler place names or the sources noted
  'namotu island': { lat: -17.8442, lng: 177.1834 },
  'ilha do guajiru': { lat: -2.88086, lng: -39.91218 }, // 7 Beaufort's own map pin in the village
  "emerald sea (mer d'emeraude), babaomby": { lat: -12.233, lng: 49.35 }, // Ramena, the boat departure (Wikipedia)
  'mambrui, malindi': { lat: -3.1145, lng: 40.158 },
  'foum labouir, dakhla': { lat: 23.7673, lng: -15.9198 }, // Foum El Bouir, Atlantic side
  alvor: { lat: 37.1291, lng: -8.5929 }, // "Alvor, Algarve" does not resolve, "Alvor, Portugal" does
  'my hoa lagoon': { lat: 11.599942, lng: 109.145992 }, // kitejungle spot guide; Nominatim lands near Saigon
  'sur masirah, masirah island': { lat: 20.612, lng: 58.8752 },
  'praia do bilene': { lat: -25.2836, lng: 33.275 }, // Uembje lagoon; "Bilene" lands inland
  'bislig beach, bulalacao': { lat: 12.3262, lng: 121.3437 }, // Bulalacao town
  'bulabog beach, boracay': { lat: 11.9637, lng: 121.9303 },
  'lo stagnone': { lat: 37.865, lng: 12.455 }, // the lagoon; Nominatim lands 40 km north-east near Custonaci
  // Itarema / Amontada (Ceará) beaches, from the OSM hamlets: "Praia do Farol" alone resolves to Mosqueiro, Pará,
  // "Praia de Patos" finds nothing, "Icaraí de Amontada" lands 4.5 km inland
  'praia do farol': { lat: -2.8741, lng: -39.9409 },
  'praia de patos': { lat: -3.0055, lng: -39.7486 },
  'icaraí de amontada': { lat: -3.0248, lng: -39.6467 },
  touros: { lat: -5.1999, lng: -35.4595 }, // the beach town; the geocoder returns the municipality, 18 km inland
  // Tarifa (OSM): "Valdevaqueros" alone resolves to a village in Zamora, "Punta Paloma" to Fuerteventura
  valdevaqueros: { lat: 36.0662, lng: -5.6814 },
  'punta paloma': { lat: 36.0594, lng: -5.7111 },
};

export async function locateSpots(c: OfferContent, stored: unknown): Promise<StoredSpot[]> {
  const named = c.itinerarySpots.length
    ? c.itinerarySpots
    : c.spot ? [{ name: c.spot, country: c.country, region: c.region, order: 1 }] : [];
  const known = new Map((Array.isArray(stored) ? stored as StoredSpot[] : [])
    .filter(s => s && typeof s.lat === 'number' && typeof s.lng === 'number')
    .map(s => [s.name.trim().toLowerCase(), s] as const));
  const out: StoredSpot[] = [];
  for (const s of named) {
    const pinned = (!c.itinerarySpots.length && c.spotCoords ? c.spotCoords : null) ?? KNOWN_PINS[s.name.trim().toLowerCase()] ?? null;
    const prev = known.get(s.name.trim().toLowerCase());
    const g = pinned ?? (prev ? { lat: prev.lat!, lng: prev.lng! } : await geocodeSpot(s.name, s.region, s.country));
    out.push({ name: s.name, country: s.country, region: s.region, lat: g?.lat ?? null, lng: g?.lng ?? null, order: s.order });
  }
  return mergeItinerarySpots(out, stored).spots;
}

// --- content row ---------------------------------------------------------------------
function contentRow(a: OfferAdapter, c: OfferContent, operatorId: string, spots: StoredSpot[]) {
  return {
    package_type: c.kind,
    title: c.title,
    slug: slugify(c.title),
    source_listing_id: SOURCE_PREFIX + a.key,
    source_url: c.sourceUrl,
    continent: c.continent,
    country: c.country,
    region: c.region,
    itinerary_spots: spots,
    skill_levels: c.skillLevels,
    kite_lessons: c.kiteLessons,
    equipment_rental: c.equipmentRental,
    beginner_friendly: c.beginnerFriendly,
    meal_plan: c.mealPlan,
    languages: c.languages,
    included_services: c.includedServices,
    optional_services: c.optionalServices,
    accommodation: c.accommodation,
    summary: c.summary,
    hero_video_url: c.heroVideoUrl,
    source_text: c.sourceText,
    duration_days: c.durationDays,
    departure_port: c.kind === 'tour' ? c.spot : null,
    operator_id: operatorId,
    is_active: true,
    manually_verified: false,
    extraction_confidence: a.confidence ?? 'high',
  };
}

function roomsWithPrices(c: OfferContent, slots: Slot[], today: string) {
  return c.rooms.map(r => {
    const priced = slots.filter(s => s.unit === r.name && s.price !== null && isBookable(s.availability) && isAhead(c.kind, s, today));
    const min = priced.sort((x, y) => x.price! - y.price!)[0];
    const months = [...new Set(priced.filter(s => s.startDate).map(s => Number(s.startDate!.slice(5, 7))))].sort((x, y) => x - y);
    return {
      name: r.name, description: r.description, features: r.features,
      price_from: min?.price ?? null, price_currency: min?.currency ?? null,
      price_unit: min ? (min.priceUnit === 'per_week' ? 'other' : min.priceUnit) : null,
      // basis of price_from (room / person / group); KCS shows it as "per room" etc.
      price_source: 'provider_site', price_basis: min?.priceBasis ?? null, priced_months: months, image_sort: null,
    };
  });
}

// --- slots: table mode --------------------------------------------------------------
async function writeSlotTable(offerId: string, slots: Slot[], allowRetract: boolean): Promise<{ changed: number; retracted: number }> {
  const { data: existing, error } = await supabase
    .from('offer_slots').select('id,slot_key,availability,price,currency,spots_left,active')
    .eq('package_offer_id', offerId);
  if (error) throw new Error(`offer_slots read failed: ${error.message}`);
  const byKey = new Map((existing ?? []).map(r => [r.slot_key as string, r]));
  const now = new Date().toISOString();
  let changed = 0;
  for (const s of slots) {
    const prev = byKey.get(s.key);
    const prevPrice = prev?.price === null || prev?.price === undefined ? null : Number(prev.price);
    const differs = !prev || !prev.active || prev.availability !== s.availability
      || prevPrice !== s.price || prev.currency !== s.currency || (prev.spots_left ?? null) !== s.spotsLeft;
    const row = {
      package_offer_id: offerId, slot_key: s.key, start_date: s.startDate, end_date: s.endDate, unit: s.unit,
      price: s.price, currency: s.currency, price_unit: s.priceUnit, price_basis: s.priceBasis, occupancy: s.occupancy,
      availability: s.availability, availability_text: s.availabilityText, spots_left: s.spotsLeft,
      date_precision: s.datePrecision ?? 'day', price_valid_until: s.priceValidUntil ?? null, price_total: s.priceTotal ?? null,
      package_nights: s.packageNights ?? null, min_nights: s.minNights ?? null,
      active: true, last_seen_at: now, ...(differs ? { changed_at: now } : {}),
    };
    const { data: up, error: upErr } = await supabase
      .from('offer_slots').upsert(row, { onConflict: 'package_offer_id,slot_key' }).select('id').single();
    if (upErr) throw new Error(`offer_slots upsert failed (${s.key}): ${upErr.message}`);
    if (differs) {
      changed++;
      const { error: hErr } = await supabase.from('offer_slot_history').insert({
        slot_id: up.id, availability: s.availability, price: s.price, currency: s.currency, spots_left: s.spotsLeft,
      });
      if (hErr) throw new Error(`offer_slot_history insert failed: ${hErr.message}`);
    }
  }
  let retracted = 0;
  if (allowRetract) {
    const seen = new Set(slots.map(s => s.key));
    const gone = (existing ?? []).filter(r => r.active && !seen.has(r.slot_key as string)).map(r => r.id);
    if (gone.length) {
      const { error: rErr } = await supabase.from('offer_slots').update({ active: false }).in('id', gone);
      if (rErr) throw new Error(`offer_slots retract failed: ${rErr.message}`);
      retracted = gone.length;
    }
  }
  return { changed, retracted };
}

async function recordSource(a: OfferAdapter, offerId: string | null, rep: AdapterReport, hashes: { content?: string; slots?: string }): Promise<void> {
  if (!(await slotTablesExist())) return;
  const { data: prev } = await supabase.from('offer_sources').select('history,content_hash,slots_hash').eq('key', a.key).maybeSingle();
  const now = new Date().toISOString();
  const history = [{ at: now, mode: rep.mode, slots: rep.slots, bookable: rep.bookable, ms: rep.ms, ...(rep.error ? { error: rep.error } : {}) },
    ...((prev?.history as unknown[]) ?? [])].slice(0, HISTORY_KEEP);
  const row: Record<string, unknown> = {
    key: a.key, name: a.name, kind: a.kind, slot_method: a.slotMethod, url: a.url, quote: a.quote ?? null,
    last_run_at: now, history, last_error: rep.error ?? null,
    ...(offerId ? { package_offer_id: offerId } : {}),
    ...(rep.status === 'ok' ? { last_ok_at: now } : {}),
  };
  if (hashes.content) { row.content_hash = hashes.content; if (prev?.content_hash !== hashes.content) row.content_changed_at = now; }
  if (hashes.slots) { row.slots_hash = hashes.slots; if (prev?.slots_hash !== hashes.slots) row.slots_changed_at = now; }
  const { error } = await supabase.from('offer_sources').upsert(row, { onConflict: 'key' });
  if (error) rep.notes.push(`offer_sources write failed: ${error.message}`);
}

// --- one adapter ------------------------------------------------------------------------
export async function runAdapter(
  a: OfferAdapter,
  opts: { mode: IngestMode; dryRun?: boolean; refreshImages?: boolean },
): Promise<AdapterReport> {
  const { result, requests } = await countRequests(() => runAdapterInner(a, opts));
  result.requests = requests;
  return result;
}

async function runAdapterInner(
  a: OfferAdapter,
  opts: { mode: IngestMode; dryRun?: boolean; refreshImages?: boolean },
): Promise<AdapterReport> {
  const t0 = Date.now();
  const rep: AdapterReport = {
    key: a.key, status: 'ok', mode: opts.mode, offerId: null, operatorId: null, slots: 0, bookable: 0, minPrice: null,
    images: null, contentChanged: null, slotsChanged: null, slotStore: 'none', retracted: 0, problems: [], notes: [], requests: 0, ms: 0,
  };
  let incomplete: string | null = null;
  const ctx = { note: (t: string) => rep.notes.push(t), incomplete: (r: string) => { incomplete = r; rep.notes.push(`incomplete: ${r}`); } };
  const today = new Date().toISOString().slice(0, 10);
  let offerId: string | null = null;
  const hashes: { content?: string; slots?: string } = {};
  try {
    const content = opts.mode === 'full' ? await withTimeout(a.fetchContent(ctx), ADAPTER_TIMEOUT_MS, `${a.key} content`) : null;
    if (content) {
      const p = contentProblem(content);
      if (p) throw new Error(`content rejected: ${p}`);
      if (content.kind !== a.kind) throw new Error(`content kind ${content.kind} != adapter kind ${a.kind}`);
    }
    let rawSlots: Slot[];
    try {
      rawSlots = await withTimeout(a.fetchSlots(ctx), ADAPTER_TIMEOUT_MS, `${a.key} slots`);
    } catch (e) {
      // slots-only runs fail hard; a full run still lists the offer (price on request) and keeps old slots
      if (!content) throw e;
      rep.slotError = e instanceof Error ? e.message : String(e);
      ctx.incomplete(`slots unavailable: ${rep.slotError}`);
      rawSlots = [];
    }
    const { ok: slots, problems } = checkSlots(rawSlots);
    rep.problems.push(...problems);
    rep.slots = slots.length;
    rep.bookable = slots.filter(s => isBookable(s.availability) && isAhead(a.kind, s, today)).length;
    const price = summarizePrice(a.kind, slots, today);
    rep.minPrice = price.raw;
    if (content) hashes.content = sha({ ...content, imageUrls: content.imageUrls.slice(0, 12) });
    hashes.slots = sha(slots.map(slotJson));

    if (opts.dryRun) {
      rep.status = 'dry_run';
      return rep;
    }

    const operatorId = await upsertOperator(a);
    rep.operatorId = operatorId;
    const listingId = SOURCE_PREFIX + a.key;
    const { data: existing, error: rErr } = await supabase
      .from('package_offers').select('id,images,pricing,rooms,itinerary_spots').eq('source_listing_id', listingId).maybeSingle();
    if (rErr) throw new Error(`package_offers read failed: ${rErr.message}`);
    if (!existing && !content) throw new Error('offer not ingested yet: run a full ingest first');
    offerId = (existing?.id as string | undefined) ?? null;

    const useTable = await slotTablesExist();
    rep.slotStore = useTable ? 'offer_slots' : 'pricing_jsonb';
    const prevSlots = ((existing?.pricing as { slots?: unknown[] } | null)?.slots ?? []) as Array<{ key: string }>;
    let known = prevSlots.length;
    if (useTable && offerId) {
      const { count, error: cErr } = await supabase.from('offer_slots')
        .select('id', { count: 'exact', head: true }).eq('package_offer_id', offerId).eq('active', true);
      if (cErr) throw new Error(`offer_slots count failed: ${cErr.message}`);
      known = count ?? 0;
    }
    // empty-result guard: an adapter that suddenly finds nothing must not wipe a stock of slots
    const guardTripped = slots.length === 0 && known >= EMPTY_GUARD;
    if (guardTripped) rep.notes.push(`empty result with ${known} known slots: kept the stock (EMPTY_GUARD)`);

    // the jsonb summary is all-or-nothing: keep the old one on a partial or empty delivery
    const keepSlots = guardTripped || (incomplete !== null && slots.length < prevSlots.length);
    const pricing = {
      raw: price.raw,
      currency: price.min?.currency ?? null,
      ...(price.min?.priceBasis === 'person' ? { per_person: price.min.price } : {}),
      slot_method: a.slotMethod,
      observed_at: new Date().toISOString(),
      slots: keepSlots ? prevSlots
        : slots.filter(s => isAhead(a.kind, s, today)).slice(0, PRICING_SLOT_CAP).map(slotJson),
      slots_total: keepSlots ? prevSlots.length : slots.length,
    };
    const priceCols = keepSlots ? {} : {
      pricing,
      price_unit: price.priceUnit,
      price_basis_note: price.note,
      price_pp_cabin: price.min ? Math.round(price.min.price!) : null,
      price_pp_cabin_currency: price.min?.currency ?? null,
      currency: price.min?.currency ?? null,
      price_from_eur: price.min && price.min.currency === 'EUR' && price.priceUnit === 'package' ? Math.round(price.min.price!) : null,
    };

    if (content) {
      const spots = await locateSpots(content, existing?.itinerary_spots);
      if (!spots.some(s => s.lat !== null)) rep.notes.push('no map pin: spot could not be geocoded');
      const row = { ...contentRow(a, content, operatorId, spots), ...priceCols, rooms: roomsWithPrices(content, slots, today) };
      const { data: up, error: upErr } = await supabase
        .from('package_offers').upsert(row, { onConflict: 'source_listing_id' }).select('id').single();
      if (upErr) throw new Error(`package_offers upsert failed: ${upErr.message}`);
      offerId = up.id as string;

      const before = (existing?.images as StoredImage[] | undefined) ?? [];
      if (before.length === 0 || opts.refreshImages) {
        const slug = slugify(content.title);
        const images = await curateAndStoreImages({
          candidateUrls: content.imageUrls,
          providerId: operatorId,
          slug,
          sourceUrl: content.sourceUrl,
          context: `${content.title} (${content.spot ?? content.region ?? ''}, ${content.country}). ${content.summary}`,
          pathPrefix: `packages/${content.kind}/${slug}-site-${a.key}`,
          brief: BRIEFS[content.kind],
          minSize: a.imageMinSize,
        });
        if (images.length === 0) rep.notes.push('no usable images found');
        // jsonb rejects \u0000 ("unsupported Unicode escape sequence"); strip it from every string in the image records
        const clean = JSON.parse(JSON.stringify(images, (_k, v) => typeof v === 'string' ? v.replace(/\u0000/g, '') : v)) as StoredImage[];
        const { error: iErr } = await supabase.from('package_offers').update({ images: clean }).eq('id', offerId);
        if (iErr) throw new Error(`images update failed: ${iErr.message}`);
        rep.images = images.length;
      } else {
        rep.images = before.length;
        rep.notes.push(`kept ${before.length} curated images (--refresh-images to replace)`);
      }
    } else if (!keepSlots) {
      const { error: pErr } = await supabase.from('package_offers').update(priceCols).eq('id', offerId!);
      if (pErr) throw new Error(`price update failed: ${pErr.message}`);
    }
    rep.offerId = offerId;

    if (useTable && slots.length > 0) {
      // table mode upserts whatever arrived; retraction only after a complete, non-empty delivery
      const { changed, retracted } = await writeSlotTable(offerId!, slots, incomplete === null && !guardTripped);
      rep.slotsChanged = changed > 0;
      rep.retracted = retracted;
    }
  } catch (e) {
    rep.status = e instanceof BlockedByHost || (e instanceof Error && e.cause instanceof BlockedByHost) ? 'blocked' : 'error';
    rep.error = e instanceof Error ? e.message : String(e);
  } finally {
    rep.ms = Date.now() - t0;
  }
  if (!opts.dryRun) await recordSource(a, offerId, rep, hashes);
  return rep;
}

// --- many adapters, a few in parallel (different hosts; per-host throttle lives in http.ts) --
export async function runAdapters(
  adapters: OfferAdapter[],
  opts: { mode: IngestMode; dryRun?: boolean; refreshImages?: boolean; parallel?: number },
): Promise<AdapterReport[]> {
  const queue = [...adapters];
  const out: AdapterReport[] = [];
  const worker = async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      const r = await runAdapter(a, opts);
      out.push(r);
      const flag = r.status === 'error' ? 'ERR ' : r.status === 'blocked' ? 'BLK ' : r.status === 'dry_run' ? 'DRY ' : 'ok  ';
      console.log(`${flag}${r.key.padEnd(34)} slots ${String(r.slots).padStart(3)} (bookable ${r.bookable})  ${r.minPrice ?? '-'}  ${r.requests} req  ${(r.ms / 1000).toFixed(1)}s${r.error ? `  ${r.error}` : ''}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.parallel ?? 4, adapters.length) }, worker));
  return out.sort((x, y) => x.key.localeCompare(y.key));
}
