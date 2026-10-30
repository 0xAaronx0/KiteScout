// Pure helpers for the package-operator review write (no network, no database): see extract-cruise-reviews.ts.
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
  return out;
}
export const SOURCE_COLUMNS: Record<string, string[]> = {
  google: ['google_url', 'google_rating', 'google_review_count'],
  tripadvisor: ['tripadvisor_url', 'tripadvisor_rating', 'tripadvisor_review_count'],
  bstoked: ['bstoked_url', 'bstoked_rating', 'bstoked_review_count'],
};
/** The provider patch for one dry-run result: guarded and skipped sources left out, avg over the kept ratings. */
export function operatorReviewPatch(result: OperatorReviewResult, skip: Set<string>, checkedAt: string): Record<string, unknown> {
  const drop = new Set([...rejectedReviewSources(result.links), ...['google', 'tripadvisor', 'bstoked'].filter(src => skip.has(`${result.domain}:${src}`))]);
  const patch: Record<string, unknown> = { reviews_checked_at: checkedAt };
  for (const [src, cols] of Object.entries(SOURCE_COLUMNS)) for (const col of cols) patch[col] = drop.has(src) ? null : (result.links[col] ?? null);
  const ratings = ['google_rating', 'tripadvisor_rating', 'bstoked_rating'].map(col => patch[col])
    .filter((v): v is number => typeof v === 'number' && v >= 0 && v <= 5);
  patch.avg_rating = ratings.length ? Math.round((ratings.reduce((sum, v) => sum + v, 0) / ratings.length) * 10) / 10 : null;
  const labels: Record<string, string> = { google: 'google', tripadvisor: 'tripadvisor', bstoked: 'bstoked' };
  const notes = result.notes.filter(note => ![...drop].some(src => note.toLowerCase().startsWith(labels[src])));
  patch.review_match_notes = notes.length ? notes.join(' | ') : null;
  return patch;
}

