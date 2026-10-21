// Runs inside an export of MartinMarzi/KiteCruiseScout (see kcs-gate.test.ts), with that repo's tsconfig
// so its "@/..." imports resolve. For each case it loads the offer through the app's REAL catalog path
// (loadCatalogOfferById -> app_package_cards row -> normalize) and evaluates the app's REAL publishing
// gate. Supabase is stubbed with the row snapshot we verified (offline, deterministic); with
// KCS_GATE_LIVE=1 the live database is read instead (read-only GETs).
//   tsx --tsconfig <kcs>/tsconfig.json kcs-gate-harness.ts <kcsDir> <cases.json>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

interface Case { name: string; now: string; expectedRevision: string; row: Record<string, unknown> | null; evidence: unknown; policy: unknown }

const [kcsDir, casesPath] = process.argv.slice(2);
const cases = JSON.parse(readFileSync(casesPath, 'utf8')) as Case[];
const live = process.env.KCS_GATE_LIVE === '1';
process.env.KITESCOUT_ENABLE_CATALOG_EXPANSION = 'true';
if (!live) {
  process.env.SUPABASE_URL = 'https://fixture.supabase.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture';
}

let current: Case | null = null;
const realFetch = globalThis.fetch;
if (!live) globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const json = (body: unknown, range: string) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'content-range': range } });
  if (url.pathname.endsWith('/app_package_cards')) {
    const rows = current?.row ? [current.row] : [];
    return json(rows, rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0');
  }
  if (/\/(wind_stats|region_conditions|spot_conditions)$/.test(url.pathname)) return json([], '*/0');
  throw new Error(`harness: unexpected request ${url.pathname}`);
}) as typeof fetch;
else globalThis.fetch = realFetch;

// Pin the clock for the app code too (departure labels drop already-started dates on "today").
const RealDate = Date;
let fixed = RealDate.now();
class FixedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(fixed); else super(...(args as [string]));
  }
  static now(): number { return fixed; }
}

const gate = await import(pathToFileURL(join(kcsDir, 'src/features/publishing/offer-eligibility.server.ts')).href);
const loader = await import(pathToFileURL(join(kcsDir, 'src/features/catalog/catalog-loader.ts')).href);

const out: unknown[] = [];
for (const c of cases) {
  current = c;
  fixed = RealDate.parse(c.now);
  if (!live) globalThis.Date = FixedDate as DateConstructor;
  const offerId = (c.evidence as { offerId: string }).offerId;
  const offer = await loader.loadCatalogOfferById('package_offers', offerId, { mediaMode: 'source', fresh: true });
  globalThis.Date = RealDate;
  const values = offer ? {
    title: offer.title, description: offer.longDescription, type: offer.offerType,
    operator: { id: offer.operatorId, name: offer.providerName, website: offer.providerWebsiteUrl },
    location: { country: offer.country, destination: offer.destination }, price: offer.headlinePrice,
    departures: offer.availableDates?.map((d: { label: string }) => d.label) ?? [],
  } : null;
  const result = gate.evaluatePublishingOffer(offer ?? null, c.evidence, c.policy, { now: new RealDate(c.now), expectedRevision: c.expectedRevision });
  out.push({ name: c.name, offerFound: Boolean(offer), values, status: result.status, diagnostics: result.diagnostics,
    facts: result.status === 'editorial_preview' ? result.projection.facts : null });
}
process.stdout.write(`${JSON.stringify(out)}\n`);
