import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../../../../lib/supabase';

// Persist the admin's media selection for one offer:
//   images: up to 5 candidate ids in display order (index 0 = hero image)
//   heroVideoId: optional video candidate id (becomes hero_video_url on apply)
// Rows become status='selected'; `pnpm cli cruise-media apply` (daily cron)
// downloads/compresses them into the bucket and updates the offer.

export const dynamic = 'force-dynamic';

interface Body {
  offerId?: string;
  key?: string;
  imageIds?: string[];
  heroVideoId?: string | null;
}

export async function POST(req: NextRequest) {
  const adminKey = process.env.CHANGES_ADMIN_KEY;
  if (!adminKey) return NextResponse.json({ error: 'CHANGES_ADMIN_KEY not configured' }, { status: 503 });

  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  if (body.key !== adminKey) return NextResponse.json({ error: 'invalid key' }, { status: 403 });

  const offerId = String(body.offerId ?? '');
  const imageIds = Array.isArray(body.imageIds) ? body.imageIds.map(String).slice(0, 12) : [];
  const heroVideoId = body.heroVideoId ? String(body.heroVideoId) : null;
  if (!offerId) return NextResponse.json({ error: 'offerId required' }, { status: 400 });
  if (new Set(imageIds).size !== imageIds.length) return NextResponse.json({ error: 'duplicate image ids' }, { status: 400 });
  // Combined media cap: images + hero video together ≤ 12.
  if (imageIds.length + (heroVideoId ? 1 : 0) > 12) {
    return NextResponse.json({ error: 'max 12 media items (images + hero video combined)' }, { status: 400 });
  }

  const supabase = getSupabase();

  // The ids must belong to this offer and the right kind.
  const { data: rows, error: readErr } = await supabase
    .from('offer_media_candidates')
    .select('id, kind')
    .eq('cruise_offer_id', offerId);
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  const byId = new Map((rows ?? []).map(r => [r.id as string, r.kind as string]));
  for (const id of imageIds) {
    if (byId.get(id) !== 'image') return NextResponse.json({ error: `not an image candidate of this offer: ${id}` }, { status: 400 });
  }
  if (heroVideoId && byId.get(heroVideoId) !== 'video') {
    return NextResponse.json({ error: 'heroVideoId is not a video candidate of this offer' }, { status: 400 });
  }

  // Reset previous pending selection (keep 'applied' history intact), then mark the new one.
  const { error: resetErr } = await supabase
    .from('offer_media_candidates')
    .update({ status: 'candidate', hero: false, sort: null })
    .eq('cruise_offer_id', offerId)
    .eq('status', 'selected');
  if (resetErr) return NextResponse.json({ error: resetErr.message }, { status: 500 });

  for (let i = 0; i < imageIds.length; i++) {
    const { error } = await supabase
      .from('offer_media_candidates')
      .update({ status: 'selected', sort: i, hero: i === 0 })
      .eq('id', imageIds[i]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (heroVideoId) {
    const { error } = await supabase
      .from('offer_media_candidates')
      .update({ status: 'selected', hero: true, sort: null })
      .eq('id', heroVideoId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    queued: { images: imageIds.length, heroVideo: !!heroVideoId },
    note: 'Applied by the daily cron, or run: pnpm cli cruise-media apply',
  });
}
