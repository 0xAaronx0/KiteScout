import type { AvailabilityResult, ProviderResult } from './types';

// Shared client-side cache for live availability so we can prefetch upcoming
// cards: the slow Tavily + Claude round-trip happens ahead of time, and once a
// result is resolved the card renders it instantly (no skeleton). The API route
// also caches server-side, so this mostly serves warm responses.

const NOT_FOUND: AvailabilityResult = { found: false };

const resolved = new Map<string, AvailabilityResult>();
const inflight = new Map<string, Promise<AvailabilityResult>>();

function keyFor(provider: ProviderResult): { domain: string; location: string; cacheKey: string } | null {
  if (!provider.website_url) return null;
  let domain: string;
  try { domain = new URL(provider.website_url).hostname.replace(/^www\./, ''); } catch { return null; }
  const location = provider.matchedLocations?.[0]
    ?? [provider.primary_region, provider.primary_country].filter(Boolean).join(', ');
  return { domain, location, cacheKey: `${domain}|${location}` };
}

/** Synchronously read an already-resolved result, if present. */
export function peekAvailability(provider: ProviderResult): AvailabilityResult | undefined {
  const k = keyFor(provider);
  return k ? resolved.get(k.cacheKey) : undefined;
}

/**
 * Load availability for a provider, deduplicating concurrent/repeat requests.
 * Safe to call for prefetching upcoming cards — the result is memoised so the
 * card's own load is an instant cache hit.
 */
export function loadAvailability(provider: ProviderResult): Promise<AvailabilityResult> {
  const k = keyFor(provider);
  if (!k) return Promise.resolve(NOT_FOUND);
  if (resolved.has(k.cacheKey)) return Promise.resolve(resolved.get(k.cacheKey)!);

  let p = inflight.get(k.cacheKey);
  if (!p) {
    const url = `/api/availability?domain=${encodeURIComponent(k.domain)}&location=${encodeURIComponent(k.location)}`;
    p = fetch(url)
      .then(r => r.json() as Promise<AvailabilityResult>)
      .catch(() => NOT_FOUND)
      .then(result => {
        resolved.set(k.cacheKey, result);
        inflight.delete(k.cacheKey);
        return result;
      });
    inflight.set(k.cacheKey, p);
  }
  return p;
}

/** Warm the cache for a list of providers (e.g. the next few cards). */
export function prefetchAvailability(providers: ProviderResult[]): void {
  for (const p of providers) loadAvailability(p);
}
