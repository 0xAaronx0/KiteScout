'use client';

import { useMemo, useState } from 'react';

export interface CandidateView {
  id: string;
  kind: 'image' | 'video';
  url: string;
  displayUrl: string;      // signed bucket URL for currently-live images, else the remote URL
  note: string | null;
  status: string;
  sort: number | null;
  hero: boolean;
}

// Only self-hosted video files are collected (no platform embeds), so the
// preview is a seeked frame of the file itself; #t=0.5 makes browsers paint a
// real frame instead of a black box.
function VideoPreview({ url }: { url: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <>
      {broken ? (
        <div className="flex h-full w-full flex-col items-center justify-center bg-slate-900 text-slate-500">
          <span className="text-2xl">🎬</span>
          <span className="mt-1 text-[10px]">Video file</span>
        </div>
      ) : (
        <video
          src={`${url}#t=0.5`}
          preload="metadata"
          muted
          playsInline
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      )}
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="rounded-full bg-black/55 px-2.5 py-1 text-sm text-white">▶</span>
      </span>
    </>
  );
}

export default function Selector({
  offerId,
  adminKey,
  candidates,
}: {
  offerId: string;
  adminKey: string | null;
  candidates: CandidateView[];
}) {
  const images = useMemo(() => candidates.filter(c => c.kind === 'image'), [candidates]);
  const videos = useMemo(() => candidates.filter(c => c.kind === 'video'), [candidates]);

  // Initial selection: pending selection if present, else the currently-live set.
  const initial = useMemo(() => {
    const selected = images.filter(c => c.status === 'selected').sort((a, b) => (a.sort ?? 9) - (b.sort ?? 9));
    if (selected.length) return selected.map(c => c.id);
    return images.filter(c => (c.note ?? '').startsWith('currently live')).slice(0, 12).map(c => c.id);
  }, [images]);

  const [picked, setPicked] = useState<string[]>(initial);
  const [heroVideo, setHeroVideo] = useState<string | null>(
    videos.find(v => v.status === 'selected')?.id ?? null,
  );
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const toggle = (id: string) => {
    setMsg(null);
    setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : p.length < 12 - (heroVideo ? 1 : 0) ? [...p, id] : p));
  };
  const makeHero = (id: string) => {
    setMsg(null);
    setPicked(p => [id, ...p.filter(x => x !== id)]);
  };

  const save = async () => {
    if (!adminKey) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/media/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId, key: adminKey, imageIds: picked, heroVideoId: heroVideo }),
      });
      const j = await res.json();
      if (res.ok) {
        // Straight back to the listing overview (fresh server render shows the
        // "selection queued" status) — saves a click per curated offer.
        window.location.href = `/admin/media?key=${encodeURIComponent(adminKey)}`;
        return;
      }
      setMsg(`✗ ${j.error ?? res.status}`);
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : 'request failed'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="sticky top-[57px] z-10 -mx-6 mb-4 flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-6 py-3 backdrop-blur">
        <span className="text-sm">
          <b className={picked.length >= 5 ? 'text-emerald-400' : 'text-amber-400'}>{picked.length + (heroVideo ? 1 : 0)}/12</b> media
          {picked.length > 0 && <span className="text-slate-400"> · #1 = hero</span>}
          {heroVideo && <span className="text-slate-400"> · 🎬 hero video set</span>}
        </span>
        <button
          onClick={save}
          disabled={!adminKey || saving || picked.length === 0}
          className="rounded-lg bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save selection'}
        </button>
        {!adminKey && <span className="text-xs text-amber-400">read-only — append ?key=…</span>}
        {msg && <span className="text-xs text-slate-300">{msg}</span>}
      </div>

      {videos.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Hero video ({videos.length} found)</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <button
              onClick={() => setHeroVideo(null)}
              className={`flex h-28 items-center justify-center rounded-lg border text-xs ${heroVideo === null ? 'border-emerald-500 bg-emerald-950/40 text-emerald-300' : 'border-slate-800 bg-slate-900 text-slate-500 hover:border-slate-600'}`}
            >
              no hero video
            </button>
            {videos.map(v => {
              
              const active = heroVideo === v.id;
              return (
                <button
                  key={v.id}
                  onClick={() => { if (!active && picked.length >= 12) { setMsg('✗ max 12 media — remove an image first'); return; } setMsg(null); setHeroVideo(active ? null : v.id); }}
                  title={`${v.url}\n${v.note ?? ''}`}
                  className={`relative h-28 overflow-hidden rounded-lg border text-left ${active ? 'border-emerald-500 ring-2 ring-emerald-500/50' : 'border-slate-800 hover:border-slate-600'}`}
                >
                  <VideoPreview url={v.url} />
                  <span className="absolute bottom-0 left-0 right-0 bg-black/70 px-2 py-0.5 text-[10px] text-slate-200">{(v.note ?? '').slice(0, 48)}</span>
                  {v.status === 'applied' && <span className="absolute right-1 top-1 rounded bg-emerald-800 px-1.5 text-[10px]">live</span>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Image candidates ({images.length})</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {images.map(c => {
            const pos = picked.indexOf(c.id);
            const isPicked = pos >= 0;
            if (broken.has(c.id)) return null;
            return (
              <div
                key={c.id}
                className={`group relative cursor-pointer overflow-hidden rounded-lg border ${isPicked ? (pos === 0 ? 'border-amber-400 ring-2 ring-amber-400/60' : 'border-emerald-500 ring-2 ring-emerald-500/50') : 'border-slate-800 hover:border-slate-500'}`}
                onClick={() => toggle(c.id)}
                title={`${c.url}\n${c.note ?? ''}`}
              >
                <img
                  src={c.displayUrl}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="h-36 w-full object-cover"
                  onError={() => setBroken(b => new Set(b).add(c.id))}
                />
                {isPicked && (
                  <span className={`absolute left-1 top-1 rounded px-1.5 py-0.5 text-[11px] font-bold ${pos === 0 ? 'bg-amber-400 text-black' : 'bg-emerald-600 text-white'}`}>
                    {pos === 0 ? 'HERO' : `#${pos + 1}`}
                  </span>
                )}
                {(c.note ?? '').startsWith('currently live') && (
                  <span className="absolute right-1 top-1 rounded bg-sky-900/90 px-1.5 py-0.5 text-[10px] text-sky-200">live</span>
                )}
                {isPicked && pos !== 0 && (
                  <button
                    onClick={e => { e.stopPropagation(); makeHero(c.id); }}
                    className="absolute bottom-1 right-1 hidden rounded bg-black/75 px-1.5 py-0.5 text-[10px] text-amber-300 group-hover:block"
                  >
                    ★ make hero
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
