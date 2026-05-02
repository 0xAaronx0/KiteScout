'use client';

import { useState } from 'react';
import SwipeCard from './SwipeCard';
import type { ProviderResult } from '../lib/types';

interface Props {
  providers: ProviderResult[];
  onShortlist?: (liked: ProviderResult[]) => void;
}

export default function SwipeDeck({ providers, onShortlist }: Props) {
  const [index, setIndex] = useState(0);
  const [liked, setLiked] = useState<ProviderResult[]>([]);
  const [done, setDone] = useState(false);

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

  const remaining = providers.length - index;
  // Show top 3 cards; render in reverse so top card is painted last (highest z-index)
  const visible = providers.slice(index, index + 3);

  return (
    <div>
      {/* Counter */}
      <div className="flex items-center justify-between mb-3 px-1">
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">
          {remaining} of {providers.length} · swipe or tap ✕ / ♥
        </p>
        <div className="flex gap-1">
          {providers.map((_, i) => (
            <div
              key={i}
              className="h-1 rounded-full transition-all"
              style={{
                width: i === index ? 16 : 6,
                background: i < index ? '#10b981' : i === index ? '#0ea5e9' : '#e2e8f0',
              }}
            />
          ))}
        </div>
      </div>

      {/* Card stack */}
      <div className="relative" style={{ height: 490 }}>
        {[...visible].reverse().map((provider, reversedIdx) => {
          const stackIndex = visible.length - 1 - reversedIdx;
          return (
            <SwipeCard
              key={`${provider.id}-${index}`}
              provider={provider}
              onSwipe={dir => handleSwipe(provider, dir)}
              isTop={stackIndex === 0}
              stackIndex={stackIndex}
            />
          );
        })}
      </div>
    </div>
  );
}
