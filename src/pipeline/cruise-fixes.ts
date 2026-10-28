// ---------------------------------------------------------------------------
// Data fixes from the app/inventory audit 2026-10-27 (docs/app-inventar-report-2026-10-27.md, 4/5/9/11-13).
//
//   pnpm cli data-fixes plan [--out f.json]     read-only: prints every change as before -> after
//   pnpm cli data-fixes apply --from f.json     writes exactly the reviewed plan (drift-guarded)
//   pnpm cli data-fixes apply --from f.json --revert   rollback: writes every `before` back (same guard)
//
// Cruise rules (pure, tested in test/pipeline/cruise-fixes.test.ts):
//   dates      drop all-null rows and finished departures (the app already hides them; null when none left)
//   price      the 2026-07-10 backfill (src/_price-derive.ts, untracked) took the cheapest per-person option,
//              add-ons and upgrade surcharges included (gear rental, "upgrade, per couple" / 2, meal package),
//              and read per-night prices as trip prices -> re-derive without them
//   charter    the quoted week price (cruise-state charterWeek, Aaron 2026-10-28), not a x7/days re-scale
//   continent  from the country, else the one continent all countries share
//   region     drop parts repeating the country or the first spot ("Bahamas / Exumas" under Bahamas -> "Exumas";
//              the app prints country / region / first spot, deduped only as whole strings)
//   text       English season/title for rows the extraction left in German/French (hand-checked list)
// Package rows: the research notes and the YouTube hero the fixed adapters no longer produce.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync } from 'node:fs';
import { charterWeek, upcomingDepartures } from './cruise-state.js';
import { continentForOffer } from '../lib/continents.js';

// FX only to compare options (prices stay in their own currency, Aaron 2026-07-10); same table as cruise-state.
const FX_GATE: Record<string, number> = { EUR: 1, USD: 0.86, GBP: 1.17, AED: 0.23, CHF: 1.06, BRL: 0.16, ZAR: 0.05 };
const PP_RANGE: [number, number] = [200, 8000];

/** Option labels that are not the trip itself: extras, courses, upgrades and surcharges. */
export const ADDON_RE = /\b(?:rental|rent|course|lessons?|coaching|clinic|upgrade|supplement|surcharge|single|solo|transfers?|deposit|insurance|add-?on|extras?|gear|equipment|flights?|meals?)\b/i;
/** Per-night prices: no trip price unless the number of nights is printed with it. */
export const PER_NIGHT_RE = /(?:per|\/|pro|par|a)\s*(?:night|nacht|nuit)\b|\bnightly\b|\bpppn\b|\bpro\s+person\s*\/\s*nacht\b/i;

type Opt = { basis?: string; label?: string; price?: number | null; currency?: string | null };
export type Pricing = { raw?: string | null; currency?: string | null; options?: Opt[]; per_person?: number | null; whole_boat?: number | null } | null;
export interface PerPerson { price: number; currency: string; source: string }

const cur = (c: string | null | undefined, fallback: string | null | undefined): string | null => {
  const t = (c ?? fallback ?? 'EUR').toUpperCase();
  return FX_GATE[t] ? t : null;
};
const eur = (p: { price: number; currency: string }): number => p.price * FX_GATE[p.currency];
const plausible = (p: { price: number; currency: string }): boolean => eur(p) >= PP_RANGE[0] && eur(p) <= PP_RANGE[1];
const CHARTER_RANGE: [number, number] = [2000, 120000];

/** Trip length printed in an option label: "8 days / 7 nights" -> 8, "1 week" -> 7, "per day" -> 1. */
export function daysFromLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  const w = label.match(/(\d+)\s*weeks?\b/i);
  if (w) return Number(w[1]) * 7;
  const d = label.match(/(\d{1,2})\s*(?:days?|nights?|tage|nächte|jours?|nuits?)\b/i);
  if (d) return Number(d[1]);
  return /\b(?:per|a|\/)\s*day\b|\bpro tag\b|\bpar jour\b/i.test(label) ? 1 : null;
}

