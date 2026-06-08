'use client';

import { useEffect, useState } from 'react';
import SwipeCard from './SwipeCard';
import type { ProviderResult, SearchContext } from '../lib/types';

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

  // Keep the parent's header counter/progress bar in sync with the deck.
  useEffect(() => {
    onProgress?.(done ? providers.length : index, providers.length);
  }, [index, done, providers.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSwipe(provider: ProviderResult, dir: 'left' | 'right') {
    const newLiked = dir === 'right' ? [...liked, provider] : liked;
    const next = index + 1;
    if (next >= providers.length) {
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
  const visible = providers.slice(index, index + 3);

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
