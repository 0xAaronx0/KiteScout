// ---------------------------------------------------------------------------
// `pnpm cli geo-verify --samples [--manifest-dir dir]`: the sanitized samples Martin asked for in
// KCS#267, cut from a real manifest. Real rows wherever the case occurred in the run; failure cases that
// did not occur are derived from a real entry and marked `synthetic: true` (they validate mechanics only).
// Each case carries the expected gate outcome; test/publishing/kcs-gate.test.ts checks it against the app.
// Policy: the freshness PROPOSAL with test stand-in approval fields (approvalRef = the manifest's policyRef,
// approvedAt = snapshot time) because nothing is approved yet.
// ---------------------------------------------------------------------------
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIELDS, REQUIRED_FIELDS, appFacts, sha256, type CardRow, type Field } from './catalog-values.js';
import type { Manifest, ManifestEntry } from './manifest.js';

interface Expect { status: 'editorial_preview' | 'held'; diagnostics: Array<{ field: string; code: string }> }
interface SampleCase { name: string; synthetic: boolean; note: string; now: string; expectedRevision: string; row: CardRow; evidence: ManifestEntry; policy: unknown; expect: Expect }

const record = (code: string): Expect => ({ status: 'held', diagnostics: [{ field: 'record', code }] });
const plusHours = (iso: string, h: number): string => new Date(Date.parse(iso) + h * 3600_000).toISOString();

