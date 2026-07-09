import { getSupabase } from '../../../../lib/supabase';
import Selector, { type CandidateView } from './Selector';

// Per-offer media curation: current live images + every scraped image/video
// candidate; the admin picks up to 5 images (first = hero) + a hero video.
export const dynamic = 'force-dynamic';

interface StoredImg { path: string; source_url?: string | null; sort?: number; fallback?: boolean }

export default async function OfferMediaPage({
  params,
  searchParams,
}: {
  params: Promise<{ offerId: string }>;
  searchParams: Promise<{ key?: string }>;
}) {
  const { offerId } = await params;
  const { key } = await searchParams;
  const supabase = getSupabase();
  const adminKey = key && process.env.CHANGES_ADMIN_KEY && key === process.env.CHANGES_ADMIN_KEY ? key : null;

  const [offerRes, candRes] = await Promise.all([
    supabase
      .from('cruise_offers')
      .select('id, title, country, region, images, source_url, provider:cruise_providers!inner(name, root_domain, website_url)')
      .eq('id', offerId)
      .single(),
    supabase
      .from('offer_media_candidates')
      .select('id, kind, url, note, status, sort, hero')
      .eq('cruise_offer_id', offerId)
      .order('kind')
      .order('created_at'),
  ]);

  const offer = offerRes.data as (typeof offerRes.data & { provider?: { name: string | null; root_domain: string; website_url: string | null } }) | null;
  if (!offer) {
    return <div className="min-h-screen bg-slate-950 p-10 text-slate-300">Offer not found.</div>;
  }
  if (candRes.error) console.error('[/admin/media] candidates query failed:', candRes.error.message);

  // Signed URLs for the currently-live bucket images (private bucket) — used
  // both for the "current" strip and as display fallback for their candidates.
  const liveImages = ((offer.images as StoredImg[] | null) ?? []).slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const signedByPath = new Map<string, string>();
  for (const img of liveImages) {
    const { data } = await supabase.storage.from('cruise-images').createSignedUrl(img.path, 3600);
    if (data?.signedUrl) signedByPath.set(img.path, data.signedUrl);
  }
  const signedBySource = new Map<string, string>();
  for (const img of liveImages) {
    if (img.source_url && signedByPath.has(img.path)) signedBySource.set(img.source_url, signedByPath.get(img.path)!);
  }

  const candidates: CandidateView[] = ((candRes.data ?? []) as Array<{ id: string; kind: 'image' | 'video'; url: string; note: string | null; status: string; sort: number | null; hero: boolean }>).map(c => ({
    ...c,
    displayUrl: signedBySource.get(c.url) ?? c.url,
  }));

  const provider = offer.provider;
  const qs = adminKey ? `?key=${encodeURIComponent(adminKey)}` : '';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/95 px-6 py-3 backdrop-blur">
        <a href={`/admin/media${qs}`} className="text-xs text-sky-400 hover:underline">← all offers</a>
        <h1 className="text-base font-bold leading-tight">{offer.title}</h1>
        <p className="text-xs text-slate-400">
          {provider?.name ?? provider?.root_domain} · {[offer.region, offer.country].filter(Boolean).join(', ')}
          {offer.source_url && <> · <a className="text-sky-500 hover:underline" href={offer.source_url} target="_blank" rel="noopener noreferrer">offer page ↗</a></>}
          {provider?.website_url && <> · <a className="text-sky-500 hover:underline" href={provider.website_url} target="_blank" rel="noopener noreferrer">site ↗</a></>}
        </p>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-5">
        {liveImages.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Currently live ({liveImages.length})</h2>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {liveImages.map((img, i) => (
                <div key={img.path} className="relative shrink-0">
                  {signedByPath.has(img.path)
                    ? <img src={signedByPath.get(img.path)} alt="" className="h-24 rounded-md border border-slate-800 object-cover" />
                    : <div className="flex h-24 w-36 items-center justify-center rounded-md border border-slate-800 text-xs text-slate-600">no preview</div>}
                  <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px]">{i === 0 ? 'hero' : `#${i + 1}`}{img.fallback ? ' · fallback' : ''}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {candidates.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-10 text-center text-slate-400">
            <p className="font-medium">No candidates collected yet.</p>
            <p className="mt-1 text-sm">Run <code className="rounded bg-slate-800 px-1">pnpm cli cruise-media collect --domain {provider?.root_domain}</code> (or without --domain for all offers).</p>
          </div>
        ) : (
          <Selector offerId={offer.id as string} adminKey={adminKey} candidates={candidates} />
        )}
      </main>
    </div>
  );
}
