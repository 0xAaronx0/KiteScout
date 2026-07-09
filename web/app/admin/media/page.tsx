import { getSupabase } from '../../../lib/supabase';

// Admin index: every offer with its current image count, hero-video status and
// pending-selection indicator. Detail/selection lives at /admin/media/[offerId].
export const dynamic = 'force-dynamic';

interface OfferRow {
  id: string;
  title: string;
  country: string | null;
  region: string | null;
  images: Array<{ path: string; fallback?: boolean }> | null;
  hero_video_url?: string | null;
  provider: { name: string | null; root_domain: string } | null;
}

export default async function MediaAdminIndex({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const { key } = await searchParams;
  const supabase = getSupabase();
  const adminKey = key && process.env.CHANGES_ADMIN_KEY && key === process.env.CHANGES_ADMIN_KEY ? key : null;

  const [offersRes, selectedRes] = await Promise.all([
    supabase
      .from('cruise_offers')
      .select('id, title, country, region, images, hero_video_url, provider:cruise_providers!inner(name, root_domain)')
      .order('title'),
    supabase.from('offer_media_candidates').select('cruise_offer_id').eq('status', 'selected'),
  ]);
  if (offersRes.error) console.error('[/admin/media] offers query failed:', offersRes.error.message);
  const heroVideoMissing = !!offersRes.error && /hero_video_url/.test(offersRes.error.message);
  // Graceful before migration 20260709000000: retry without the new column.
  const offers = (offersRes.data ?? (heroVideoMissing
    ? (await supabase.from('cruise_offers').select('id, title, country, region, images, provider:cruise_providers!inner(name, root_domain)').order('title')).data
    : null) ?? []) as unknown as OfferRow[];

  const pendingSel = new Set(((selectedRes.data ?? []) as Array<{ cruise_offer_id: string }>).map(r => r.cruise_offer_id));

  const needsWork = (o: OfferRow) => {
    const imgs = o.images ?? [];
    return imgs.length < 5 || imgs.some(i => i.fallback);
  };

  const qs = adminKey ? `?key=${encodeURIComponent(adminKey)}` : '';
  const sorted = [...offers].sort((a, b) => Number(needsWork(b)) - Number(needsWork(a)));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur">
        <h1 className="text-lg font-bold">🪁 Media Curation — {offers.length} offers</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Pick up to 10 listing images (first = hero) and an optional hero video per offer.
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
            {sorted.map(o => {
              const imgs = o.images ?? [];
              const fallback = imgs.some(i => i.fallback);
              return (
                <tr key={o.id} className="border-b border-slate-900 hover:bg-slate-900/50">
                  <td className="py-2 pr-3">
                    <a className="text-sky-400 hover:underline" href={`/admin/media/${o.id}${qs}`}>{o.title}</a>
                    <span className="block text-xs text-slate-500">{[o.region, o.country].filter(Boolean).join(', ')}</span>
                  </td>
                  <td className="py-2 pr-3 text-slate-400">{o.provider?.name ?? o.provider?.root_domain}</td>
                  <td className={`py-2 pr-3 ${imgs.length < 5 || fallback ? 'text-amber-400' : 'text-slate-300'}`}>
                    {imgs.length}/10{fallback ? ' · fallback' : ''}
                  </td>
                  <td className="py-2 pr-3">{o.hero_video_url ? '🎬' : <span className="text-slate-600">—</span>}</td>
                  <td className="py-2">
                    {pendingSel.has(o.id)
                      ? <span className="rounded-full bg-sky-900/60 px-2 py-0.5 text-xs text-sky-300">selection queued</span>
                      : needsWork(o)
                        ? <span className="rounded-full bg-amber-900/50 px-2 py-0.5 text-xs text-amber-300">needs curation</span>
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
