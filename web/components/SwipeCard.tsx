'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProviderResult } from '../lib/types';

const TYPE_LABELS: Record<string, string> = {
  camp: 'Camp', safari: 'Safari', cruise: 'Cruise', tour: 'Tour',
  school: 'School', lessons: 'Lessons', rental: 'Rental',
  equipment_rental: 'Gear rental', snowkite: 'Snowkite',
};

const SWIPE_THRESHOLD = 90;
const FLY_X = 700;

interface Props {
  provider: ProviderResult;
  onSwipe: (dir: 'left' | 'right') => void;
  isTop: boolean;
  stackIndex: number; // 0 = top card, 1 = second, 2 = third
}

export default function SwipeCard({ provider, onSwipe, isTop, stackIndex }: Props) {
  const [x, setX] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [flying, setFlying] = useState<'left' | 'right' | null>(null);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    const base = provider.website_url
      ? (() => { try { return new URL(provider.website_url!).origin; } catch { return null; } })()
      : null;
    if (!base) return;
    fetch(`/api/og?url=${encodeURIComponent(base)}`)
      .then(r => r.json())
      .then(d => { if (d.imageUrl) setImgSrc(d.imageUrl); })
      .catch(() => {});
  }, [provider.website_url]);

  function flyAway(dir: 'left' | 'right') {
    setAnimating(true);
    setFlying(dir);
    setX(dir === 'right' ? FLY_X : -FLY_X);
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (!isTop || flying) return;
    startX.current = e.clientX;
    startY.current = e.clientY;
    setAnimating(false);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (startX.current === null || flying) return;
    // Cancel if scrolling vertically more than horizontally
    const dy = Math.abs(e.clientY - (startY.current ?? e.clientY));
    const dx = Math.abs(e.clientX - startX.current);
    if (dy > dx + 10) return;
    setX(e.clientX - startX.current);
  }

  function handlePointerUp() {
    if (startX.current === null || flying) return;
    startX.current = null;
    startY.current = null;
    if (Math.abs(x) >= SWIPE_THRESHOLD) {
      flyAway(x > 0 ? 'right' : 'left');
    } else {
      setAnimating(true);
      setX(0);
    }
  }

  const rotation = isTop ? x * 0.07 : 0;
  const likeOpacity = Math.max(0, Math.min(1, x / SWIPE_THRESHOLD));
  const nopeOpacity = Math.max(0, Math.min(1, -x / SWIPE_THRESHOLD));

  const scale = 1 - stackIndex * 0.04;
  const translateY = stackIndex * 10;

  const location = provider.locations.length > 0
    ? [...new Set(provider.locations)].slice(0, 3).join(' · ')
    : [provider.primary_region, provider.primary_country].filter(Boolean).join(', ');

  const displayName = provider.name
    ?? (() => { try { return new URL(provider.website_url!).hostname.replace(/^www\./, ''); } catch { return provider.website_url ?? '—'; } })();

  const whatsappHref = provider.whatsapp
    ? (provider.whatsapp.startsWith('http') ? provider.whatsapp : `https://wa.me/${provider.whatsapp.replace(/\D/g, '')}`)
    : null;

  return (
    <div
      className="absolute inset-x-0 top-0"
      style={{
        transform: isTop
          ? `translateX(${x}px) rotate(${rotation}deg)`
          : `scale(${scale}) translateY(${translateY}px)`,
        transition: animating ? 'transform 0.35s cubic-bezier(0.25,0.46,0.45,0.94)' : 'none',
        zIndex: 10 - stackIndex,
        touchAction: 'none',
        cursor: isTop ? (startX.current !== null ? 'grabbing' : 'grab') : 'default',
        userSelect: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onTransitionEnd={() => { if (flying) onSwipe(flying); }}
    >
      <div className="bg-white rounded-3xl shadow-2xl overflow-hidden mx-auto" style={{ maxWidth: 420 }}>

        {/* Photo */}
        <div className="relative bg-gradient-to-br from-sky-400 via-blue-500 to-cyan-400" style={{ height: 280 }}>
          {imgSrc && !imgError && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imgSrc}
              alt=""
              className="w-full h-full object-cover"
              draggable={false}
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
            />
          )}

          {/* Gradient overlay so text below photo is legible */}
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/40 to-transparent" />

          {/* LIKE stamp */}
          <div
            className="absolute top-5 left-5 border-4 border-emerald-400 text-emerald-400 font-black text-xl tracking-widest px-3 py-1 rounded-xl"
            style={{ opacity: likeOpacity, transform: 'rotate(-15deg)', transition: 'opacity 0.05s' }}
          >
            LIKE
          </div>

          {/* NOPE stamp */}
          <div
            className="absolute top-5 right-5 border-4 border-rose-400 text-rose-400 font-black text-xl tracking-widest px-3 py-1 rounded-xl"
            style={{ opacity: nopeOpacity, transform: 'rotate(15deg)', transition: 'opacity 0.05s' }}
          >
            NOPE
          </div>
        </div>

        {/* Info */}
        <div className="px-5 pt-4 pb-2">
          <h3 className="font-bold text-slate-900 text-xl leading-tight">{displayName}</h3>
          {location && <p className="text-sm text-slate-500 mt-0.5">📍 {location}</p>}

          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {provider.trip_types.slice(0, 5).map(t => (
              <span key={t} className="text-xs bg-sky-50 text-sky-700 border border-sky-200 rounded-full px-2.5 py-0.5 font-medium">
                {TYPE_LABELS[t] ?? t}
              </span>
            ))}
          </div>

          {provider.description && (
            <p className="text-sm text-slate-600 mt-2.5 line-clamp-2 leading-relaxed">{provider.description}</p>
          )}

          {/* Contact links */}
          <div className="flex items-center gap-4 mt-3 flex-wrap">
            {provider.website_url && (
              <a href={provider.website_url} target="_blank" rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline font-medium"
                onClick={e => e.stopPropagation()}>
                Website →
              </a>
            )}
            {provider.contact_email && (
              <a href={`mailto:${provider.contact_email}`}
                className="text-sm text-slate-400 hover:text-slate-600 truncate max-w-[180px]"
                onClick={e => e.stopPropagation()}>
                {provider.contact_email}
              </a>
            )}
            {whatsappHref && (
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer"
                className="text-sm text-emerald-600 hover:underline font-medium"
                onClick={e => e.stopPropagation()}>
                WhatsApp
              </a>
            )}
          </div>
        </div>

        {/* Action buttons — only on the top card */}
        {isTop && (
          <div className="flex justify-center gap-8 py-4">
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={() => flyAway('left')}
              className="w-16 h-16 rounded-full border-2 border-rose-300 text-rose-400 text-3xl hover:bg-rose-50 active:scale-95 transition-all flex items-center justify-center shadow-md"
              aria-label="Skip"
            >
              ✕
            </button>
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={() => flyAway('right')}
              className="w-16 h-16 rounded-full border-2 border-emerald-300 text-emerald-500 text-3xl hover:bg-emerald-50 active:scale-95 transition-all flex items-center justify-center shadow-md"
              aria-label="Like"
            >
              ♥
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
