import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../../../lib/supabase';

// Resolve a monitored provider change from the /changes dashboard:
//   approve     → queued for full re-extraction (daily cron applies it) —
//                 used after a re-run when new/removed offers need the full path
//   apply-rerun → surgically write the re-run's previewed field values NOW
//                 (only whitelisted fields, values were stored by the re-run)
//   dismiss     → won't be applied
//   reopen      → back to pending
// Guarded by CHANGES_ADMIN_KEY (the dashboard itself stays public read-only).

export const dynamic = 'force-dynamic';

const ACTIONS: Record<string, string> = {
  approve: 'approved',
  dismiss: 'dismissed',
  reopen: 'pending',
};

// Mirror of SURGICAL_APPLY_FIELDS in src/pipeline/extract-cruise-offers.ts —
// the only columns an approve may write without a full re-extraction.
const APPLY_FIELDS = new Set([
  'title', 'country', 'region', 'price_from_eur', 'currency', 'duration_days',
  'season_text', 'vessel_name', 'vessel_type', 'summary', 'booking_modes', 'dates',
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

  if (key !== adminKey) return NextResponse.json({ error: 'invalid key' }, { status: 403 });
  if (!id || (!ACTIONS[action] && action !== 'apply-rerun')) {
    return NextResponse.json({ error: 'invalid id/action' }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data: row, error: readErr } = await supabase
    .from('cruise_changes').select('details, cruise_provider_id').eq('id', id).single();
  if (readErr || !row) return NextResponse.json({ error: readErr?.message ?? 'not found' }, { status: 404 });

  const details = { ...((row.details as Record<string, unknown>) ?? {}) };

  if (action === 'apply-rerun') {
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
        if (APPLY_FIELDS.has(field)) patch[field] = value;
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
  return NextResponse.redirect(new URL(`/changes?key=${encodeURIComponent(key)}`, req.url), 303);
}
