import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../../../lib/supabase';
import { isAdminKey } from '../../../../lib/admin-key';

// Resolve a monitored provider change from the /changes dashboard:
//   approve     → queued for full re-extraction (daily cron applies it) —
//                 used after a re-run when new/removed offers need the full path
//   apply-rerun → surgically write the re-run's previewed field values NOW
//                 (only whitelisted fields, values were stored by the re-run)
//   dismiss     → won't be applied
//   reopen      → back to pending
//   revert      → undo an auto-applied observation (writes its logged "before" values back)
//   restore-provider → un-hide a provider the monitor hid after a site-loss signal
// Guarded by CHANGES_ADMIN_KEY (the dashboard needs the same key since 2026-10-19).

export const dynamic = 'force-dynamic';

const ACTIONS: Record<string, string> = {
  approve: 'approved',
  dismiss: 'dismissed',
  reopen: 'pending',
};

// Mirror of SURGICAL_APPLY_FIELDS in src/pipeline/extract-cruise-offers.ts plus the
// observation STATE_FIELDS (src/pipeline/cruise-state.ts) — the only columns an
// approve or a revert may write without a full re-extraction.
const APPLY_FIELDS = new Set([
  'title', 'country', 'region', 'price_from_eur', 'currency', 'duration_days',
  'season_text', 'vessel_name', 'vessel_type', 'summary', 'booking_modes', 'dates',
  'price_pp_cabin', 'price_pp_cabin_currency', 'price_charter_week', 'price_charter_week_currency',
  'season_start_month', 'season_end_month', 'duration_nights',
]);

interface RerunData {
  at?: string;
  mode?: string;
  updates?: Array<{ slug: string; title?: string; set: Record<string, unknown> }>;
}

