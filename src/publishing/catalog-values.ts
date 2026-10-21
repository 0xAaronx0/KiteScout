// ---------------------------------------------------------------------------
// GEO P2b (MartinMarzi/KiteCruiseScout#267): the seven gate facts exactly as the KCS app derives them
// from one `app_package_cards` row. Port of KCS origin/main c596d41:
//   src/features/catalog/supabase.ts       mapOfferCardViewRow, buildOfferRecord, buildAvailableDates
//   src/features/catalog/catalog-loader.ts normalize (longDescription, destination, headlinePrice, operator)
//   src/features/publishing/offer-eligibility.server.ts  `values` mapping, PreviewFactsSchema, canonical()
// The valueHash in a manifest claim must equal the gate's hash of the same value, so any drift here
// shows up as `fact_changed` in the app. test/publishing/kcs-gate.test.ts runs the real KCS code on
// the same rows to catch that drift.
// ---------------------------------------------------------------------------
import { createHash } from 'node:crypto';

export const FIELDS = ['title', 'description', 'type', 'operator', 'location', 'price', 'departures'] as const;
export type Field = (typeof FIELDS)[number];
export const REQUIRED_FIELDS: Field[] = ['title', 'description', 'type', 'operator', 'location'];

/**
 * The `app_package_cards` columns the seven facts depend on. The view's provider_id is the synthetic offer id,
 * never an operator identity, but KCS only maps provider_name/provider_website_url when it is set.
 */
export const CARD_COLUMNS = [
  'offer_id', 'provider_id', 'title', 'slug', 'summary', 'package_type', 'country', 'countries', 'region', 'source_url',
  'operator_id', 'provider_name', 'provider_website_url', 'price_pp_cabin', 'price_from_eur',
  'price_pp_cabin_currency', 'currency', 'price_unit', 'price_basis_note', 'dates', 'updated_at',
] as const;
export type CardRow = Record<(typeof CARD_COLUMNS)[number], unknown>;

// --- gate canonicalization (verbatim port of offer-eligibility.server.ts canonical()) ----------------
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const sha256 = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');
export const publishingFactHash = (value: unknown): string => sha256(canonical(value));

/** valueHash of one claim: sha256(canonical({source, offerId, revision, field, value})), as the gate recomputes it. */
export function claimValueHash(offerId: string, revision: string, field: Field, value: unknown): string {
  return publishingFactHash({ source: 'package_offers', offerId, revision, field, value });
}

// --- zod-equivalent normalizers ------------------------------------------------------------------
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
/** z.string().trim().min(1).max(4000) */
const gateText = (v: unknown): string | null => {
  const s = str(v)?.trim();
  return s && s.length <= 4000 ? s : null;
};
/** KCS NullableUrlSchema: trim, '' or unparsable or non-http(s) -> null */
function nullableUrl(v: unknown): string | null {
  const s = str(v)?.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? s : null;
  } catch { return null; }
}
/** The gate's `publicUrl` refinement (https, no credentials/query/hash, public dotted host). */
export function isPublicUrl(v: unknown): v is string {
  if (typeof v !== 'string' || !URL.canParse(v)) return false;
  const url = new URL(v);
  const hostname = url.hostname.replace(/\.$/, '');
  return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
    && hostname.includes('.') && !/^[\d.]+$|:|\.(?:localhost|local|internal)$/.test(hostname);
}

// --- departures (port of buildAvailableDates, isPackage = true) ----------------------------------
// KCS formats with Intl in the server's local time zone; production (Vercel) runs in UTC, so we pin UTC.
const DAY_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const DAY_FMT_NO_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const UNAVAILABLE = new Set(['cancelled', 'canceled', 'closed', 'sold out', 'sold_out', 'unavailable', 'waitlist']);
const EN_DASH = '\u2013'; // KCS label separator; reproduced byte for byte

