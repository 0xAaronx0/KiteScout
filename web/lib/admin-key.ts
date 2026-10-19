import { createHash, timingSafeEqual } from 'node:crypto';

// The one gate for every admin surface (/changes, /admin/media and their POST routes).
// Since 2026-10-19 the pages are no longer public read-only: without a valid key they
// render nothing from the DB (security audit: offer data, change queue and signed URLs
// from the private bucket were readable by anyone). Both sides are hashed first, so
// timingSafeEqual gets equal lengths and the comparison leaks neither length nor prefix.
export function isAdminKey(key: unknown): key is string {
  const secret = process.env.CHANGES_ADMIN_KEY;
  if (!secret || typeof key !== 'string' || key === '') return false;
  const a = createHash('sha256').update(key).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}