/** Cheapest quoted week charter among the whole-boat options (charterWeek rules), else pricing.whole_boat. */
export function deriveCharterWeek(pricing: Pricing, durationDays: number | null): PerPerson | null {
  let best: PerPerson | null = null;
  const consider = (p: PerPerson) => {
    const e = eur(p);
    if (e >= CHARTER_RANGE[0] && e <= CHARTER_RANGE[1] && (!best || e < eur(best))) best = p;
  };
  for (const o of pricing?.options ?? []) {
    if (o.basis !== 'whole_boat' || o.price == null) continue;
    const c = cur(o.currency, pricing?.currency);
    const days = daysFromLabel(o.label) ?? durationDays;
    const w = charterWeek(o.price, days);
    if (c && w !== null) consider({ price: w, currency: c, source: `whole-boat option "${o.label}"${days === 1 ? ' x7 (per day)' : ''}` });
  }
  if (!best && pricing?.whole_boat != null) {
    const c = cur(pricing.currency, null);
    const w = charterWeek(pricing.whole_boat, durationDays);
    if (c && w !== null) consider({ price: w, currency: c, source: 'pricing.whole_boat' });
  }
  return best;
}

/**
 * Cheapest per-person price for the whole trip from the extracted options: per_person as is, a cabin for two / 2,
 * never an add-on/upgrade/surcharge and never a per-night price. null when nothing qualifies.
 */
export function derivePerPerson(pricing: Pricing): PerPerson | null {
  let best: PerPerson | null = null;
  const consider = (p: PerPerson) => { if (plausible(p) && (!best || eur(p) < eur(best))) best = p; };
  for (const o of pricing?.options ?? []) {
    if (o.price == null || !o.label || ADDON_RE.test(o.label) || PER_NIGHT_RE.test(o.label)) continue;
    const c = cur(o.currency, pricing?.currency);
    if (!c) continue;
    if (o.basis === 'per_person') consider({ price: Math.round(o.price), currency: c, source: `option "${o.label}"` });
    else if (o.basis === 'per_cabin') consider({ price: Math.round(o.price / 2), currency: c, source: `cabin option "${o.label}" / 2 (double occupancy)` });
  }
  if (!best && pricing?.per_person != null && !PER_NIGHT_RE.test(pricing.raw ?? '')) {
    const c = cur(pricing.currency, null);
    if (c) consider({ price: Math.round(pricing.per_person), currency: c, source: 'pricing.per_person' });
  }
  return best;
}

export interface CruiseRow {
  id: string; slug: string; title: string; country: string | null; countries: string[] | null; region: string | null;
  continent: string | null; itinerary_spots: Array<{ name?: string | null }> | null; dates: unknown; pricing: Pricing; price_from_eur: number | null; currency: string | null;
  price_pp_cabin: number | null; price_pp_cabin_currency: string | null; price_basis_note: string | null; season_text: string | null;
  price_charter_week: number | null; price_charter_week_currency: string | null; duration_days: number | null;
}
export type FieldDiff = Record<string, { before: unknown; after: unknown }>;
export interface FixEntry { table: 'cruise_offers' | 'package_offers' | 'cruise_providers'; id: string; label: string; set: FieldDiff; why: string[] }

