// Cross-repo contract test: our manifest + samples through the Kite Cruise Scout app's own catalog
// loader and publishing gate (MartinMarzi/KiteCruiseScout, offer-eligibility.server.ts). The KCS clone
// is only read: `git archive <ref>` into a temp dir (default ref origin/main, override KCS_REF; clone
// path KCS_DIR, default ~/KiteCruiseScout). Skips when no clone is present (e.g. CI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, REQUIRED_FIELDS, type Field } from '../../src/publishing/catalog-values.js';
import type { Manifest } from '../../src/publishing/manifest.js';

const ROOT = join(import.meta.dirname, '../..');
const KCS = process.env.KCS_DIR ?? join(homedir(), 'KiteCruiseScout');
const REF = process.env.KCS_REF ?? 'origin/main';
const MANIFEST_DIR = process.env.GEO_MANIFEST_DIR ?? join(ROOT, 'publishing/manifest/v1');
const SAMPLES_DIR = join(ROOT, 'publishing/samples/v1');
const haveKcs = existsSync(join(KCS, '.git')) && existsSync(join(KCS, 'node_modules'));

interface Case { name: string; now: string; expectedRevision: string; row: Record<string, unknown> | null; evidence: unknown; policy: unknown }
interface Out { name: string; offerFound: boolean; values: Record<Field, unknown> | null; status: string; diagnostics: Array<{ field: string; code: string }>; facts: Record<string, unknown> | null }

function kcsExport(): { dir: string; sha: string } {
  const sha = execFileSync('git', ['-C', KCS, 'rev-parse', REF], { encoding: 'utf8' }).trim();
  const dir = join(tmpdir(), `kcs-gate-${sha.slice(0, 12)}`);
  if (!existsSync(join(dir, 'src'))) {
    mkdirSync(dir, { recursive: true });
    execSync(`git -C "${KCS}" archive ${sha} src tsconfig.json package.json | tar -x -C "${dir}"`);
  }
  if (!existsSync(join(dir, 'node_modules'))) symlinkSync(join(KCS, 'node_modules'), join(dir, 'node_modules'));
  return { dir, sha };
}

function runGate(cases: Case[]): Out[] {
  const { dir } = kcsExport();
  const file = join(tmpdir(), `kcs-gate-cases-${process.pid}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(cases));
  const stdout = execFileSync(join(ROOT, 'node_modules/.bin/tsx'), ['--tsconfig', join(dir, 'tsconfig.json'), join(ROOT, 'test/publishing/kcs-gate-harness.ts'), dir, file],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, TZ: 'UTC' }, maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(stdout.trim().split('\n').pop()!) as Out[];
}

/** The freshness proposal as the app would hold it once approved (approval fields are test stand-ins). */
export function approvedPolicy(approvalRef: string, approvedAt: string): unknown {
  const proposal = JSON.parse(readFileSync(join(ROOT, 'publishing/policy/v1/freshness-proposal.json'), 'utf8'));
  return { version: 1, approvalRef, owner: proposal.owner, approvedAt, rules: proposal.rules.map((r: { field: string; maxAgeHours: number }) => ({ field: r.field, maxAgeHours: r.maxAgeHours })) };
}

test('manifest: every complete entry with all required claims passes the KCS gate as editorial_preview', { skip: !haveKcs || !existsSync(join(MANIFEST_DIR, 'latest.json')) }, () => {
  const { path } = JSON.parse(readFileSync(join(MANIFEST_DIR, 'latest.json'), 'utf8')) as { path: string };
  const manifest = JSON.parse(readFileSync(join(MANIFEST_DIR, path), 'utf8')) as Manifest;
  const sidecar = JSON.parse(readFileSync(join(MANIFEST_DIR, manifest.evidence), 'utf8')) as { offers: Array<{ offerId: string; row: Record<string, unknown> }> };
  const rows = new Map(sidecar.offers.map(o => [o.offerId, o.row]));
  const now = new Date(Date.parse(manifest.observedAt) + 60_000).toISOString();
  const policy = approvedPolicy(manifest.refs.policyRef, manifest.observedAt);
  const active = manifest.entries.filter(e => e.status === 'active');
  const out = runGate(active.map(e => ({ name: e.offerId, now, expectedRevision: manifest.revision, row: rows.get(e.offerId) ?? null, evidence: e, policy })));

  let healthy = 0;
  for (const [i, e] of active.entries()) {
    const r = out[i];
    assert.ok(r.offerFound, `${e.offerId}: the app loader rejected the verified row`);
    const claimed = new Set(e.claims.map(c => c.field));
    // no claimed field may come back as fact_changed / invalid: our values hash exactly like the app's
    for (const d of r.diagnostics) assert.ok(!claimed.has(d.field as Field), `${e.offerId}: claimed ${d.field} -> ${d.code}`);
    const isHealthy = e.snapshot.complete && e.rights.status === 'permitted' && REQUIRED_FIELDS.every(f => claimed.has(f));
    assert.equal(r.status, isHealthy ? 'editorial_preview' : 'held', `${e.offerId}: ${JSON.stringify(r.diagnostics)}`);
    if (isHealthy) {
      healthy++;
      for (const f of claimed) assert.equal(canonical((r.facts as Record<string, unknown>)[f]), canonical(r.values![f]), `${e.offerId}: projected ${f}`);
      if (!claimed.has('price')) assert.equal(r.facts!.price, null);
      if (!claimed.has('departures')) assert.equal(r.facts!.departures, null);
    }
  }
  assert.ok(healthy >= 1, 'no healthy entry in the manifest');
});

test('samples: each sanitized sample gets its expected gate outcome', { skip: !haveKcs || !existsSync(SAMPLES_DIR) }, () => {
  const samples = readdirSync(SAMPLES_DIR).filter(f => f.endsWith('.json')).flatMap(f => {
    const s = JSON.parse(readFileSync(join(SAMPLES_DIR, f), 'utf8')) as { cases: Array<Case & { expect: { status: string; diagnostics: Array<{ field: string; code: string }> } }> };
    return s.cases.map(c => ({ ...c, name: `${f}: ${c.name}` }));
  });
  assert.ok(samples.length > 0);
  const out = runGate(samples);
  for (const [i, s] of samples.entries()) {
    assert.equal(out[i].status, s.expect.status, `${s.name}: ${JSON.stringify(out[i].diagnostics)}`);
    assert.deepEqual(out[i].diagnostics, s.expect.diagnostics, s.name);
  }
});
