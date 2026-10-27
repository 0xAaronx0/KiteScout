// ---------------------------------------------------------------------------
// Plausibility gate between adapter output and the DB (kiezdad `plausibel`):
// returns a reason string for anything that must not be written, else null.
// ---------------------------------------------------------------------------
import { AVAILABILITY, type OfferContent, type Slot } from './types.js';
import { internalNote, isPlayableVideoUrl } from '../lib/offer-text.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_CURRENCY = /^[A-Z]{3}$/;

export function contentProblem(c: OfferContent): string | null {
  if (!c.title || c.title.length < 4) return 'title missing';
  if (c.title.length > 160) return `title too long (${c.title.length})`;
  if (!c.summary || c.summary.length < 40) return 'summary missing or too short';
  if (!c.country) return 'country missing';
  try {
    const u = new URL(c.sourceUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'sourceUrl not http(s)';
  } catch { return 'sourceUrl invalid'; }
  if (c.durationDays !== null && (!Number.isInteger(c.durationDays) || c.durationDays < 1 || c.durationDays > 60)) {
    return `durationDays implausible (${c.durationDays})`;
  }
  if ((c.kind === 'tour' || c.kind === 'camp' || c.kind === 'experience') && c.durationDays === null) return `${c.kind} without durationDays`;
  if (c.spotCoords && !(Math.abs(c.spotCoords.lat) <= 90 && Math.abs(c.spotCoords.lng) <= 180)) return 'spotCoords out of range';
  if (c.heroVideoUrl !== null && !isPlayableVideoUrl(c.heroVideoUrl)) return `heroVideoUrl not a playable video file (${c.heroVideoUrl})`;
  // sourceText is ours (audits); every other text field is shown in the app
  const shown: Array<[string, string | null]> = [
    ['title', c.title], ['summary', c.summary], ['accommodation', c.accommodation], ['region', c.region],
    ...c.includedServices.map((t): [string, string] => ['includedServices', t]),
    ...c.optionalServices.map((t): [string, string] => ['optionalServices', t]),
    ...c.rooms.flatMap((r): Array<[string, string | null]> => [['rooms', r.name], ['rooms', r.description], ...r.features.map((f): [string, string] => ['rooms', f])]),
  ];
  for (const [field, text] of shown) {
    const note = internalNote(text);
    if (note) return `internal note in ${field} ("${note}")`;
  }
  return null;
}

export function slotProblem(s: Slot): string | null {
  if (!s.key) return 'slot key missing';
  if (!(AVAILABILITY as readonly string[]).includes(s.availability)) return `availability "${s.availability}" not in enum`;
  if (s.startDate !== null && !ISO_DATE.test(s.startDate)) return `startDate not ISO (${s.startDate})`;
  if (s.endDate !== null && !ISO_DATE.test(s.endDate)) return `endDate not ISO (${s.endDate})`;
  if (s.startDate && s.endDate && s.endDate < s.startDate) return `endDate before startDate (${s.startDate}..${s.endDate})`;
  if (s.price !== null) {
    if (!Number.isFinite(s.price) || s.price <= 0) return `price implausible (${s.price})`;
    if (!s.currency || !ISO_CURRENCY.test(s.currency)) return `price without ISO currency (${s.currency})`;
    if (!s.priceUnit) return 'price without priceUnit';
  }
  if (s.spotsLeft !== null && (!Number.isInteger(s.spotsLeft) || s.spotsLeft < 0)) return `spotsLeft implausible (${s.spotsLeft})`;
  if (s.priceValidUntil && !ISO_DATE.test(s.priceValidUntil)) return `priceValidUntil not ISO (${s.priceValidUntil})`;
  if (s.priceTotal !== undefined && s.priceTotal !== null && !(s.priceTotal > 0)) return `priceTotal implausible (${s.priceTotal})`;
  if (s.packageNights !== undefined && s.packageNights !== null && !(Number.isInteger(s.packageNights) && s.packageNights > 0 && s.packageNights <= 60)) return `packageNights implausible (${s.packageNights})`;
  if (s.minNights !== undefined && s.minNights !== null && !(Number.isInteger(s.minNights) && s.minNights > 0 && s.minNights <= 60)) return `minNights implausible (${s.minNights})`;
  return null;
}

/** Validate a whole slot list: drops bad slots (with reasons) and rejects duplicate keys. */
export function checkSlots(slots: Slot[]): { ok: Slot[]; problems: string[] } {
  const ok: Slot[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const s of slots) {
    const p = slotProblem(s);
    if (p) { problems.push(`${s.key}: ${p}`); continue; }
    if (seen.has(s.key)) { problems.push(`${s.key}: duplicate slot key`); continue; }
    seen.add(s.key);
    ok.push(s);
  }
  return { ok, problems };
}