/** English season/title text for the rows the extraction left in German or French (checked by hand 2026-10-28). */
export const TEXT_FIXES: Record<string, Partial<Record<'title' | 'season_text', { from: string; to: string }>>> = {
  'f030d504-': { season_text: { from: 'juin, juillet, août et septembre', to: 'June, July, August and September' } },
  '058fb61c-': { season_text: { from: 'Semaines de juillet et août (du samedi au samedi)', to: 'Weekly in July and August (Saturday to Saturday)' } },
  '863c7f6d-': { season_text: { from: 'Hauptsaison', to: 'High season (January to March)' } },
  '0a96a3dc-': { season_text: { from: 'Nebensaison', to: 'Low season (November and December)' } },
  '6c89bfbb-': { season_text: { from: 'Nov 29 to Dez 13', to: 'Nov 29 to Dec 13' } },
  '9d187759-': { season_text: { from: 'Dez 13 to Dez 20', to: 'Dec 13 to Dec 20' } },
  '3a6d074e-': { season_text: { from: 'Dez 28 to Jan 06', to: 'Dec 28 to Jan 06' } },
  'be22d11b-': { season_text: { from: '2027, individuell ab Athen oder Paros', to: '2027, dates on request, from Athens or Paros' } },
  '7bf8639b-': {
    title: { from: 'Kitesafari nach Wunsch – Custom Red Sea Safari', to: 'Custom Red Sea Kite Safari' },
    season_text: { from: 'individuell, Hurghada, Ägypten', to: 'Dates on request, from Hurghada, Egypt' },
  },
  '8f74dd21-': { season_text: { from: 'individuell, Exumas - Grenadines - Kykladen', to: 'Dates on request: Exumas, Grenadines, Cyclades' } },
  'd23f135f-': {
    title: { from: 'Privatgruppe Kitesafari Red Sea (Custom Group)', to: 'Private Group Kite Safari, Red Sea' },
    season_text: { from: 'Letzter verfügbarer Termin', to: 'Last date offered' },
  },
  '5b82cbee-': { season_text: { from: 'Sa., 12. Sept. ab Hurghada', to: 'Sat 12 Sep, from Hurghada' } },
  'f02c2e45-': { season_text: { from: 'Sa., 24. Okt. ab El Gouna', to: 'Sat 24 Oct, from El Gouna' } },
  '180f877d-': {
    season_text: {
      from: 'Safaritermine 2026/27 – Die meisten Windtage gibt es zwischen Juni und Oktober. Auch Frühling und Herbst sind für starken Wind bekannt.',
      to: 'Safari dates 2026/27. Most wind days are between June and October; spring and autumn are also known for strong wind.',
    },
  },
};