function parseDay(v: unknown): Date | undefined {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
function formatRange(start: Date, end?: Date): string {
  if (!end || start.getTime() === end.getTime()) return DAY_FMT.format(start);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  if (sameYear && start.getUTCMonth() === end.getUTCMonth())
    return `${DAY_FMT_NO_YEAR.format(start)}-${end.getUTCDate()}, ${end.getUTCFullYear()}`;
  if (sameYear) return `${DAY_FMT_NO_YEAR.format(start)}-${DAY_FMT.format(end)}`;
  return `${DAY_FMT.format(start)}-${DAY_FMT.format(end)}`;
}

export interface Departure { label: string; startDate: string; endDate: string | null; status: string; precision: string }

/** Departures as the app lists them on `now` (already-started departures are dropped, like KCS does). */
export function appDepartures(dates: unknown, now: Date): Departure[] {
  if (!Array.isArray(dates)) return [];
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const out = dates.flatMap((slot): Array<Departure & { t: number }> => {
    if (!slot || typeof slot !== 'object') return [];
    const s = slot as { status?: unknown; spots_left?: unknown; start_date?: unknown; end_date?: unknown; date_precision?: unknown };
    const spots = typeof s.spots_left === 'number' ? s.spots_left
      : typeof s.spots_left === 'string' && /^-?\d+$/.test(s.spots_left.trim()) ? Number(s.spots_left) : undefined;
    if ((typeof s.status === 'string' && UNAVAILABLE.has(s.status.trim().toLowerCase())) || (spots !== undefined && spots <= 0)) return [];
    const start = parseDay(s.start_date);
    const end = parseDay(s.end_date);
    if (!start || start.getTime() < today) return [];
    const status = typeof s.status === 'string' ? s.status.trim().toLowerCase() : '';
    const qualifier = status === 'on_request' || status === 'on request' ? 'On request; availability unconfirmed'
      : status === 'limited' ? 'Limited availability; confirmation required'
        : status !== 'available' ? 'Availability unknown' : undefined;
    return [{
      label: `${formatRange(start, end)}${qualifier ? ` ${EN_DASH} ${qualifier}` : ''}`,
      startDate: start.toISOString().slice(0, 10), endDate: end ? end.toISOString().slice(0, 10) : null, status,
      precision: typeof s.date_precision === 'string' ? s.date_precision : 'day',
      t: start.getTime(),
    }];
  }).sort((a, b) => a.t - b.t);
  return out.filter((d, i) => out.findIndex(o => o.label === d.label) === i).map(({ t: _t, ...d }) => d);
}

// --- the seven values --------------------------------------------------------------------------
const PRICE_UNITS = new Set(['package', 'per_night', 'per_day', 'other']);

export interface AppFacts {
  /** gate value per field; absent = no usable value (the app would report invalid_fact, or it stays unknown) */
  values: Partial<Record<Field, unknown>>;
  departures: Departure[];
  /** why a field has no usable value */
  invalid: Partial<Record<Field, string>>;
}

export function appFacts(row: CardRow, now: Date): AppFacts {
  const values: AppFacts['values'] = {};
  const invalid: AppFacts['invalid'] = {};
  const set = (field: Field, value: unknown, why: string): void => {
    if (value === undefined) invalid[field] = why; else values[field] = value;
  };

  set('title', gateText(row.title) ?? undefined, 'title empty or over 4000 chars');
  // catalog-loader: longDescription = row.summary ?? row.title
  set('description', gateText(str(row.summary) ?? str(row.title)) ?? undefined, 'summary empty or over 4000 chars');
  set('type', row.package_type === 'camp' ? 'camp' : undefined, `package_type is ${String(row.package_type)}, the gate only accepts camp`);

  const operatorId = str(row.operator_id);
  const name = gateText(row.provider_name);
  const website = nullableUrl(row.provider_website_url);
  set('operator', operatorId && /^[0-9a-f-]{36}$/i.test(operatorId) && name && isPublicUrl(website)
    ? { id: operatorId, name, website } : undefined,
  !website ? 'operator website missing' : !isPublicUrl(website) ? `operator website is not a clean public https URL: ${website}` : 'operator id or name missing');

  const countries = Array.isArray(row.countries) ? row.countries : [];
  const countryRaw = str(row.country) ?? (typeof countries[0] === 'string' ? countries[0] : null);
  const country = gateText(countryRaw);
  const destinationRaw = [str(row.region), countryRaw].filter(Boolean).join(', ') || null;
  const destination = destinationRaw === null ? null : gateText(destinationRaw);
  set('location', country && (destinationRaw === null || destination) ? { country, destination } : undefined, 'country missing');

  // headlinePrice (catalog-loader normalize, package branch) re-parsed by CatalogPriceSchema + publicUrl sourceUrl
  const sourceUrl = nullableUrl(row.source_url) ?? nullableUrl(row.provider_website_url);
  const amountRaw = row.price_pp_cabin ?? row.price_from_eur ?? null;
  const amount = typeof amountRaw === 'number' && Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : null;
  const currency = gateText(str(row.price_pp_cabin_currency) ?? str(row.currency));
  const unit = row.price_unit == null ? null : PRICE_UNITS.has(row.price_unit as string) ? row.price_unit as string : undefined;
  const note = str(row.price_basis_note) ?? '';
  const occupancyBasis = /\bper person\b|\bp\.p\./i.test(note) ? 'per_person'
    : /\bper room\b/i.test(note) ? 'per_room' : /\bper group\b/i.test(note) ? 'per_group' : null;
  const bstoked = sourceUrl ? new URL(sourceUrl).hostname.replace(/^www\./, '') === 'bstoked.net' : false;
  if (amount === null) invalid.price = 'no price amount on the row (price stays unknown)';
  else set('price', unit !== undefined && (sourceUrl === null || isPublicUrl(sourceUrl))
    ? { amount, currency, unit, occupancyBasis, basisNote: gateText(row.price_basis_note),
      source: bstoked ? 'bstoked' : 'provider_site', sourceUrl }
    : undefined, unit === undefined ? `unknown price_unit ${String(row.price_unit)}` : `price source URL is not a clean public https URL: ${sourceUrl}`);

  const departures = appDepartures(row.dates, now);
  if (departures.length === 0) invalid.departures = 'no upcoming departures on the row (dates stay unknown)';
  else values.departures = departures.map(d => d.label);

  return { values, departures, invalid };
}

/** Digest of the row columns the seven facts depend on: the snapshot must not move while we verify. */
export function rowDigest(row: CardRow): string {
  return publishingFactHash(Object.fromEntries(CARD_COLUMNS.map(c => [c, row[c] ?? null])));
}
