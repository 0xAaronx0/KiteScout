// ---------------------------------------------------------------------------
// Cabin / room types for cruises → cruise_offers.rooms (Aaron, 2026-09-29).
//
// Same `rooms` shape as package_offers (see migration 20260930120000). Sources:
//   1. bstoked: when a provider's bstoked listing matches exactly one of its
//      offers (same country, best title match), that listing's cabins with 12
//      monthly price samples. Their photos become offer_media_candidates with
//      note "cabin: <name>" for /admin/media; the curated `images` are never
//      touched here (apply writes the caption once a cabin photo is selected).
//   2. Claude: every other offer, from its own text (source_text, accommodation,
//      pricing options). Only cabin types the text names; prices only when the
//      text ties them to that cabin type.
//
//   pnpm cli cruise-rooms --dry-run [--out file.json] [--offer <id>]   # no writes
//   pnpm cli cruise-rooms --from reviewed.json [--offer <id>]          # write a reviewed dry run
//   pnpm cli cruise-rooms --dry-run --bstoked-only --out file.json      # bstoked matches only (no Claude)
// ---------------------------------------------------------------------------
import pLimit from 'p-limit';
import { supabase } from '../lib/supabase.js';
import { anthropic } from '../lib/anthropic.js';
import { scrapeBstokedListing, type Room, type RoomPriceUnit } from './bstoked-packages.js';

const CABIN_MODEL = 'claude-opus-5-5';
const CONCURRENCY = 4;

// A whole-boat charter is a booking mode (price_charter_week), not a cabin type.
const CHARTER_RE = /\b(private|whole|entire|exclusive|full)\s+(charter|boat|yacht|catamaran|(kite\s+)?cruise)\b|\bcharter\b/i;

interface OfferRow {
  id: string;
  title: string;
  country: string | null;
  vessel_name: string | null;
  cabin_count: number | null;
  accommodation: string | null;
  pricing: unknown;
  source_text: string | null;
  price_pp_cabin: number | null;
  price_charter_week: number | null;
  bstoked_url: string | null;
}

export interface CabinResult {
  offer_id: string;
  title: string;
  source: 'bstoked' | 'text' | 'none';
  rooms: Room[];
  /** bstoked cabin photos to queue as media candidates */
  photos: { url: string; cabin: string }[];
  note?: string;
}

async function loadOffers(onlyId?: string): Promise<OfferRow[]> {
  // The app view decides which offers are live (no resellers / dead / duplicates).
  let q = supabase.from('app_cruise_offer_cards').select('offer_id, provider_bstoked_url');
  if (onlyId) q = q.eq('offer_id', onlyId);
  const { data: cards, error } = await q;
  if (error) throw new Error(`app_cruise_offer_cards read failed: ${error.message}`);
  const bstoked = new Map((cards ?? []).map(c => [c.offer_id as string, (c.provider_bstoked_url as string | null) ?? null]));

  const { data: offers, error: oErr } = await supabase
    .from('cruise_offers')
    .select('id, title, country, vessel_name, cabin_count, accommodation, pricing, source_text, price_pp_cabin, price_charter_week')
    .in('id', [...bstoked.keys()]);
  if (oErr) throw new Error(`cruise_offers read failed: ${oErr.message}`);
  return (offers ?? []).map(o => ({ ...(o as Omit<OfferRow, 'bstoked_url'>), bstoked_url: bstoked.get(o.id as string) ?? null }));
}

// ---------------------------------------------------------------------------
// 1. bstoked: listing → the one matching offer
// ---------------------------------------------------------------------------
const STOP = new Set(['kite', 'kitesurf', 'kitesurfing', 'cruise', 'cruises', 'and', 'the', 'day', 'days', 'safari', 'trip', 'with', 'wing', 'wingfoil', 'sail', '&', '-']);
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9äöüéèáíóúç ]+/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w)));
function titleScore(a: string, b: string): number {
  const A = words(a), B = words(b);
  const inter = [...A].filter(w => B.has(w)).length;
  return inter / Math.max(1, new Set([...A, ...B]).size);
}

