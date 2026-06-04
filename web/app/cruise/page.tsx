'use client';

import { useState } from 'react';
import SwipeDeck from '../../components/SwipeDeck';
import type { ProviderResult } from '../../lib/types';

const SUGGESTIONS = [
  'Grenadines ⛵',
  'Philippines 🇵🇭',
  'Indonesia 🇮🇩',
  'Red Sea 🌊',
  'Maldives 🏝️',
  'Caribbean 🌴',
  'Thailand 🇹🇭',
  'Cape Verde 🇨🇻',
];

type Phase = 'search' | 'loading' | 'results';

export default function CruisePage() {
  const [destination, setDestination] = useState('');
  const [phase, setPhase] = useState<Phase>('search');
  const [providers, setProviders] = useState<ProviderResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchedDestination, setSearchedDestination] = useState('');

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

  function handleSuggestion(s: string) {
    // Strip the emoji from the suggestion before searching
    const clean = s.replace(/[\u{1F300}-\u{1FFFF}]/gu, '').trim();
    setDestination(clean);
    runSearch(clean);
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
      <div className="min-h-screen bg-slate-50">
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

        {/* Suggestion chips */}
        <div className="flex flex-wrap gap-2 justify-center mt-6 max-w-md">
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              onClick={() => handleSuggestion(s)}
              className="text-sm bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-full px-4 py-2 transition-colors backdrop-blur-sm"
            >
              {s}
            </button>
          ))}
        </div>

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