export function writeSamples(manifestDir: string, outDir = 'publishing/samples/v1'): string[] {
  const { path } = JSON.parse(readFileSync(join(manifestDir, 'latest.json'), 'utf8')) as { path: string };
  const m = JSON.parse(readFileSync(join(manifestDir, path), 'utf8')) as Manifest;
  const side = JSON.parse(readFileSync(join(manifestDir, m.evidence), 'utf8')) as { offers: Array<{ offerId: string; row: CardRow; incompleteReason: string | null }> };
  const incompleteReason = new Map(side.offers.map(o => [o.offerId, o.incompleteReason]));
  const rows = new Map(side.offers.map(o => [o.offerId, o.row]));
  const proposal = JSON.parse(readFileSync('publishing/policy/v1/freshness-proposal.json', 'utf8')) as { owner: string; rules: Array<{ field: Field; maxAgeHours: number }> };
  const policy = { version: 1, approvalRef: m.refs.policyRef, owner: proposal.owner, approvedAt: m.observedAt,
    rules: proposal.rules.map(r => ({ field: r.field, maxAgeHours: r.maxAgeHours })) };
  const now = plusHours(m.observedAt, 1 / 60);
  const snapshotTime = new Date(m.observedAt);

  /** Gate outcome for an entry evaluated at `at`, derived from the contract (the test re-checks it against the app). */
  const expected = (e: ManifestEntry, at: string): Expect => {
    if (e.status !== 'active') return record('record_unavailable');
    if (!e.snapshot.complete) return record('incomplete_snapshot');
    if (e.rights.status !== 'permitted') return record('rights_not_permitted');
    const facts = appFacts(rows.get(e.offerId)!, snapshotTime);
    const diagnostics = FIELDS.flatMap(f => {
      const claim = e.claims.find(c => c.field === f);
      const gateInvalid = facts.values[f] === undefined && !(f === 'price' || f === 'departures');
      if (gateInvalid) return [{ field: f, code: 'invalid_fact' }];
      if (!claim) return [{ field: f, code: 'missing_evidence' }];
      return Date.parse(claim.expiresAt) <= Date.parse(at) ? [{ field: f, code: 'expired_evidence' }] : [];
    });
    return { status: diagnostics.some(d => REQUIRED_FIELDS.includes(d.field as Field)) ? 'held' : 'editorial_preview', diagnostics };
  };
  const make = (name: string, e: ManifestEntry, opts: { synthetic?: boolean; note: string; at?: string; revision?: string; expect?: Expect }): SampleCase => ({
    name, synthetic: opts.synthetic ?? false, note: opts.note, now: opts.at ?? now, expectedRevision: opts.revision ?? m.revision,
    row: rows.get(e.offerId)!, evidence: e, policy,
    expect: opts.expect ?? (opts.revision && opts.revision !== m.revision ? record('unexpected_revision') : expected(e, opts.at ?? now)),
  });

  const active = m.entries.filter(e => e.status === 'active' && rows.has(e.offerId));
  const healthy = active.filter(e => expected(e, now).status === 'editorial_preview');
  const has = (e: ManifestEntry, f: Field): boolean => e.claims.some(c => c.field === f);
  const files: Record<string, { title: string; cases: SampleCase[] }> = {};
  const add = (file: string, title: string, c: SampleCase | undefined): void => {
    if (!c) return;
    (files[file] ??= { title, cases: [] }).cases.push(c);
  };

  for (const e of healthy.slice(0, 12)) add('healthy.json', 'Healthy camps (real rows, real verification)', make(`healthy ${e.offerId}`, e, { note: 'real entry from the pilot manifest' }));
  add('unknown-price-dates.json', 'Price and dates unverified: published as unknown (real)', ((e) => e && make('price and departures unknown', e, { note: 'real entry: required facts verified, price/departures not verified on the operator page, so the app shows them as unknown' }))(healthy.find(e => !has(e, 'price') && !has(e, 'departures'))));
  add('unknown-price-dates.json', 'Price and dates unverified: published as unknown (real)', ((e) => e && make('departures unknown, price verified', e, { note: 'real entry: departures listed in our data but not printed on the operator page' }))(healthy.find(e => has(e, 'price') && !has(e, 'departures') && rows.get(e.offerId)?.dates)));
  if (!files['unknown-price-dates.json'] && healthy[0]) {
    const e = healthy[0];
    add('unknown-price-dates.json', 'Price and dates unverified: published as unknown', make('price and departures without claims', { ...e, claims: e.claims.filter(c => c.field !== 'price' && c.field !== 'departures') },
      { synthetic: true, note: 'synthetic: real healthy entry with its price and departures claims removed; the app publishes both as unknown' }));
  }
  const dep = healthy.find(e => has(e, 'departures')) ?? healthy.find(e => has(e, 'price'));
  if (dep) {
    const f: Field = has(dep, 'departures') ? 'departures' : 'price';
    const at = plusHours(dep.claims.find(c => c.field === f)!.expiresAt, 1);
    add('stale-optional-fact.json', 'Stale optional fact', make(`${f} claim expired`, dep, { at, note: `real entry evaluated 1 h after its ${f} claim expired (policy maxAge); the fact drops to unknown, the page stays` }));
  }
  for (const e of active.filter(x => x.snapshot.complete && x.rights.status === 'permitted' && expected(x, now).status === 'held').slice(0, 3))
    add('absent-required-claim.json', 'Required claim absent (real)', make(`held: ${expected(e, now).diagnostics.filter(d => REQUIRED_FIELDS.includes(d.field as Field)).map(d => `${d.field} ${d.code}`).join(', ')}`, e, { note: 'real entry: a required fact did not verify against the operator page, so no claim was written' }));

  const base = healthy[0] ?? active[0];
  // prefer an unreadable operator page over other incomplete causes
  const realFailure = active.find(e => !e.snapshot.complete && /source page not readable/.test(incompleteReason.get(e.offerId) ?? ''))
    ?? active.find(e => !e.snapshot.complete);
  add('partial-source-failure.json', 'Partial source failure', realFailure
    ? make('verification incomplete', realFailure, { note: `real entry, snapshot.complete = false: ${incompleteReason.get(realFailure.offerId)?.slice(0, 160) ?? 'row changed during verification'}` })
    : make('operator page unreadable', { ...base, snapshot: { ...base.snapshot, complete: false } }, { synthetic: true, note: 'synthetic: real entry with snapshot.complete forced to false' }));
  add('stale-revision.json', 'Wrong or stale revision', make('app expects a newer revision', base, { synthetic: true, revision: sha256('a newer manifest'), note: 'synthetic: the app pins a newer manifest revision than this entry carries' }));
  add('removed-offer.json', 'Removed offer', make('offer left the catalog', { ...base, status: 'removed', claims: [] }, { synthetic: true, note: 'synthetic: the generator writes status removed (no claims) for an offer of the previous manifest that is no longer an active camp' }));
  add('revoked-rights.json', 'Revoked rights', make('text rights revoked', { ...base, status: 'revoked', rights: { ...base.rights, status: 'revoked' }, claims: [] }, { synthetic: true, note: 'synthetic: offer listed in publishing/rights/revocations.json' }));
  const copied = active.find(e => e.rights.status === 'unknown' && e.snapshot.complete);
  add('revoked-rights.json', 'Revoked rights', copied
    ? make('summary shares operator prose: rights unknown', copied, { note: 'real entry: the summary shares 12+ consecutive words with the operator page, rights.status unknown' })
    : make('rights not permitted', { ...base, rights: { ...base.rights, status: 'unknown' } }, { synthetic: true, note: 'synthetic: rights.status unknown on an active entry' }));

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const [file, body] of Object.entries(files))
    writeFileSync(join(outDir, file), `${JSON.stringify({ version: 1, manifestRevision: m.revision, title: body.title, cases: body.cases }, null, 2)}\n`);
  return Object.keys(files);
}