export async function POST(req: NextRequest) {
  const adminKey = process.env.CHANGES_ADMIN_KEY;
  if (!adminKey) {
    return NextResponse.json({ error: 'CHANGES_ADMIN_KEY not configured on the server' }, { status: 503 });
  }

  const form = await req.formData();
  const id = String(form.get('id') ?? '');
  const action = String(form.get('action') ?? '');
  const key = String(form.get('key') ?? '');
  const offerSlug = String(form.get('slug') ?? '');

  if (!isAdminKey(key)) return NextResponse.json({ error: 'invalid key' }, { status: 403 });
  if (!id || (!ACTIONS[action] && !['apply-rerun', 'remove-offer', 'revert', 'restore-provider'].includes(action))) {
    return NextResponse.json({ error: 'invalid id/action' }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data: row, error: readErr } = await supabase
    .from('cruise_changes').select('details, cruise_provider_id').eq('id', id).single();
  if (readErr || !row) return NextResponse.json({ error: readErr?.message ?? 'not found' }, { status: 404 });

  const details = { ...((row.details as Record<string, unknown>) ?? {}) };

  if (action === 'remove-offer') {
    // Explicit, admin-triggered removal of ONE offer of this change's provider
    // (e.g. a "removed offer" the re-run confirmed or the admin judges dead).
    // Deletes the offer row + its media candidates; bucket files stay (cheap,
    // harmless). NB: a future FULL re-extraction of the provider may re-create
    // the offer if the site still advertises it.
    if (!offerSlug) return NextResponse.json({ error: 'slug required' }, { status: 400 });
    const { data: offer, error: offErr } = await supabase
      .from('cruise_offers')
      .select('id, slug, title')
      .eq('cruise_provider_id', row.cruise_provider_id as string)
      .eq('slug', offerSlug)
      .single();
    if (offErr || !offer) return NextResponse.json({ error: `offer "${offerSlug}" not found for this provider` }, { status: 404 });
    const { error: candErr } = await supabase
      .from('offer_media_candidates').delete().eq('cruise_offer_id', offer.id as string);
    if (candErr) return NextResponse.json({ error: `candidate cleanup failed: ${candErr.message}` }, { status: 500 });
    const { error: delErr } = await supabase
      .from('cruise_offers').delete().eq('id', offer.id as string);
    if (delErr) return NextResponse.json({ error: `delete failed: ${delErr.message}` }, { status: 500 });
    const removed = Array.isArray(details.removed_offers) ? details.removed_offers as unknown[] : [];
    details.removed_offers = [...removed, { slug: offer.slug, title: offer.title, at: new Date().toISOString() }];
    const { error: updErr } = await supabase.from('cruise_changes').update({ details, seen: true }).eq('id', id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    return new NextResponse(null, { status: 303, headers: { Location: `/changes?key=${encodeURIComponent(key)}` } });
  }

  if (action === 'revert') {
    // Undo an auto-applied observation: the logged "before" values go back (null included —
    // that is the state before the auto-apply, not a blanking by a weak crawl).
    const applied = details.applied as { offer_id?: string; changes?: Array<{ field: string; before: unknown }> } | undefined;
    if (details.status !== 'auto_applied' || !applied?.offer_id || !applied.changes?.length) {
      return NextResponse.json({ error: 'not an auto-applied observation' }, { status: 409 });
    }
    const patch: Record<string, unknown> = {};
    for (const c of applied.changes) if (APPLY_FIELDS.has(c.field)) patch[c.field] = c.before ?? null;
    const { error: upErr } = await supabase.from('cruise_offers').update(patch).eq('id', applied.offer_id);
    if (upErr) return NextResponse.json({ error: `revert failed: ${upErr.message}` }, { status: 500 });
    details.status = 'dismissed';
    details.reverted_at = new Date().toISOString();
    details.resolved_via = 'changes-dashboard (revert)';
  } else if (action === 'restore-provider') {
    const hidden = details.hidden as { prev_status?: string } | undefined;
    if (!hidden) return NextResponse.json({ error: 'this change did not hide a provider' }, { status: 409 });
    const { error: upErr } = await supabase.from('cruise_providers')
      .update({ status: hidden.prev_status && hidden.prev_status !== 'dead' ? hidden.prev_status : 'new' })
      .eq('id', row.cruise_provider_id as string);
    if (upErr) return NextResponse.json({ error: `restore failed: ${upErr.message}` }, { status: 500 });
    details.status = 'dismissed';
    details.restored_at = new Date().toISOString();
    details.resolved_via = 'changes-dashboard (restore provider)';
  } else if (action === 'apply-rerun') {
    // Surgical apply of the re-run preview: write exactly the stored values.
    const rerun = details.rerun as RerunData | undefined;
    const updates = rerun?.updates ?? [];
    if (rerun?.mode !== 'surgical' || updates.length === 0) {
      return NextResponse.json({ error: 'no surgical re-run preview stored for this change' }, { status: 409 });
    }
    const applied: string[] = [];
    for (const u of updates) {
      const patch: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(u.set ?? {})) {
        if (!APPLY_FIELDS.has(field)) continue;
        // Never blank a field via approve — empty fresh values are weak-crawl
        // artifacts (also guards plans stored before this rule existed).
        if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
        patch[field] = value;
      }
      if (!u.slug || Object.keys(patch).length === 0) continue;
      const { error: upErr } = await supabase
        .from('cruise_offers')
        .update(patch)
        .eq('cruise_provider_id', row.cruise_provider_id as string)
        .eq('slug', u.slug);
      if (upErr) {
        return NextResponse.json({ error: `apply failed on "${u.slug}": ${upErr.message}` }, { status: 500 });
      }
      applied.push(u.slug);
    }
    details.status = 'applied';
    details.applied_at = new Date().toISOString();
    details.applied_via = 'changes-dashboard (surgical re-run apply)';
    details.applied_slugs = applied;
  } else {
    details.status = ACTIONS[action];
    details.resolved_via = 'changes-dashboard';
    details.resolved_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('cruise_changes')
    .update({ details, seen: true })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Back to the dashboard (keep the key so the buttons stay armed).
  return new NextResponse(null, { status: 303, headers: { Location: `/changes?key=${encodeURIComponent(key)}` } });
}
