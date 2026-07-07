import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../../../lib/supabase';

// Resolve a monitored provider change from the /changes dashboard:
//   approve → queued for full re-extraction (daily cron applies it)
//   dismiss → won't be applied
//   reopen  → back to pending
// Guarded by CHANGES_ADMIN_KEY (the dashboard itself stays public read-only).

export const dynamic = 'force-dynamic';

const ACTIONS: Record<string, string> = {
  approve: 'approved',
  dismiss: 'dismissed',
  reopen: 'pending',
};

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
  const status = ACTIONS[action];
  if (!id || !status) return NextResponse.json({ error: 'invalid id/action' }, { status: 400 });

  const supabase = getSupabase();
  const { data: row, error: readErr } = await supabase
    .from('cruise_changes').select('details').eq('id', id).single();
  if (readErr || !row) return NextResponse.json({ error: readErr?.message ?? 'not found' }, { status: 404 });

  const details = { ...((row.details as Record<string, unknown>) ?? {}) };
  details.status = status;
  details.resolved_via = 'changes-dashboard';
  details.resolved_at = new Date().toISOString();

  const { error } = await supabase
    .from('cruise_changes')
    .update({ details, seen: true })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Back to the dashboard (keep the key so the buttons stay armed).
  return NextResponse.redirect(new URL(`/changes?key=${encodeURIComponent(key)}`, req.url), 303);
}
