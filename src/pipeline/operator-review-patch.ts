// Pure helpers for the package-operator review write (no network, no database): see extract-cruise-reviews.ts.
import { tripadvisorFields, tripadvisorListingUrl } from './tripadvisor-listing.js';
export type OperatorReviewResult = {
  operatorId: string; name: string | null; domain: string; country: string | null; listings: string[];
  found: number; links: Record<string, unknown>; notes: string[]; error?: string;
};

// Matches the dry run of 2026-10-30 showed to be wrong, whatever the verifier said: a Google place link without a
// place name (a bare map position) and a bstoked category page are no review page of this operator.
export function rejectedReviewSources(links: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (typeof links.google_url === 'string' && /\/maps\/place\/\/@/.test(links.google_url)) out.push('google');
  if (typeof links.bstoked_url === 'string' && /bstoked\.net\/listings\/type\//.test(links.bstoked_url)) out.push('bstoked');
  // Aaron 2026-10-31: a single review, an FAQ page or the home page is no Tripadvisor listing.
  if (typeof links.tripadvisor_url === 'string' && !tripadvisorListingUrl(links.tripadvisor_url)) out.push('tripadvisor');
  return out;
}
// Google is neither collected nor written (Aaron 2026-10-31, KCS#607 "607 b"): its columns stay out of every patch,
// so a stored google_url is kept and no Google number enters avg_rating.
export const SOURCE_COLUMNS: Record<string, string[]> = {
  tripadvisor: ['tripadvisor_url', 'tripadvisor_rating', 'tripadvisor_review_count'],
  bstoked: ['bstoked_url', 'bstoked_rating', 'bstoked_review_count'],
};
/** Mean of the Tripadvisor and bSTOKED ratings present (0-5), one decimal; Google never counts. */
export function averageRating(row: Record<string, unknown>): number | null {
  const ratings = [row.tripadvisor_rating, row.bstoked_rating]
    .map(v => (typeof v === 'number' ? v : v !== null && v !== undefined ? parseFloat(String(v)) : NaN))
    .filter(v => Number.isFinite(v) && v >= 0 && v <= 5);
  return ratings.length ? Math.round((ratings.reduce((sum, v) => sum + v, 0) / ratings.length) * 10) / 10 : null;
}
/** The provider patch for one dry-run result: guarded and skipped sources left out, avg over the kept ratings. */
export function operatorReviewPatch(result: OperatorReviewResult, skip: Set<string>, checkedAt: string): Record<string, unknown> {
  const drop = new Set([...rejectedReviewSources(result.links), 'google', ...['tripadvisor', 'bstoked'].filter(src => skip.has(`${result.domain}:${src}`))]);
  const patch: Record<string, unknown> = { reviews_checked_at: checkedAt };
  for (const [src, cols] of Object.entries(SOURCE_COLUMNS)) for (const col of cols) patch[col] = drop.has(src) ? null : (result.links[col] ?? null);
  if (!drop.has('tripadvisor')) Object.assign(patch, tripadvisorFields(patch.tripadvisor_url, patch.tripadvisor_rating, patch.tripadvisor_review_count));
  patch.avg_rating = averageRating(patch);
  const labels: Record<string, string> = { google: 'google', tripadvisor: 'tripadvisor', bstoked: 'bstoked' };
  const notes = result.notes.filter(note => ![...drop].some(src => note.toLowerCase().startsWith(labels[src])));
  patch.review_match_notes = notes.length ? notes.join(' | ') : null;
  return patch;
}