/** Every fix for one cruise row; `set` is empty when the row is fine. */
export function planCruiseFix(o: CruiseRow, today: string): FixEntry {
  const set: FieldDiff = {};
  const why: string[] = [];
  const put = (field: keyof CruiseRow, after: unknown, reason: string) => {
    if (JSON.stringify(o[field] ?? null) === JSON.stringify(after ?? null)) return;
    set[field] = { before: o[field] ?? null, after };
    if (!why.includes(reason)) why.push(reason);
  };

  // dates
  const raw = Array.isArray(o.dates) ? o.dates : [];
  if (raw.length) {
    const next = upcomingDepartures(raw, today);
    if ((next?.length ?? 0) !== raw.length) {
      const past = raw.length - (next?.length ?? 0);
      put('dates', next, next ? `${past} finished/empty departure(s) dropped` : `only finished/empty departures (${raw.length}) -> none`);
    }
  }

  // price: an add-on or per-night option chosen as the trip price
  const chosen = o.price_basis_note?.match(/^pp: (?:cheapest per-person |cabin )?option "([^"]+)"/)?.[1] ?? null;
  const perNightRaw = PER_NIGHT_RE.test(o.pricing?.raw ?? '');
  let pp = o.price_pp_cabin !== null ? { price: o.price_pp_cabin, currency: o.price_pp_cabin_currency } : null;
  if (chosen && (ADDON_RE.test(chosen) || PER_NIGHT_RE.test(chosen))) {
    const d = derivePerPerson(o.pricing);
    pp = d ? { price: d.price, currency: d.currency } : null;
    const reason = `p.p. price came from "${chosen}" (${PER_NIGHT_RE.test(chosen) ? 'per night' : 'add-on/upgrade'})`;
    put('price_pp_cabin', d?.price ?? null, reason);
    put('price_pp_cabin_currency', d?.currency ?? null, reason);
    const rest = o.price_basis_note!.split(' | ').slice(1);
    // our note quotes provider labels; plain hyphens only in text we write (Aaron 2026-08-06)
    put('price_basis_note', [d ? `pp: ${d.source}` : `pp: none (was "${chosen}")`, ...rest].join(' | ').replace(/[–—]/g, '-'), reason);
  }
  // price_from_eur (the map's price): a per-night amount, or a per-night price next to an EUR trip price
  if (perNightRaw && o.price_from_eur !== null) {
    const nums = (o.pricing?.raw ?? '').match(/\d[\d.,]*/g)?.map(n => Number(n.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'))) ?? [];
    const optNight = (o.pricing?.options ?? []).some(x => x.price === o.price_from_eur && PER_NIGHT_RE.test(x.label ?? ''));
    if (optNight || nums.includes(o.price_from_eur)) {
      const after = pp && pp.currency === 'EUR' ? pp.price : null;
      put('price_from_eur', after, `price_from_eur ${o.price_from_eur} is a per-night price`);
    }
  }

  // charter: the quoted week price instead of a x7/days re-scale. Only rows whose note shows a re-scale: a x7/7 row
  // may carry a newer monitor read than its stored options (Kite Charters: options 15,200, live 16,000).
  const chNote = o.price_basis_note?.match(/charter\/wk: [^|]*/)?.[0] ?? '';
  const rescaled = /×7\/(?!7d)\d+d|no duration/.test(chNote);
  const override = Object.entries(PRICE_OVERRIDES).find(([k]) => o.id.startsWith(k))?.[1];
  if (override && o.price_pp_cabin === override.pp.from && o.price_charter_week === override.charter.from) {
    const reason = `cheapest option is ${override.evidence}`;
    put('price_pp_cabin', override.pp.to, reason);
    put('price_charter_week', override.charter.to, reason);
    put('price_basis_note', `pp: ${override.evidence} (quoted) | charter/wk: ${override.evidence} (quoted)`, reason);
  } else if (o.price_charter_week !== null && rescaled) {
    const d = deriveCharterWeek(o.pricing, o.duration_days);
    const ppEur = pp && FX_GATE[pp.currency ?? ''] ? pp.price * FX_GATE[pp.currency!] : null;
    if (d && (d.price !== o.price_charter_week || d.currency !== o.price_charter_week_currency) && !(ppEur && eur(d) < 1.5 * ppEur)) {
      const reason = `charter ${o.price_charter_week} ${o.price_charter_week_currency} was re-scaled; quoted week price ${d.price} ${d.currency}`;
      put('price_charter_week', d.price, reason);
      put('price_charter_week_currency', d.currency, reason);
      const note = (set.price_basis_note?.after as string | undefined) ?? o.price_basis_note ?? '';
      const parts = note.split(' | ').filter(x => x && !x.startsWith('charter/wk:'));
      put('price_basis_note', [...parts, `charter/wk: ${d.source} (quoted)`].join(' | ').replace(/[–—]/g, '-'), reason);
    }
  }

  // continent
  if (!o.continent) {
    const c = continentForOffer(o.country, o.countries);
    if (c) put('continent', c, 'continent from country');
  }

  // region parts repeating the country or the first spot ("Bahamas / Bahamas / Exumas / George Town" in the app)
  if (o.region) {
    const parts = o.region.split(/\s*\/\s*/).filter(Boolean);
    const spot = (o.itinerary_spots?.[0]?.name ?? '').split(/\s*\/\s*/);
    const taken = new Set([o.country, ...spot].filter((x): x is string => !!x).map(x => x.trim().toLowerCase()));
    const kept = parts.filter(x => !taken.has(x.toLowerCase()));
    if (kept.length && kept.length < parts.length) put('region', kept.join(' / '), 'region repeats the country or first spot');
  }

  // German/French text
  const tf = Object.entries(TEXT_FIXES).find(([k]) => o.id.startsWith(k))?.[1];
  for (const f of ['title', 'season_text'] as const) {
    const t = tf?.[f];
    if (t && o[f] === t.from) put(f, t.to, 'English text');
  }

  return { table: 'cruise_offers', id: o.id, label: `${o.slug} (${o.id.slice(0, 8)})`, set, why };
}

/** Hand-checked prices where the stored options miss the cheapest variant (stored raw + live read 2026-10-28). */
export const PRICE_OVERRIDES: Record<string, { pp: { from: number; to: number }; charter: { from: number; to: number }; evidence: string }> = {
  // CBCM: "PRO 2640€ / BASIC 2200€ per person (shared); whole boat PRO 21 650€ / BASIC 17 520€ - 7 nuits/8 jours"
  'f030d504-': { pp: { from: 2640, to: 2200 }, charter: { from: 18944, to: 17520 }, evidence: 'BASIC boat (EUR 2,200 p.p., EUR 17,520 whole boat per week)' },
  '058fb61c-': { pp: { from: 2640, to: 2200 }, charter: { from: 18944, to: 17520 }, evidence: 'BASIC boat (EUR 2,200 p.p., EUR 17,520 whole boat per week)' },
};

/** Providers Aaron decided to hide (status dead = filtered by the app view; /changes can restore). */
export const HIDE_PROVIDERS: Record<string, string> = {
  // Red Blues Kite-Surf Cruise: page still says "Price is valid till 31/12/2020", no newer dates (read 2026-10-28)
  'stankakristl-yachtcharter.at': 'price valid till 31/12/2020 on its own page, no newer dates',
};

export interface PackageRow { id: string; title: string; summary: string | null; accommodation: string | null; optional_services: string[] | null; hero_video_url: string | null }

/** Spanish package lines (Kitesurfexperience, Santa Veronica) -> what the fixed adapter writes now. */
export const SERVICE_FIXES: Array<[string, string]> = [
  ['promo pre temporada enero-abril 2027: 10h lessons + 5 dias Hotel - COP 2,850,000',
    'Pre-season promo January to April 2027: 10 h private IKO kite lessons with insurance + 4 nights / 5 days in a private bungalow (book by 30 October) - COP 2,850,000'],
  ['PROMO: 12 Horas clases + 6 Dias Hôtel - COP 3,250,000 per person',
    'Promo: 12 h private IKO kite lessons with insurance + 5 nights / 6 days in a private bungalow, breakfast included - COP 3,250,000 per person'],
];

/** Package text the fixed adapters now write (same edits, applied to the stored text). */
export function planPackageFix(p: PackageRow): FixEntry {
  const set: FieldDiff = {};
  const why: string[] = [];
  const put = (field: keyof PackageRow, after: unknown, reason: string) => {
    if (JSON.stringify(p[field] ?? null) === JSON.stringify(after ?? null)) return;
    set[field] = { before: p[field] ?? null, after };
    why.push(reason);
  };
  if (p.hero_video_url && /(^|\.)(youtube\.com|youtu\.be|vimeo\.com)\//i.test(p.hero_video_url.replace(/^https?:\/\//, ''))) {
    put('hero_video_url', null, 'hero video is a YouTube/Vimeo page, not a playable file');
  }
  if (p.accommodation === 'accommodation included (the page does not describe it)') {
    put('accommodation', '2 nights of accommodation included', 'research note in accommodation');
  }
  if (p.summary) {
    const s = p.summary
      .replace(/; the safari page does not state the length, the home page lists it as (\d+ days(?: \/ \d+ nights)?)\./, '; the safari runs $1.')
      .replace(/ The page does not name the beach; the map pin near San Juanico is approximate\./, '')
      .replace(/; no kite school or rental is named on the site\./, '.');
    put('summary', s, 'research note in summary');
  }
  if (p.optional_services?.length) {
    const next = p.optional_services.map(x => {
      const en = SERVICE_FIXES.find(([prefix]) => x.startsWith(prefix));
      return en ? en[1] : x.replace(' (no kite school or rental named on the site)', '');
    });
    put('optional_services', next, 'research note or Spanish text in optional services');
  }
  return { table: 'package_offers', id: p.id, label: `${p.title} (${p.id.slice(0, 8)})`, set, why };
}

// --- runner ---------------------------------------------------------------------------------

const CRUISE_COLS = 'id, slug, title, country, countries, region, continent, itinerary_spots, dates, pricing, price_from_eur, currency, price_pp_cabin, price_pp_cabin_currency, price_basis_note, season_text, price_charter_week, price_charter_week_currency, duration_days';
const PACKAGE_COLS = 'id, title, summary, accommodation, optional_services, hero_video_url';

const show = (v: unknown): string => {
  const s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v ?? null);
  return s.length > 220 ? `${s.slice(0, 217)}...` : s;
};

