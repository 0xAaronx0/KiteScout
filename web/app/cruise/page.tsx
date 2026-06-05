'use client';

import { useEffect, useState } from 'react';
import SwipeDeck from '../../components/SwipeDeck';
import type { ProviderResult } from '../../lib/types';

interface CruiseDestination {
  destination: string;
  count: number;
}

// Flag emoji for the common cruise countries; falls back to ⛵.
const FLAGS: Record<string, string> = {
  Egypt: '🇪🇬', Greece: '🇬🇷', 'Saint Vincent and the Grenadines': '🇻🇨',
  Bahamas: '🇧🇸', Italy: '🇮🇹', France: '🇫🇷', 'Antigua and Barbuda': '🇦🇬',
  Spain: '🇪🇸', Croatia: '🇭🇷', Grenada: '🇬🇩', Turkey: '🇹🇷',
  'Dominican Republic': '🇩🇴', Seychelles: '🇸🇨', Maldives: '🇲🇻',
  'Turks and Caicos': '🇹🇨', 'British Virgin Islands': '🇻🇬',
};

// Shorter display labels for long official country names.
const SHORT_LABELS: Record<string, string> = {
  'Saint Vincent and the Grenadines': 'Grenadines',
  'Antigua and Barbuda': 'Antigua',
  'British Virgin Islands': 'BVI',
};

type Phase = 'search' | 'loading' | 'results';

export default function CruisePage() {
  const [destination, setDestination] = useState('');
  const [phase, setPhase] = useState<Phase>('search');
  const [providers, setProviders] = useState<ProviderResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchedDestination, setSearchedDestination] = useState('');
  const [topDestinations, setTopDestinations] = useState<CruiseDestination[]>([]);

  // Load the most popular cruise destinations for the quick-option chips.
  useEffect(() => {
    fetch('/api/cruise-destinations')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setTopDestinations(d as CruiseDestination[]); })
      .catch(() => {});
  }, []);

  // Deep-link from the cruise map: ?provider=<id> opens that one provider's
  // card directly; ?destination=<query> pre-runs a destination search.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const providerId = params.get('provider');
    const dest = params.get('destination');

    if (providerId) {
      setPhase('loading');
      fetch(`/api/cruise-provider?id=${encodeURIComponent(providerId)}`)
        .then(r => (r.ok ? r.json() : Promise.reject()))
        .then((p: ProviderResult) => {
          setProviders([p]);
          setSearchedDestination(p.primary_region ?? p.primary_country ?? p.name ?? 'Cruise');
          setPhase('results');
        })
        .catch(() => { setError('That cruise provider could not be found.'); setPhase('search'); });
    } else if (dest) {
      setDestination(dest);
      runSearch(dest);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSearch(query: string) {
    const q = query.trim();
    if (!q) return;
    setPhase('loading');
    setError(null);
    setSearchedDestination(q);
    try {
      const res = await fetch('/api/cruise-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Search failed');
      setProviders(data as ProviderResult[]);
      setPhase('results');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setPhase('search');
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    runSearch(destination);
  }

  function handleSuggestion(dest: string) {
    setDestination(dest);
    runSearch(dest);
  }

  function reset() {
    setPhase('search');
    setDestination('');
    setProviders([]);
  }

  /* ── Loading ── */
  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-sky-900 via-blue-900 to-cyan-900 flex flex-col items-center justify-center gap-5">
        <div className="text-6xl animate-bounce">⛵</div>
        <p className="text-white/80 text-lg font-medium">Searching cruise providers…</p>
        <div className="flex gap-2">
          {[0, 200, 400].map(d => (
            <span key={d} className="w-2 h-2 bg-white/50 rounded-full animate-bounce"
              style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
      </div>
    );
  }

  /* ── Results ── */
  if (phase === 'results') {
    return (
      <div className="min-h-[100svh] bg-slate-50">
        <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-20">
          <button onClick={reset}
            className="text-sky-600 text-sm font-medium hover:text-sky-700 flex items-center gap-1">
            ← Back
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-slate-900 truncate">
              ⛵ Kite Cruises — {searchedDestination}
            </h1>
            <p className="text-xs text-slate-400">
              {providers.length === 0
                ? 'No results found'
                : `${providers.length} provider${providers.length !== 1 ? 's' : ''} found · swipe to shortlist`}
            </p>
          </div>
        </header>

        <main className="px-4 py-6">
          {providers.length === 0 ? (
            <div className="max-w-sm mx-auto text-center pt-20">
              <div className="text-5xl mb-4">🌊</div>
              <p className="font-semibold text-slate-700 mb-2">No cruise providers found</p>
              <p className="text-sm text-slate-500 mb-6">
                Try a different destination — we're constantly adding new providers.
              </p>
              <button onClick={reset}
                className="bg-sky-600 text-white rounded-xl px-6 py-3 font-medium hover:bg-sky-700 transition-colors">
                Search again
              </button>
            </div>
          ) : (
            <div className="max-w-lg mx-auto">
              <SwipeDeck
                providers={providers}
                searchContext={{ regions: [searchedDestination], tripTypes: ['cruise'] }}
              />
            </div>
          )}
        </main>
      </div>
    );
  }

  /* ── Search (default) ── */
  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero */}
      <div className="flex-1 bg-gradient-to-br from-sky-900 via-blue-800 to-cyan-900 flex flex-col items-center justify-center px-4 py-16 text-center">
        <div className="text-6xl mb-5">⛵</div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white mb-3 tracking-tight">
          Kite Cruise Finder
        </h1>
        <p className="text-white/70 text-lg mb-10 max-w-sm">
          Find kite cruise & liveaboard providers worldwide. Swipe to shortlist.
        </p>

        {/* Search form */}
        <form onSubmit={handleSubmit} className="w-full max-w-md">
          <div className="flex rounded-2xl overflow-hidden shadow-2xl bg-white">
            <input
              value={destination}
              onChange={e => setDestination(e.target.value)}
              placeholder="Where do you want to kite? e.g. Grenadines"
              className="flex-1 px-5 py-4 text-slate-900 text-sm focus:outline-none placeholder:text-slate-400"
              autoFocus
            />
            <button
              type="submit"
              disabled={!destination.trim()}
              className="bg-sky-500 text-white px-6 text-sm font-bold hover:bg-sky-600 disabled:opacity-40 transition-colors shrink-0"
            >
              Search
            </button>
          </div>
        </form>

        {/* Quick options — top destinations by number of cruise offers */}
        {topDestinations.length > 0 && (
          <div className="mt-7 max-w-md">
            <p className="text-white/50 text-xs uppercase tracking-wide mb-2.5">Most cruise offers</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {topDestinations.map(({ destination: dest, count }) => (
                <button
                  key={dest}
                  onClick={() => handleSuggestion(dest)}
                  className="group flex items-center gap-2 text-sm bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-full pl-4 pr-2 py-2 transition-colors backdrop-blur-sm"
                >
                  <span>{FLAGS[dest] ?? '⛵'} {SHORT_LABELS[dest] ?? dest}</span>
                  <span className="text-xs font-semibold bg-white/20 group-hover:bg-white/30 rounded-full px-2 py-0.5 transition-colors">
                    {count}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="mt-5 text-red-300 text-sm bg-red-900/40 rounded-xl px-4 py-2">{error}</p>
        )}
      </div>

      <footer className="bg-slate-900 text-slate-500 text-xs text-center py-3">
        <a href="/" className="hover:text-white transition-colors">← KiteScout Chat</a>
        <span className="mx-3">·</span>
        🪁 KiteScout — AI-powered kite travel
      </footer>
    </div>
  );
}
