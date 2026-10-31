// Operator e-mails from the provider's own site count as verified (Aaron 2026-10-28, automatic since 2026-10-31).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailVerifiedStamp } from '../../src/offers/ingest.js';

const now = '2026-10-31T12:00:00.000Z';

test('emailVerifiedStamp: an operator with an e-mail and no stamp gets one', () => {
  assert.deepEqual(emailVerifiedStamp('surfariafrikaglobal@gmail.com', null, now), { last_verified_at: now });
});

test('emailVerifiedStamp: no e-mail, an existing stamp or a held platform address stay unstamped', () => {
  assert.deepEqual(emailVerifiedStamp(null, null, now), {});
  assert.deepEqual(emailVerifiedStamp('', null, now), {});
  assert.deepEqual(emailVerifiedStamp('info@x.example', '2026-10-26T17:00:00Z', now), {});
  assert.deepEqual(emailVerifiedStamp('osvaldo@kiteworldwide.com', null, now), {});
});