async function bstokedCabins(offers: OfferRow[]): Promise<Map<string, CabinResult>> {
  const out = new Map<string, CabinResult>();
  const byUrl = new Map<string, OfferRow[]>();
  for (const o of offers) if (o.bstoked_url?.includes('/listings/')) (byUrl.get(o.bstoked_url) ?? byUrl.set(o.bstoked_url, []).get(o.bstoked_url)!).push(o);

  for (const [url, group] of byUrl) {
    const path = new URL(url).pathname;
    let listing;
    try {
      listing = await scrapeBstokedListing(path);
    } catch (err) {
      console.warn(`  bstoked ${path}: ${(err as Error).message}`);
      continue;
    }
    // bstoked files some trips under a region as country ("Bahamas, Caribbean" → country Caribbean)
    const places = [listing.country, listing.region].filter(Boolean).map(x => x!.toLowerCase());
    let sameCountry = group.filter(o => places.includes((o.country ?? '').toLowerCase()));
    if (!sameCountry.length && group.length === 1) sameCountry = group; // the provider's only offer
    const ranked = sameCountry
      .map(o => ({ o, s: titleScore(o.title, listing.title) }))
      .sort((a, b) => b.s - a.s);
    const best = ranked[0];
    // A near-tie is a guess ("Luxury Egypt Kite Cruise" once went to the provider's beginner
    // trip by 0.17 vs 0.14): require a clear lead, else fall back to the offer's own text.
    const unique = best && (ranked.length === 1 || best.s >= 2 * ranked[1].s);
    if (!best || !unique) {
      console.log(`  bstoked ${path} ("${listing.title}", ${listing.country}): ${sameCountry.length ? 'ambiguous' : 'no'} offer match among ${group.length} → text extraction`);
      continue;
    }
    const rooms = listing.rooms.filter(r => !CHARTER_RE.test(r.name));
    if (!rooms.length) continue;
    // Price source rule (Aaron 2026-09-30): the provider's own site, monitored daily, sets the
    // price. bstoked contributes cabin names + photos; its prices only where the site has none.
    const siteHasPrice = best.o.price_pp_cabin !== null || best.o.price_charter_week !== null;
    out.set(best.o.id, {
      offer_id: best.o.id,
      title: best.o.title,
      source: 'bstoked',
      rooms: rooms.map(({ photo_url: _p, ...r }) => (siteHasPrice
        ? { ...r, price_from: null, price_currency: null, price_unit: null, priced_months: [], price_source: null, image_sort: null }
        : { ...r, price_source: r.price_from !== null ? 'bstoked' as const : null, image_sort: null })),
      photos: rooms.filter(r => r.photo_url).map(r => ({ url: r.photo_url!, cabin: r.name })),
      note: `bstoked ${path}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Claude: cabin types from the offer's own text
// ---------------------------------------------------------------------------
const CABIN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rooms'],
  properties: {
    rooms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'price_from', 'price_currency', 'price_unit', 'evidence'],
        properties: {
          name: { type: 'string' },
          description: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          price_from: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          price_currency: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          price_unit: { anyOf: [{ type: 'string', enum: ['package', 'per_cabin', 'per_night', 'per_day', 'other'] }, { type: 'null' }] },
          evidence: { type: 'string' },
        },
      },
    },
  },
} as const;

const SYSTEM = `You extract the cabin types of one kite cruise offer from its source material.

A cabin type is an accommodation unit a guest can choose on this cruise (e.g. "Double cabin", "Master cabin with ensuite", "Seaview Cabin - Upper Deck", "Jacuzzi Suite"). Rules:
- Only list cabin types the material explicitly names or clearly distinguishes. Never invent types. If it only speaks of "cabins" generically, or of one standard cabin, return an empty list.
- A whole-boat / private charter is a booking mode, not a cabin type: leave it out. Different trip lengths or dates of the same cabin are not different cabin types.
- name: short, in English (translate if the material is in another language), e.g. "Single cabin", not "Einzelkabine".
- description: one short English sentence based on the material (beds, bathroom, deck, view), else null.
- price_from: only when the material states a price for that cabin type; the lowest one, as an integer in the currency written (never convert). Else null, and then price_currency and price_unit are null too.
- price_unit: "package" = per person for the whole trip; "per_cabin" = per cabin for the whole trip; "per_night" / "per_day" per person; "other" if unclear.
- evidence: a short verbatim quote (max 25 words) from the material that names this cabin type.`;

async function textCabins(o: OfferRow): Promise<CabinResult> {
  const material = [
    `Offer: ${o.title}`,
    o.vessel_name ? `Vessel: ${o.vessel_name}` : '',
    o.cabin_count ? `Cabin count: ${o.cabin_count}` : '',
    o.accommodation ? `Accommodation (structured): ${o.accommodation}` : '',
    o.pricing ? `Pricing (structured): ${JSON.stringify(o.pricing)}` : '',
    `Source text:\n${o.source_text ?? ''}`,
  ].filter(Boolean).join('\n\n');

  // SDK 0.39 predates output_config in its types; the API accepts it on messages.create.
  const res = await anthropic.messages.create({
    model: CABIN_MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: 'user', content: material }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: CABIN_SCHEMA } },
  } as unknown as Parameters<typeof anthropic.messages.create>[0]) as unknown as {
    stop_reason: string;
    content: { type: string; text?: string }[];
  };
  if (res.stop_reason === 'refusal') return { offer_id: o.id, title: o.title, source: 'none', rooms: [], photos: [], note: 'refusal' };
  const text = res.content.find(b => b.type === 'text')?.text ?? '{"rooms":[]}';
  const parsed = JSON.parse(text) as { rooms: { name: string; description: string | null; price_from: number | null; price_currency: string | null; price_unit: RoomPriceUnit | null; evidence: string }[] };
  const rooms: Room[] = parsed.rooms
    .filter(r => r.name.trim() && !CHARTER_RE.test(r.name))
    .map(r => ({
      name: r.name.trim(),
      description: r.description,
      features: [],
      price_from: r.price_from && r.price_from > 0 ? r.price_from : null,
      price_currency: r.price_from ? r.price_currency : null,
      price_unit: r.price_from ? r.price_unit : null,
      price_source: r.price_from ? 'provider_site' as const : null,
      priced_months: [],
      image_sort: null,
    }))
    .sort((a, b) => (a.price_from ?? Infinity) - (b.price_from ?? Infinity));
  return {
    offer_id: o.id,
    title: o.title,
    source: rooms.length ? 'text' : 'none',
    rooms,
    photos: [],
    note: parsed.rooms.map(r => `${r.name}: "${r.evidence}"`).join(' | ') || undefined,
  };
}

// ---------------------------------------------------------------------------
// run: dry-run returns the results; otherwise writes rooms + queues cabin photos
// ---------------------------------------------------------------------------
export async function runCruiseRooms(opts: {
  dryRun: boolean;
  offerId?: string;
  /** write a reviewed dry-run result instead of extracting again */
  from?: CabinResult[];
  /** only the bstoked matches (no Claude calls) */
  bstokedOnly?: boolean;
}): Promise<CabinResult[]> {
  if (!opts.dryRun) {
    const probe = await supabase.from('cruise_offers').select('rooms').limit(1);
    if (probe.error) throw new Error('cruise_offers.rooms missing: apply migration 20260930120000 first');
  }
  let results: CabinResult[];
  if (opts.from) {
    results = opts.from.filter(r => !opts.offerId || r.offer_id === opts.offerId);
  } else {
    const offers = await loadOffers(opts.offerId);
    console.log(`${offers.length} live cruise offer(s)`);
    const fromBstoked = await bstokedCabins(offers);
    if (opts.bstokedOnly) return [...fromBstoked.values()];
    results = await extractAll(offers, fromBstoked);
  }
  await writeResults(results, opts.dryRun);
  const n = (s: CabinResult['source']) => results.filter(r => r.source === s).length;
  console.log(`cabins: ${n('bstoked')} from bstoked, ${n('text')} from text, ${n('none')} without distinct cabin types`);
  return results;
}

async function extractAll(offers: OfferRow[], fromBstoked: Map<string, CabinResult>): Promise<CabinResult[]> {
  const limit = pLimit(CONCURRENCY);
  return Promise.all(offers.map(o => limit(async () => {
    if (fromBstoked.has(o.id)) return fromBstoked.get(o.id)!;
    try {
      return await textCabins(o);
    } catch (err) {
      console.warn(`  ${o.title}: extraction failed (${(err as Error).message})`);
      return { offer_id: o.id, title: o.title, source: 'none' as const, rooms: [], photos: [], note: 'error' };
    }
  })));
}

async function writeResults(results: CabinResult[], dryRun: boolean): Promise<void> {
  if (!dryRun) {
    for (const r of results) {
      if (!r.rooms.length) continue;
      // keep the cabin → photo links that /admin/media apply already made
      const { data: cur } = await supabase.from('cruise_offers').select('rooms').eq('id', r.offer_id).single();
      const linked = new Map(((cur?.rooms as Room[] | null) ?? []).map(rm => [rm.name, rm.image_sort]));
      const rooms = r.rooms.map(rm => ({ ...rm, image_sort: linked.get(rm.name) ?? null }));
      const { error } = await supabase.from('cruise_offers').update({ rooms }).eq('id', r.offer_id);
      if (error) { console.error(`  ✗ ${r.title}: ${error.message}`); continue; }
      if (r.photos.length) {
        const { error: cErr } = await supabase.from('offer_media_candidates').upsert(
          r.photos.map(p => ({ cruise_offer_id: r.offer_id, kind: 'image', url: p.url, origin: r.note?.replace('bstoked ', 'https://bstoked.net') ?? null, note: `cabin: ${p.cabin}`, status: 'candidate' })),
          { onConflict: 'cruise_offer_id,url', ignoreDuplicates: true },
        );
        if (cErr) console.error(`  ✗ ${r.title} cabin photos: ${cErr.message}`);
      }
    }
  }
}
