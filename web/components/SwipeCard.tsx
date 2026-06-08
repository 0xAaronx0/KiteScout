'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProviderResult, SearchContext } from '../lib/types';
import MiniMap from './MiniMap';
import WindBars from './WindBars';
import Reviews from './Reviews';
import Availability from './Availability';
import { windMonthsForCountry } from '../lib/wind-stats';

const TYPE_LABELS: Record<string, string> = {
  camp: 'Camp', safari: 'Safari', cruise: 'Cruise', tour: 'Tour',
  school: 'School', lessons: 'Lessons', rental: 'Rental',
  equipment_rental: 'Gear rental', snowkite: 'Snowkite',
};

const SWIPE_THRESHOLD = 90;
const FLY_X = 700;

// Load an image just to read its real dimensions (no CORS issue for sizes).
function measureImage(url: string): Promise<{ url: string; w: number; h: number } | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve({ url, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Heuristic: is this image a logo / banner / icon rather than a real photo?
// Logos tend to be small or have an extreme (very wide / very tall) aspect ratio.
function isLogoLike(w: number, h: number): boolean {
  if (!w || !h) return true;
  const ar = w / h;
  if (w < 350 || h < 230) return true; // too small to be a proper hero photo
  if (ar > 2.6 || ar < 0.4) return true; // wordmark banner / vertical strip
  return false;
}

interface Props {
  provider: ProviderResult;
  onSwipe: (dir: 'left' | 'right') => void;
  isTop: boolean;
  stackIndex: number;
  searchContext?: SearchContext;
}

export default function SwipeCard({ provider, onSwipe, isTop, stackIndex }: Props) {
  const [x, setX] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [flying, setFlying] = useState<'left' | 'right' | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [imgIdx, setImgIdx] = useState(0);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const dragging = useRef(false);

  // Map pin: prefer the real coords from cruise_locations; otherwise geocode the spot.
  useEffect(() => {
    if (typeof provider.lat === 'number' && typeof provider.lng === 'number') {
      setCoords({ lat: provider.lat, lon: provider.lng });
      return;
    }
    const q = provider.matchedLocations[0]
      ?? [provider.primary_region, provider.primary_country].filter(Boolean).join(', ');
    if (!q) return;
    fetch(`/api/map-pin?q=${encodeURIComponent(q)}`)
      .then(r => r.json())
      .then(d => { if (d.lat && d.lon) setCoords({ lat: d.lat, lon: d.lon }); })
      .catch(() => {});
  }, [provider.lat, provider.lng, provider.matchedLocations, provider.primary_region, provider.primary_country]);

  // Fetch hero images from the provider's own website (the specific trip page,
  // falling back to the site root server-side). Measure each one and keep only
  // real photos — never logos/banners/icons — for the slider.
  useEffect(() => {
    if (!provider.website_url) return;
    let cancelled = false;
    fetch(`/api/og?url=${encodeURIComponent(provider.website_url)}`)
      .then(r => r.json())
      .then(async d => {
        const urls: string[] = Array.isArray(d.images) ? d.images : (d.imageUrl ? [d.imageUrl] : []);
        if (!urls.length) return;
        const measured = await Promise.all(urls.map(measureImage));
        if (cancelled) return;
        const good = measured.filter((m): m is { url: string; w: number; h: number } =>
          !!m && !isLogoLike(m.w, m.h)).map(m => m.url);
        if (good.length) { setImages(good); setImgIdx(0); }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [provider.website_url]);

  function nextImg(e: React.SyntheticEvent) {
    e.stopPropagation();
    setImgIdx(i => (i + 1) % images.length);
  }
  function prevImg(e: React.SyntheticEvent) {
    e.stopPropagation();
    setImgIdx(i => (i - 1 + images.length) % images.length);
  }
  function handleImgError(url: string) {
    setImages(prev => {
      const next = prev.filter(u => u !== url);
      setImgIdx(i => (next.length ? i % next.length : 0));
      return next;
    });
  }

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
    dragging.current = false;
    setAnimating(false);
    // Capture is deferred to the first clearly-horizontal move, so a vertical
    // gesture on the hero stays a native scroll of the card instead of a swipe.
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (startX.current === null || flying) return;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - (startY.current ?? e.clientY);
    if (!dragging.current) {
      // Undecided: only claim the gesture once it's clearly horizontal;
      // otherwise let it scroll the card body.
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
        dragging.current = true;
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
      } else {
        return;
      }
    }
    setX(dx);
  }

  function handlePointerUp() {
    if (startX.current === null || flying) return;
    const wasDragging = dragging.current;
    startX.current = null;
    startY.current = null;
    dragging.current = false;
    if (!wasDragging) return; // it was a scroll, not a swipe
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

  // Location chips: drop the trailing ", <country>" when it matches the card's
  // overall country (only keep it when the spot is in a different country),
  // then show at most 3 concrete spots followed by an ellipsis.
  const overallCountry = provider.primary_country?.trim().toLowerCase() ?? '';
  const spotLabels = provider.locations.map(loc => {
    const i = loc.lastIndexOf(', ');
    if (i === -1) return loc;
    const country = loc.slice(i + 2).trim().toLowerCase();
    return country === overallCountry ? loc.slice(0, i) : loc;
  });
  const shownSpots = spotLabels.slice(0, 3);
  const moreSpots = spotLabels.length > 3;

  const safeIdx = images.length ? Math.min(imgIdx, images.length - 1) : 0;
  const heroImg = images[safeIdx] ?? null;
  const hasSlider = images.length > 1;

  return (
    <div
      className="absolute inset-0"
      style={{
        transform: isTop
          ? `translateX(${x}px) rotate(${rotation}deg)`
          : `scale(${1 - stackIndex * 0.04}) translateY(${stackIndex * 12}px)`,
        transition: animating ? 'transform 0.35s cubic-bezier(0.25,0.46,0.45,0.94)' : 'none',
        zIndex: 10 - stackIndex,
        cursor: isTop ? 'grab' : 'default',
        userSelect: 'none',
      }}
      onTransitionEnd={() => { if (flying) onSwipe(flying); }}
    >
      <div className="bg-white rounded-3xl shadow-2xl overflow-hidden mx-auto flex flex-col h-full w-full" style={{ maxWidth: 420 }}>

        {/* ── Scrollable region: the hero image scrolls together with the body,
             so the usable scroll area isn't squeezed into the space below a
             fixed image. Only the swipe buttons stay pinned below. ── */}
        {/* Drag-to-swipe lives on this wrapper so a horizontal drag ANYWHERE on
            the card selects/dismisses; vertical stays a native scroll.
            overflow-x-hidden makes sure nothing can ever scroll sideways. */}
        <div
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain"
          style={{ touchAction: 'pan-y' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >

        {/* ── Hero photo (slider) ── */}
        <div className="relative h-48 sm:h-60">
          {/* Gradient fallback always present */}
          <div className="absolute inset-0 bg-gradient-to-br from-sky-400 via-blue-500 to-cyan-400" />

          {heroImg && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={heroImg}
              src={heroImg}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              draggable={false}
              referrerPolicy="no-referrer"
              onError={() => handleImgError(heroImg)}
            />
          )}

          {/* Photo slider controls (only with >1 image) */}
          {hasSlider && (
            <>
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={prevImg}
                aria-label="Previous photo"
                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/35 hover:bg-black/55 text-white flex items-center justify-center backdrop-blur-sm"
              >‹</button>
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={nextImg}
                aria-label="Next photo"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/35 hover:bg-black/55 text-white flex items-center justify-center backdrop-blur-sm"
              >›</button>
              <div className="absolute top-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                {images.map((_, i) => (
                  <span key={i} className="h-1.5 rounded-full transition-all"
                    style={{ width: i === safeIdx ? 16 : 6, background: i === safeIdx ? '#fff' : 'rgba(255,255,255,0.5)' }} />
                ))}
              </div>
            </>
          )}

          {/* Bottom gradient so name text is readable — pointer-events-none so it
              doesn't sit on top of the slider arrows and swallow their taps. */}
          <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />

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

          {/* Name + primary location over photo (pr leaves room for the trip chip) */}
          <div className="absolute inset-x-0 bottom-0 pl-4 pr-28 pb-3">
            <h3 className="font-bold text-white text-xl leading-tight drop-shadow">{displayName}</h3>
            {provider.primary_country && (
              <p className="text-sm text-white/80 mt-0.5 drop-shadow">
                📍 {[provider.primary_region, provider.primary_country].filter(Boolean).join(', ')}
              </p>
            )}
          </div>

          {/* Trip type(s) — pinned to the bottom-right of the photo */}
          {provider.trip_types.length > 0 && (
            <div className="absolute bottom-3 right-3 flex flex-wrap gap-1 justify-end max-w-[45%]">
              {provider.trip_types.map(t => (
                <span key={t} className="text-xs bg-white/90 text-sky-700 rounded-full px-2.5 py-0.5 font-semibold backdrop-blur-sm shadow">
                  {TYPE_LABELS[t] ?? t}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── Body ── */}
        <div className="px-4 pt-3 pb-2 space-y-3">

          {/* Operating spots — up to 3, then an ellipsis */}
          {shownSpots.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {shownSpots.map((loc, i) => (
                <span key={i} className="text-xs bg-slate-100 text-slate-600 rounded-full px-2.5 py-0.5">
                  {loc}
                </span>
              ))}
              {moreSpots && (
                <span className="text-xs text-slate-400 px-1 py-0.5">…</span>
              )}
            </div>
          )}

          {/* Cruise enrichment — vessel & trip length (price now lives in Availability) */}
          {(provider.vesselName || provider.vesselType || provider.durationDays) && (
            <div className="flex flex-wrap gap-1.5">
              {(provider.vesselName || provider.vesselType) && (
                <span className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2.5 py-0.5 font-medium">
                  ⛵ {provider.vesselName ?? provider.vesselType!.replace(/_/g, ' ')}
                </span>
              )}
              {provider.durationDays && (
                <span className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2.5 py-0.5 font-medium">
                  📅 {provider.durationDays} days
                </span>
              )}
            </div>
          )}

          {/* Availability — live dates, pricing tiers & boat capacity scraped
              from the provider's own site via web search (top card only) */}
          <Availability provider={provider} isTop={isTop} />

          {/* Description */}
          {provider.description && (
            <p className="text-sm text-slate-600 leading-relaxed line-clamp-3">{provider.description}</p>
          )}

          {/* Reviews preview — bstoked + Tripadvisor (mock for now) */}
          <Reviews seed={String(provider.id)} />

          {/* Wind probability across the year — real per-country data from
              bstoked.net where covered, otherwise an estimated seasonal curve */}
          <WindBars
            seed={String(provider.id)}
            months={windMonthsForCountry(provider.primary_country)}
          />

          {/* Simple, non-interactive location map */}
          {coords && <MiniMap lat={coords.lat} lon={coords.lon} />}

        </div>
        {/* end scrollable region (hero + body) */}
        </div>

        {/* ── Swipe buttons (pinned, always visible) ── */}
        {isTop && (
          <div className="shrink-0 flex justify-center gap-8 py-2.5 border-t border-slate-100 bg-white">
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={() => flyAway('left')}
              className="w-12 h-12 rounded-full border-2 border-rose-300 text-rose-400 text-2xl hover:bg-rose-50 active:scale-95 transition-all flex items-center justify-center shadow-sm"
              aria-label="Skip"
            >✕</button>
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={() => flyAway('right')}
              className="w-12 h-12 rounded-full border-2 border-emerald-300 text-emerald-500 text-2xl hover:bg-emerald-50 active:scale-95 transition-all flex items-center justify-center shadow-sm"
              aria-label="Like"
            >♥</button>
          </div>
        )}
      </div>
    </div>
  );
}