async function planProviderHides(supabase: typeof import('../lib/supabase.js').supabase, today: string): Promise<FixEntry[]> {
  const domains = Object.keys(HIDE_PROVIDERS);
  const { data, error } = await supabase.from('cruise_providers').select('id, name, root_domain, status, notes').in('root_domain', domains);
  if (error) throw new Error(`cruise_providers read failed: ${error.message}`);
  return (data ?? []).filter(p => p.status !== 'dead').map(p => {
    const stamp = `${today}: hidden on Aaron's word (${HIDE_PROVIDERS[p.root_domain as string]}). Restore: status back to "${p.status ?? 'new'}".`;
    return {
      table: 'cruise_providers' as const, id: p.id as string, label: `${p.name} (${p.root_domain})`, why: ['hidden on Aaron\'s word'],
      set: { status: { before: p.status ?? null, after: 'dead' }, notes: { before: p.notes ?? null, after: [p.notes, stamp].filter(Boolean).join('\n') } },
    };
  });
}

export async function planDataFixes(opts: { out?: string; today?: string }): Promise<FixEntry[]> {
  const { supabase } = await import('../lib/supabase.js');
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  // Only rows the app shows (the view applies the provider/reseller filters).
  const { data: visible, error: vErr } = await supabase.from('app_cruise_offer_cards').select('offer_id');
  if (vErr) throw new Error(`app_cruise_offer_cards read failed: ${vErr.message}`);
  const ids = new Set((visible ?? []).map(r => r.offer_id as string));
  const { data: cruises, error: cErr } = await supabase.from('cruise_offers').select(CRUISE_COLS);
  if (cErr) throw new Error(`cruise_offers read failed: ${cErr.message}`);
  const { data: pkgs, error: pErr } = await supabase.from('package_offers').select(PACKAGE_COLS).eq('is_active', true);
  if (pErr) throw new Error(`package_offers read failed: ${pErr.message}`);

  const plan = [
    ...(cruises as unknown as CruiseRow[]).filter(o => ids.has(o.id)).map(o => planCruiseFix(o, today)),
    ...(pkgs as unknown as PackageRow[]).map(planPackageFix),
    ...await planProviderHides(supabase, today),
  ].filter(e => Object.keys(e.set).length > 0);

  const byWhy = new Map<string, number>();
  for (const e of plan) for (const w of e.why) { const k = w.replace(/\d+|"[^"]*"/g, '#'); byWhy.set(k, (byWhy.get(k) ?? 0) + 1); }
  console.log(`DRY RUN ${today}: ${plan.length} row(s) would change (${ids.size} visible cruises, ${pkgs?.length ?? 0} active packages read)`);
  for (const [k, n] of [...byWhy].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);
  for (const e of plan) {
    console.log(`\n${e.table} ${e.label}  [${e.why.join('; ')}]`);
    for (const [f, d] of Object.entries(e.set)) console.log(`  ${f}: ${show(d.before)}\n  ${' '.repeat(f.length)}  -> ${show(d.after)}`);
  }
  if (opts.out) { writeFileSync(opts.out, JSON.stringify({ today, plan }, null, 1)); console.log(`\nplan written to ${opts.out}`); }
  return plan;
}

/** Swap before/after: the plan that undoes `plan`. */
export function revertPlan(plan: FixEntry[]): FixEntry[] {
  return plan.map(e => ({ ...e, set: Object.fromEntries(Object.entries(e.set).map(([f, d]) => [f, { before: d.after, after: d.before }])) }));
}

/** Write a reviewed plan (or undo it). A row whose current value no longer equals `before` is skipped (drift). */
export async function applyDataFixes(from: string, opts: { revert?: boolean } = {}): Promise<void> {
  const { supabase } = await import('../lib/supabase.js');
  const read = (JSON.parse(readFileSync(from, 'utf8')) as { plan: FixEntry[] }).plan;
  const plan = opts.revert ? revertPlan(read) : read;
  let ok = 0, drift = 0, failed = 0;
  for (const e of plan) {
    const fields = Object.keys(e.set);
    const { data: live, error } = await supabase.from(e.table).select(fields.join(', ')).eq('id', e.id).single();
    if (error || !live) { console.error(`  ${e.label}: read failed (${error?.message ?? 'gone'})`); failed++; continue; }
    const changed = fields.filter(f => JSON.stringify((live as unknown as Record<string, unknown>)[f] ?? null) !== JSON.stringify(e.set[f].before ?? null));
    if (changed.length) { console.log(`  drift, skipped: ${e.label} (${changed.join(', ')})`); drift++; continue; }
    const patch = Object.fromEntries(fields.map(f => [f, e.set[f].after]));
    const { error: upErr } = await supabase.from(e.table).update(patch).eq('id', e.id);
    if (upErr) { console.error(`  ${e.label}: update failed (${upErr.message})`); failed++; continue; }
    ok++;
  }
  console.log(`applied ${ok}, drift-skipped ${drift}, failed ${failed} (of ${plan.length})`);
}
