// Run ONE adapter file live (or against fixtures) without the DB:
//   npx tsx src/offers/probe-one.ts src/offers/adapters/<key>.ts            # live
//   OFFERS_RECORD_DIR=test/fixtures/offers/<key> npx tsx src/offers/probe-one.ts …   # live + save fixtures
//   OFFERS_FIXTURE_DIR=test/fixtures/offers/<key> npx tsx src/offers/probe-one.ts …  # replay
import 'dotenv/config';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { contentProblem, checkSlots } from './validate.js';
import { requestsSoFar } from './http.js';
import type { OfferAdapter } from './types.js';

const file = process.argv[2];
if (!file) { console.error('usage: npx tsx src/offers/probe-one.ts <adapter file>'); process.exit(1); }
const mod = await import(pathToFileURL(resolve(file)).href);
const adapter = Object.values(mod).find((v): v is OfferAdapter => !!v && typeof v === 'object' && 'fetchSlots' in v);
if (!adapter) { console.error('no OfferAdapter export found'); process.exit(1); }
const notes: string[] = [];
const ctx = { note: (t: string) => notes.push(t), incomplete: (r: string) => notes.push(`INCOMPLETE: ${r}`) };
const content = process.argv.includes('--slots') ? null : await adapter.fetchContent(ctx);
const slots = await adapter.fetchSlots(ctx);
const { ok, problems } = checkSlots(slots);
console.log(JSON.stringify({ key: adapter.key, content, slots }, null, 2));
console.error(`\n${adapter.key}: content ${content ? (contentProblem(content) ?? 'OK') : 'skipped'}; slots ${ok.length}/${slots.length} valid; ${requestsSoFar()} requests`);
for (const p of problems) console.error(`  slot problem: ${p}`);
for (const n of notes) console.error(`  note: ${n}`);
