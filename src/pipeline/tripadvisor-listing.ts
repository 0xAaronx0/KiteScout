// Tripadvisor review links (Aaron "TA-Fix ja", 2026-10-31). Only a listing's main page shows its overall rating next
// to its total review count. The 2026-10-30 operator run stored values read from "-orNN" review subpages (where the
// verifier can pick one review's bubbles), single reviews (ShowUserReviews), an FAQ answer page and the bare home page.
const HOST = /^(?:[a-z]{2,3}\.)?tripadvisor\.(?:com|co|[a-z]{2})(?:\.[a-z]{2})?$/i;
const LISTING = /^\/((?:Hotel|Attraction|Restaurant|VacationRental)_Review-g\d+-d\d+-Reviews-|AttractionProductReview-g\d+-d\d+-)(?:or\d+-)?([^/]+\.html)$/;

/** The listing's main page for a Tripadvisor URL ("-orNN" subpages fold back onto it), or null for anything else. */
export function tripadvisorListingUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const m = parsed.pathname.match(LISTING);
  return /^https?:$/.test(parsed.protocol) && HOST.test(parsed.hostname) && m ? `https://${parsed.hostname}/${m[1]}${m[2]}` : null;
}

/** What may be stored for one Tripadvisor match: the main-page link, and its rating only when it was read from the
 *  main page together with its review count. In doubt the numbers are null, never a guess. */
export function tripadvisorFields(url: unknown, rating: unknown, count: unknown) {
  const main = tripadvisorListingUrl(url);
  const fromMain = main !== null && !/-or\d+-/.test(String(url));
  const ok = fromMain && typeof rating === 'number' && rating >= 1 && rating <= 5 && typeof count === 'number' && count >= 1;
  return { tripadvisor_url: main, tripadvisor_rating: ok ? rating : null, tripadvisor_review_count: ok ? count : null };
}
