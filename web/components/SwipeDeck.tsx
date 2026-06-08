'use client';

import { useEffect, useRef, useState } from 'react';
import SwipeCard from './SwipeCard';
import type { ProviderResult, SearchContext } from '../lib/types';
import { loadAvailability, peekAvailability } from '../lib/availability';
import { providerScore } from '../lib/richness';

// Order providers most-data-first. Stable: equal scores keep their input order.
function rankByRichness(list: ProviderResult[]): ProviderResult[] {
  return list
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const d = providerScore(b.p, peekAvailability(b.p)) - providerScore(a.p, peekAvailability(a.p));
      return d !== 0 ? d : a.i - b.i;
    })
    .map(x => x.p);
}

interface Props {
  providers: ProviderResult[];
  searchContext?: SearchContext;
  onShortlist?: (liked: ProviderResult[]) => void;
  /** Reports swipe progress so a parent can render the counter in its header. */
  onProgress?: (index: number, total: number) => void;
}

export default function SwipeDeck({ providers, searchContext, onShortlist, onProgress }: Props) {
  const [index, setIndex] = useState(0);
  const [liked, setLiked] = useState<ProviderResult[]>([]);
  const [done, setDone] = useState(false);
  // Display order: starts as an instant static-richness sort, then gets refined
  // as live availability streams in. Cards up to & including the current one are
  // locked so the card being viewed never reshuffles under the user.
  const [order, setOrder] = useState<ProviderResult[]>(() => rankByRichness(providers));
  const requested = useRef<Set<string>>(new Set());
  const [availVersion, setAvailVersion] = useState(0);

  // New search → reset the deck and re-rank from scratch.
  useEffect(() => {
    requested.current = new Set();
    setOrder(rankByRichness(providers));
    setIndex(0);
    setLiked([]);
    setDone(false);
  }, [providers]);

  // Keep the parent's header counter/progress bar in sync with the deck.
  useEffect(() => {
    onProgress?.(done ? order.length : index, order.length);
  }, [index, done, order.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prefetch live availability for the current card + the next 5. Fire once per
  // provider (guarded), and bump a version when each resolves so the queue
  // re-ranks. As richer cards get pulled forward, they enter the window and load.
  useEffect(() => {
    for (const p of order.slice(index, index + 6)) {
      if (requested.current.has(p.id)) continue;
      requested.current.add(p.id);
      loadAvailability(p).then(() => setAvailVersion(v => v + 1));
    }
  }, [index, order]);

  // Re-rank the not-yet-seen queue when new availability arrives. Before the
  // first swipe we let position 0 settle to the richest card too (cards show a
  // loading skeleton then, so it's near-invisible); once the user starts
  // swiping, the current card and history are locked so nothing reshuffles
  // under them.
  useEffect(() => {
    if (availVersion === 0) return;
    setOrder(prev => {
      const lock = index === 0 ? 0 : index + 1;
      return [...prev.slice(0, lock), ...rankByRichness(prev.slice(lock))];
    });
  }, [availVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSwipe(provider: ProviderResult, dir: 'left' | 'right') {
    const newLiked = dir === 'right' ? [...liked, provider] : liked;
    const next = index + 1;
    if (next >= order.length) {
      setLiked(newLiked);
      setDone(true);
      onShortlist?.(newLiked);
    } else {
      setLiked(newLiked);
      setIndex(next);
    }
  }

  if (done) {
    return (
      <div className="text-center py-8 px-4">
        {liked.length > 0 ? (
          <>
            <div className="text-4xl mb-3">🎉</div>
            <p className="font-bold text-slate-900 text-lg mb-1">
              {liked.length} provider{liked.length !== 1 ? 's' : ''} shortlisted
            </p>
            <ul className="mt-3 space-y-1">
              {liked.map(p => (
                <li key={p.id} className="text-sm text-slate-600">
                  <a href={p.website_url ?? '#'} target="_blank" rel="noopener noreferrer"
                    className="hover:text-blue-600 hover:underline">
                    {p.name ?? p.website_url}
                  </a>
                  {p.contact_email && (
                    <span className="text-slate-400 ml-2">— {p.contact_email}</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <div className="text-4xl mb-3">😅</div>
            <p className="text-slate-600">None shortlisted — ask me to search again with different criteria!</p>
          </>
        )}
      </div>
    );
  }

  // Show top 3 cards; render in reverse so top card is painted last (highest z-index)
  const visible = order.slice(index, index + 3);

  return (
    <div>
      {/* Card stack — sized to the SMALL viewport (svh) so the whole card,
          including the swipe buttons, fits even with mobile browser toolbars showing.
          The progress counter now lives in the page header, so no row is needed here. */}
      <div className="relative" style={{ height: 'min(700px, calc(100svh - 120px))' }}>
        {[...visible].reverse().map((provider, reversedIdx) => {
          const stackIndex = visible.length - 1 - reversedIdx;
          return (
            <SwipeCard
              key={`${provider.id}-${index}`}
              provider={provider}
              onSwipe={dir => handleSwipe(provider, dir)}
              isTop={stackIndex === 0}
              stackIndex={stackIndex}
              searchContext={searchContext}
            />
          );
        })}
      </div>
    </div>
  );
}
