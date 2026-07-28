import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../../../lib/supabase';

// "Re-run" button on /changes: trigger the rerun-change.yml GitHub workflow for
// one change row. The workflow re-extracts the provider WITHOUT writing offers
// and stores the before/after diff on the row (details.rerun) — the dashboard
// then shows the diff with an Approve button.
//
// Needs GITHUB_ACTIONS_TOKEN (fine-grained PAT, Actions read+write on
// 0xAaronx0/KiteScout). Without it the route answers 503 with a clear hint.

export const dynamic = 'force-dynamic';

const REPO = '0xAaronx0/KiteScout';
const WORKFLOW = 'rerun-change.yml';

export async function POST(req: NextRequest) {
  const adminKey = process.env.CHANGES_ADMIN_KEY;
  if (!adminKey) {
    return NextResponse.json({ error: 'CHANGES_ADMIN_KEY not configured on the server' }, { status: 503 });
  }

  const form = await req.formData();
  const id = String(form.get('id') ?? '');
  const key = String(form.get('key') ?? '');
  if (key !== adminKey) return NextResponse.json({ error: 'invalid key' }, { status: 403 });
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const token = process.env.GITHUB_ACTIONS_TOKEN;
  if (!token) {
    // Human clicks land here from a form POST — answer with a readable banner
    // on the dashboard instead of raw JSON.
    return new NextResponse(null, { status: 303, headers: { Location: `/changes?key=${encodeURIComponent(key)}&error=no-token` } });
  }

  const supabase = getSupabase();
  const { data: row, error: readErr } = await supabase
    .from('cruise_changes').select('details').eq('id', id).single();
  if (readErr || !row) return NextResponse.json({ error: readErr?.message ?? 'not found' }, { status: 404 });

  const gh = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main', inputs: { change_id: id } }),
  });
  if (gh.status !== 204) {
    const body = await gh.text().catch(() => '');
    console.error(`[changes/rerun] workflow dispatch failed (HTTP ${gh.status}): ${body.slice(0, 300)}`);
    return new NextResponse(null, { status: 303, headers: { Location: `/changes?key=${encodeURIComponent(key)}&error=dispatch-${gh.status}` } });
  }

  const details = { ...((row.details as Record<string, unknown>) ?? {}) };
  details.status = 'rerun_running';
  details.rerun_requested_at = new Date().toISOString();

  const { error } = await supabase.from('cruise_changes').update({ details, seen: true }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return new NextResponse(null, { status: 303, headers: { Location: `/changes?key=${encodeURIComponent(key)}` } });
}
