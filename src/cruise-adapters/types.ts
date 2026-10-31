// ---------------------------------------------------------------------------
// Cruise adapters: deterministic readers for the providers whose pages change
// most (audit 2026-10-12: top 10 providers = half of all monitor changes).
// Same model as src/offers (kiezdad pattern): polite fetch (src/offers/http.ts,
// honest UA, robots.txt, throttle, never bypass a block), pure parsers tested
// against recorded fixtures. Unlike package adapters they write nothing
// themselves: their states go through the observation state machine
// (src/pipeline/observe.ts) into the existing cruise_offers columns (Variant A).
// ---------------------------------------------------------------------------
import type { ObservedState } from '../pipeline/cruise-state.js';

export interface CruiseAdapterItem {
  /** cruise_offers.source_url of the offer this state belongs to */
  sourceUrl: string;
  /** disambiguates when several offers share one source page */
  titleHint?: RegExp;
  state: ObservedState;
}

export interface CruiseAdapter {
  key: string;
  /** cruise_providers.root_domain */
  domain: string;
  /** pages this adapter reads; the monitor skips its LLM read for them */
  urls: string[];
  /** 'merge' when the source shows only part of the schedule (never removes a departure) */
  datesMode?: 'replace' | 'merge';
  fetchStates(): Promise<CruiseAdapterItem[]>;
}

export function emptyState(over: Partial<ObservedState> = {}): ObservedState {
  return {
    listed: true, departures: null, pricePP: null, priceCharter: null,
    durationDays: null, durationNights: null, seasonStartMonth: null, seasonEndMonth: null, seasonText: null, ...over,
  };
}
