import { getSupabase } from '../../../lib/supabase';

// Admin index: every offer with its current image count, hero-video status and
// pending-selection indicator. Detail/selection lives at /admin/media/[offerId].
export const dynamic = 'force-dynamic';

interface OfferRow {
  id: string;
  title: string;
  country: string | null;
  region: string | null;
  images: Array<{ path: string; fallback?: boolean; width?: number; sort?: number }> | null;
  hero_video_url?: string | null;
  provider: { name: string | null; root_domain: string } | null;
}

// Below this native width an image never looks sharp in the app's fullscreen
// gallery (same threshold as the 2026-07-10 quality audit).
const LOW_RES_WIDTH = 640;

export default async function MediaAdminIndex({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const { key } = await searchParams;
  const supabase = getSupabase();
  const adminKey = key && process.env.CHANGES_ADMIN_KEY && key === process.env.CHANGES_ADMIN_KEY ? key : null;

  // Reseller offers are hard-inactive (Aaron, 2026-07-10): the app view excludes
  // them entirely, so curating their media would be wasted work — hide them here too.
  const NO_RESELLERS = 'is_reseller.is.null,is_reseller.eq.false';
  const [offersRes, selectedRes] = await Promise.all([
    supabase
      .from('cruise_offers')
      .select('id, title, country, region, images, hero_video_url, provider:cruise_providers!inner(name, root_domain)')
      .or(NO_RESELLERS)
      .order('title'),
    supabase.from('offer_media_candidates').select('cruise_offer_id').eq('status', 'selected'),
  ]);
  if (offersRes.error) console.error('[/admin/media] offers query failed:', offersRes.error.message);
  const heroVideoMissing = !!offersRes.error && /hero_video_url/.test(offersRes.error.message);
  // Graceful before migration 20260709000000: retry without the new column.
  const offers = (offersRes.data ?? (heroVideoMissing
    ? (await supabase.from('cruise_offers').select('id, title, country, region, images, provider:cruise_providers!inner(name, root_domain)').or(NO_RESELLERS).order('title')).data
    : null) ?? []) as unknown as OfferRow[];

  const pendingSel = new Set(((selectedRes.data ?? []) as Array<{ cruise_offer_id: string }>).map(r => r.cruise_offer_id));

  // "to be checked": fewer than 8 media items (images + hero video combined)
  // or still running on a fallback image.
  const mediaCount = (o: OfferRow) => (o.images?.length ?? 0) + (o.hero_video_url ? 1 : 0);
  const needsWork = (o: OfferRow) => mediaCount(o) < 8 || (o.images ?? []).some(i => i.fallback);

  const qs = adminKey ? `?key=${encodeURIComponent(adminKey)}` : '';
  // Curation state per offer, computed once — drives both row display and ordering.
  const decorated = offers.map(o => {
    const imgs = o.images ?? [];
    const fallback = imgs.some(i => i.fallback);
    const lowRes = imgs.filter(i => (i.width ?? Infinity) < LOW_RES_WIDTH);
    const hero = [...imgs].sort((a, b) => (a.sort ?? 99) - (b.sort ?? 99))[0];
    const heroLowRes = hero ? (hero.width ?? Infinity) < LOW_RES_WIDTH : false;
    const queued = pendingSel.has(o.id);
    // Still needs curation attention ("to be checked" or low-res images) and no
    // fresh selection is already queued for the next apply run.
    const urgent = !queued && (needsWork(o) || lowRes.length > 0);
    return { o, imgs, fallback, lowRes, heroLowRes, queued, urgent };
  });
  // Destination stays the primary grouping (one area is curated in one pass);
  // within a destination, offers that still need attention float to the top
  // (Aaron 2026-07-10) — low-res heroes first, then by low-res count.
  const sorted = decorated.sort((a, b) =>
    (a.o.country ?? 'zz').localeCompare(b.o.country ?? 'zz') ||
    (a.o.region ?? 'zz').localeCompare(b.o.region ?? 'zz') ||
    Number(b.urgent) - Number(a.urgent) ||
    Number(b.heroLowRes) - Number(a.heroLowRes) ||
    b.lowRes.length - a.lowRes.length ||
    a.o.title.localeCompare(b.o.title),
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur">
        <h1 className="text-lg font-bold">🪁 Media Curation — {offers.length} offers</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Pick up to 12 media per offer — images + optional hero video combined (first image = hero).
          {!adminKey && <span className="text-amber-400"> — read-only: append ?key=… to select</span>}
          {selectedRes.error && <span className="text-amber-400"> — candidates table missing: run migration 20260709000000</span>}
        </p>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-3">Offer</th>
              <th className="py-2 pr-3">Provider</th>
              <th className="py-2 pr-3">Images</th>
              <th className="py-2 pr-3">Hero video</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ o, imgs, fallback, lowRes, heroLowRes, queued }) => {
              return (
                <tr key={o.id} className="border-b border-slate-900 hover:bg-slate-900/50">
                  <td className="py-2 pr-3">
                    <a className="text-sky-400 hover:underline" href={`/admin/media/${o.id}${qs}`}>{o.title}</a>
                    <span className="block text-xs text-slate-500">{[o.region, o.country].filter(Boolean).join(', ')}</span>
                  </td>
                  <td className="py-2 pr-3 text-slate-400">{o.provider?.name ?? o.provider?.root_domain}</td>
                  <td className={`py-2 pr-3 ${imgs.length + (o.hero_video_url ? 1 : 0) < 8 || fallback ? 'text-amber-400' : 'text-slate-300'}`}>
                    {imgs.length}/12{fallback ? ' · fallback' : ''}
                    {lowRes.length > 0 && (
                      <span
                        className={`ml-1.5 rounded px-1 text-xs ${heroLowRes ? 'bg-red-900/60 text-red-300' : 'bg-amber-900/50 text-amber-300'}`}
                        title={`${lowRes.length} image(s) below ${LOW_RES_WIDTH}px native width${heroLowRes ? ' — incl. the hero' : ''}`}
                      >
                        ⚠ {lowRes.length} low-res
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">{o.hero_video_url ? '🎬' : <span className="text-slate-600">—</span>}</td>
                  <td className="py-2">
                    {queued
                      ? <span className="rounded-full bg-sky-900/60 px-2 py-0.5 text-xs text-sky-300">selection queued</span>
                      : needsWork(o)
                        ? <span className="rounded-full bg-amber-900/50 px-2 py-0.5 text-xs text-amber-300">to be checked</span>
                        : <span className="text-xs text-slate-600">ok</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </main>
    </div>
  );
}
