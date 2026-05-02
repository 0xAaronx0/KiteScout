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
  stackIndex: number;
}

export default function SwipeCard({ provider, onSwipe, isTop, stackIndex }: Props) {
  const [x, setX] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [flying, setFlying] = useState<'left' | 'right' | null>(null);
  const [spotImg, setSpotImg] = useState<string | null>(null);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);

  // Fetch og:image from provider's own website
  useEffect(() => {
    if (!provider.website_url) return;
    let origin: string;
    try { origin = new URL(provider.website_url).origin; } catch { return; }
    fetch(`/api/og?url=${encodeURIComponent(origin)}`)
      .then(r => r.json())
      .then(d => { if (d.imageUrl) setSpotImg(d.imageUrl); })
      .catch(() => {});
  }, [provider.website_url]);

  function flyAway(dir: 'left' | 'right') {
    if (flying) return;
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
    const dx = e.clientX - startX.current;
    const dy = Math.abs(e.clientY - (startY.current ?? e.clientY));
    if (dy > Math.abs(dx) + 10) return; // vertical scroll wins
    setX(dx);
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

  const rotation = isTop ? x * 0.06 : 0;
  const likeOpacity = Math.max(0, Math.min(1, x / SWIPE_THRESHOLD));
  const nopeOpacity = Math.max(0, Math.min(1, -x / SWIPE_THRESHOLD));

  const displayName = provider.name
    ?? (() => { try { return new URL(provider.website_url!).hostname.replace(/^www\./, ''); } catch { return '—'; } })();

  const whatsappHref = provider.whatsapp
    ? (provider.whatsapp.startsWith('http') ? provider.whatsapp : `https://wa.me/${provider.whatsapp.replace(/\D/g, '')}`)
    : null;

  const contactUrl = provider.contact_form_url ?? (provider.contact_email ? `mailto:${provider.contact_email}` : null);

  return (
    <div
      className="absolute inset-x-0 top-0"
      style={{
        transform: isTop
          ? `translateX(${x}px) rotate(${rotation}deg)`
          : `scale(${1 - stackIndex * 0.04}) translateY(${stackIndex * 12}px)`,
        transition: animating ? 'transform 0.35s cubic-bezier(0.25,0.46,0.45,0.94)' : 'none',
        zIndex: 10 - stackIndex,
        touchAction: 'none',
        cursor: isTop ? 'grab' : 'default',
        userSelect: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onTransitionEnd={() => { if (flying) onSwipe(flying); }}
    >
      <div className="bg-white rounded-3xl shadow-2xl overflow-hidden mx-auto" style={{ maxWidth: 420 }}>

        {/* ── Hero photo ── */}
        <div className="relative" style={{ height: 260 }}>
          {/* Gradient fallback always present */}
          <div className="absolute inset-0 bg-gradient-to-br from-sky-400 via-blue-500 to-cyan-400" />

          {spotImg && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={spotImg}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              draggable={false}
              referrerPolicy="no-referrer"
            />
          )}

          {/* Bottom gradient so name text is readable */}
          <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/70 to-transparent" />

          {/* Highlight badge */}
          {provider.isHighlight && (
            <div className="absolute top-3 left-3 bg-amber-400 text-amber-900 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
              ⭐ Top Pick
            </div>
          )}

          {/* LIKE / NOPE stamps */}
          <div
            className="absolute top-5 left-5 border-4 border-emerald-400 text-emerald-400 font-black text-xl tracking-widest px-3 py-1 rounded-xl"
            style={{ opacity: likeOpacity, transform: 'rotate(-15deg)' }}
          >
            LIKE
          </div>
          <div
            className="absolute top-5 right-5 border-4 border-rose-400 text-rose-400 font-black text-xl tracking-widest px-3 py-1 rounded-xl"
            style={{ opacity: nopeOpacity, transform: 'rotate(15deg)' }}
          >
            NOPE
          </div>

          {/* Name + primary location over photo */}
          <div className="absolute inset-x-0 bottom-0 px-4 pb-3">
            <h3 className="font-bold text-white text-xl leading-tight drop-shadow">{displayName}</h3>
            {provider.primary_country && (
              <p className="text-sm text-white/80 mt-0.5 drop-shadow">
                📍 {[provider.primary_region, provider.primary_country].filter(Boolean).join(', ')}
              </p>
            )}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-4 pt-3 pb-2 space-y-3">

          {/* All operating spots */}
          {provider.locations.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {provider.locations.map(loc => (
                <span key={loc} className="text-xs bg-slate-100 text-slate-600 rounded-full px-2.5 py-0.5">
                  {loc}
                </span>
              ))}
            </div>
          )}

          {/* Trip types */}
          {provider.trip_types.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {provider.trip_types.map(t => (
                <span key={t} className="text-xs bg-sky-50 text-sky-700 border border-sky-200 rounded-full px-2.5 py-0.5 font-medium">
                  {TYPE_LABELS[t] ?? t}
                </span>
              ))}
            </div>
          )}

          {/* Description */}
          {provider.description && (
            <p className="text-sm text-slate-600 leading-relaxed line-clamp-3">{provider.description}</p>
          )}

          {/* Contact CTAs */}
          <div className="flex gap-2 flex-wrap pt-1" onClick={e => e.stopPropagation()}>
            {provider.website_url && (
              <a href={provider.website_url} target="_blank" rel="noopener noreferrer"
                className="flex-1 min-w-[100px] text-center text-sm bg-sky-600 text-white rounded-xl px-3 py-2 font-medium hover:bg-sky-700 transition-colors">
                Visit website
              </a>
            )}
            {contactUrl && (
              <a href={contactUrl} target="_blank" rel="noopener noreferrer"
                className="flex-1 min-w-[80px] text-center text-sm bg-slate-100 text-slate-700 rounded-xl px-3 py-2 font-medium hover:bg-slate-200 transition-colors">
                {provider.contact_email ? 'Email' : 'Enquire'}
              </a>
            )}
            {whatsappHref && (
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer"
                className="flex-1 min-w-[80px] text-center text-sm bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl px-3 py-2 font-medium hover:bg-emerald-100 transition-colors">
                WhatsApp
              </a>
            )}
          </div>
        </div>

        {/* ── Swipe buttons ── */}
        {isTop && (
          <div className="flex justify-center gap-8 py-3 border-t border-slate-100">
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={() => flyAway('left')}
              className="w-14 h-14 rounded-full border-2 border-rose-300 text-rose-400 text-2xl hover:bg-rose-50 active:scale-95 transition-all flex items-center justify-center shadow-sm"
              aria-label="Skip"
            >✕</button>
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={() => flyAway('right')}
              className="w-14 h-14 rounded-full border-2 border-emerald-300 text-emerald-500 text-2xl hover:bg-emerald-50 active:scale-95 transition-all flex items-center justify-center shadow-sm"
              aria-label="Like"
            >♥</button>
          </div>
        )}
      </div>
    </div>
  );
}
