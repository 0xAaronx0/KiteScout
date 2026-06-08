'use client';

import { useEffect, useState } from 'react';
import type { AvailabilityResult, ProviderResult } from '../lib/types';
import { loadAvailability, peekAvailability } from '../lib/availability';

interface Props {
  provider: ProviderResult;
  /** Only the top card renders the box — keeps the stack light. Data is usually
   *  prefetched by the deck, so this is an instant cache hit. */
  isTop: boolean;
}

/**
 * Availability — live data scraped from the provider's own website via web search
 * (`/api/availability`): open departure dates, price per person / cabin / whole
 * boat, and how many places the boat has. Reads from the shared availability
 * cache, which the deck prefetches for upcoming cards.
 */
export default function Availability({ provider, isTop }: Props) {
  // Initialise from the prefetch cache so prefetched cards render with no skeleton.
  const [data, setData] = useState<AvailabilityResult | null>(() => peekAvailability(provider) ?? null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isTop || !provider.website_url) return;
    const cached = peekAvailability(provider);
    if (cached) { setData(cached); return; }
    let cancelled = false;
    setLoading(true);
    loadAvailability(provider)
      .then(d => { if (!cancelled) setData(d); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isTop, provider]);

  // Non-top cards (behind in the stack) don't render the box at all.
  if (!isTop && !data) return null;

  const Header = ({ tag }: { tag: string }) => (
    <div className="flex items-baseline justify-between">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
        Availability
      </span>
      <span className="text-[10px] text-emerald-600/70">{tag}</span>
    </div>
  );

  /* ── Loading skeleton ── */
  if (loading && !data) {
    return (
      <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2.5 space-y-2">
        <Header tag="checking provider site…" />
        <div className="animate-pulse space-y-2">
          <div className="h-3 bg-emerald-200/70 rounded w-2/3" />
          <div className="h-3 bg-emerald-100 rounded w-1/2" />
          <div className="h-5 bg-emerald-100 rounded-full w-3/4" />
        </div>
      </div>
    );
  }

  /* ── Nothing found — point to the provider's site ── */
  if (data && !data.found) {
    return (
      <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 space-y-1">
        <Header tag="live" />
        <p className="text-xs text-slate-500">
          No public availability listed.{' '}
          {provider.website_url && (
            <a href={provider.website_url} target="_blank" rel="noopener noreferrer"
              className="text-emerald-700 font-medium hover:underline"
              onClick={e => e.stopPropagation()}>
              Check on the provider’s site →
            </a>
          )}
        </p>
      </div>
    );
  }

  if (!data) return null;

  const hasCapacity = data.places != null || data.cabins != null;
  const priceTiers: Array<[string, string]> = [
    ...(data.pricePerPerson ? [[`${data.pricePerPerson} / person`, 'font-semibold']] : []),
    ...(data.pricePerCabin ? [[`${data.pricePerCabin} / cabin`, 'font-medium']] : []),
    ...(data.priceWholeBoat ? [[`${data.priceWholeBoat} / whole boat`, 'font-medium']] : []),
  ] as Array<[string, string]>;

  /* ── Live availability ── */
  return (
    <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2.5 space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
          Availability
        </span>
        {data.sourceUrl ? (
          <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer"
            className="text-[10px] text-emerald-600/80 hover:underline"
            onClick={e => e.stopPropagation()}>
            live · source ↗
          </a>
        ) : (
          <span className="text-[10px] text-emerald-600/70">live</span>
        )}
      </div>

      {/* Capacity — places on the boat */}
      {hasCapacity && (
        <p className="text-xs text-emerald-900 font-medium">
          🛟 {[
            data.places != null ? `${data.places} places` : null,
            data.cabins != null ? `${data.cabins} cabins` : null,
          ].filter(Boolean).join(' · ')}
        </p>
      )}

      {/* Open departure dates */}
      {data.departures && data.departures.length > 0 && (
        <div className="space-y-1">
          {data.departures.map((d, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-emerald-900 min-w-0 truncate">📅 {d.dates}</span>
              <span className="flex items-center gap-1.5 shrink-0">
                {d.price && <span className="text-emerald-800 font-medium">{d.price}</span>}
                {d.spotsLeft != null && (
                  <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5 tabular-nums">
                    {d.spotsLeft} {d.spotsLeft === 1 ? 'spot' : 'spots'}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Price tiers */}
      {priceTiers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {priceTiers.map(([label, weight], i) => (
            <span key={i}
              className={`text-xs bg-white text-emerald-800 border border-emerald-200 rounded-full px-2.5 py-0.5 ${weight}`}>
              {label}
            </span>
          ))}
        </div>
      )}

      {/* Booking options when no explicit price tiers were found */}
      {priceTiers.length === 0 && data.bookingOptions && data.bookingOptions.length > 0 && (
        <p className="text-xs text-emerald-700">
          Bookable: {data.bookingOptions.join(' · ')}
        </p>
      )}
    </div>
  );
}
