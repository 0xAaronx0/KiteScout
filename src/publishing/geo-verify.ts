// ---------------------------------------------------------------------------
// `pnpm cli geo-verify`: verify the pilot camps against their operators' live pages and write the
// GEO evidence manifest. Read-only on the database (two reads of app_package_cards, before and after
// verification, to prove the row did not move); writes only JSON files in this repo.
//
//   pnpm cli geo-verify                      every active camp in app_package_cards (the catalog-wide manifest)
//   pnpm cli geo-verify --offer <id,id>      explicit offers only
//   --preview                                allowed with uncommitted generator files; writes to publishing/manifest/preview
//   --samples [--manifest-dir d]            write publishing/samples/v1 from the latest manifest in d
//   --policy-ref <url>                       the approved policy's approvalRef (default: pinned proposal URL)
// ---------------------------------------------------------------------------
import { existsSync, readFileSync } from 'node:fs';
import pLimit from 'p-limit';
import { supabase } from '../lib/supabase.js';
import { CARD_COLUMNS, FIELDS, REQUIRED_FIELDS, rowDigest, type CardRow } from './catalog-values.js';
import { buildManifest, gitState, loadPolicyRules, previousOfferIds, refsAt, writeManifest } from './manifest.js';
import { VERIFIER_BUDGET_USD, VERIFIER_MODEL, verifierSpendUsd } from './judge.js';
import { writeSamples } from './samples.js';
import { verifyOffer, type OfferVerification } from './verify.js';
import { registrableDomain } from './verify.js';

const REVOCATIONS_FILE = 'publishing/rights/revocations.json';

async function readRows(ids?: string[]): Promise<CardRow[]> {
  let q = supabase.from('app_package_cards').select(CARD_COLUMNS.join(','));
  q = ids ? q.in('offer_id', ids) : q.eq('package_type', 'camp');
  const { data, error } = await q;
  if (error) throw new Error(`app_package_cards read failed: ${error.message}`);
  return (data ?? []) as unknown as CardRow[];
}

const flag = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

export async function geoVerify(args: string[]): Promise<void> {
  if (args.includes('--samples')) {
    const dir = flag(args, '--manifest-dir') ?? 'publishing/manifest/v1';
    console.log(`samples from ${dir}: ${writeSamples(dir).join(', ')}`);
    return;
  }
  const preview = args.includes('--preview');
  const git = gitState();
  if (!git.clean && !preview) throw new Error('generator/schema/policy files are uncommitted: commit first (refs must be pinned) or pass --preview');
  const outDir = flag(args, '--out') ?? (preview ? 'publishing/manifest/preview' : 'publishing/manifest/v1');

  const wanted = flag(args, '--offer')?.split(',').map(s => s.trim()).filter(Boolean);
  const previous = previousOfferIds(outDir);
  const revoked = new Set<string>(existsSync(REVOCATIONS_FILE)
    ? (JSON.parse(readFileSync(REVOCATIONS_FILE, 'utf8')) as { offers: Array<{ offerId: string }> }).offers.map(o => o.offerId) : []);

  const rows = (await readRows(wanted)).filter(r => r.package_type === 'camp');
  const found = new Set(rows.map(r => String(r.offer_id)));
  // offers of the previous manifest that are no longer active camps (an explicit --offer run only removes what it names)
  const removed = (wanted ?? previous).filter(id => !found.has(id) && previous.includes(id));
  const missing = (wanted ?? []).filter(id => !found.has(id) && !previous.includes(id));
  if (missing.length) console.log(`  not an active camp, skipped: ${missing.join(', ')}`);
  console.log(`geo-verify: ${rows.length} camps, ${removed.length} removed since last manifest, verifier ${VERIFIER_MODEL}@${git.sha.slice(0, 7)}, cap USD ${VERIFIER_BUDGET_USD}${preview ? ' (preview)' : ''}`);

  // one worker per operator domain keeps the per-host throttle meaningful; a few domains in parallel
  const now = new Date();
  const limit = pLimit(4);
  const byDomain = new Map<string, CardRow[]>();
  for (const r of rows) {
    const d = registrableDomain(new URL(String(r.source_url ?? 'https://unknown.invalid')).hostname);
    byDomain.set(d, [...(byDomain.get(d) ?? []), r]);
  }
  const verified: OfferVerification[] = [];
  await Promise.all([...byDomain.values()].map(group => limit(async () => {
    for (const r of group) {
      const v = await verifyOffer(r, now);
      verified.push(v);
      const claimed = FIELDS.filter(f => v.fields[f].claimed);
      console.log(`  ${v.offerId.slice(0, 8)} ${String(r.provider_name).slice(0, 28).padEnd(28)} claimed ${claimed.length}/7 ${FIELDS.map(f => v.fields[f].claimed ? f[0].toUpperCase() : '.').join('')}${v.complete ? '' : `  INCOMPLETE: ${v.incompleteReason}`}`);
    }
  })));

  // confirming re-read: the snapshot is the row state at this moment, and it must equal what we verified
  const after = new Map((await readRows(verified.map(v => v.offerId))).map(r => [String(r.offer_id), r]));
  const observedAt = new Date().toISOString();
  const withState = verified.map(v => ({ ...v, stillCurrent: after.has(v.offerId) && rowDigest(after.get(v.offerId)!) === v.rowDigest }));

  const refs = refsAt(git.sha, flag(args, '--policy-ref'));
  const verifiedBy = `kitescout-ai-verifier/${withState.find(v => v.model)?.model ?? VERIFIER_MODEL}@${git.sha}`;
  const { manifest, sidecar } = buildManifest({ verified: withState, removed, revoked, observedAt, refs, verifiedBy, rules: loadPolicyRules() });
  const { path, latest } = writeManifest(outDir, manifest, sidecar);

  const healthy = manifest.entries.filter(e => e.status === 'active' && e.snapshot.complete && e.rights.status === 'permitted'
    && REQUIRED_FIELDS.every(f => e.claims.some(c => c.field === f)));
  console.log(`\nverifier spend USD ${verifierSpendUsd().toFixed(4)} of ${VERIFIER_BUDGET_USD} cap (${VERIFIER_MODEL} list price)`);
  console.log(`manifest ${manifest.revision} -> ${path} (pointer ${latest})`);
  console.log(`  ${healthy.length}/${manifest.entries.length} entries carry all 5 required claims; price claimed ${manifest.entries.filter(e => e.claims.some(c => c.field === 'price')).length}, departures claimed ${manifest.entries.filter(e => e.claims.some(c => c.field === 'departures')).length}`);
  const copied = withState.filter(v => (v.textReuse?.words ?? 0) >= 12);
  if (copied.length) console.log(`  text reuse (rights unknown): ${copied.map(v => `${v.offerId.slice(0, 8)} (${v.textReuse!.words} words)`).join(', ')}`);
}
