// operatorPatch: existing providers rows are fill-gaps-only, except values an adapter names as known-wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operatorPatch, type StoredOperator } from '../../src/offers/ingest.js';
import { ionClubOasis212LessonsPackageDakhla } from '../../src/offers/adapters/ion-club-oasis212-lessons-package-dakhla.js';
import { ionClubPastorinoCampDakhla } from '../../src/offers/adapters/ion-club-pastorino-camp-dakhla.js';

// the live row for ion-club.net as discovery left it (read 2026-10-21)
const zanzibar: StoredOperator = {
  name: 'ION CLUB Zanzibar Kite Center',
  website_url: 'https://www.ion-club.net/de/zanzibar/',
  contact_email: 'bookings@ion-club.net',
  whatsapp: null,
  phone: '+49(881) 9254960',
  trip_types: ['school', 'lessons', 'rental', 'camp'],
};

test('operatorPatch: the Dakhla adapters replace the Zanzibar centre name with the brand', () => {
  for (const a of [ionClubOasis212LessonsPackageDakhla, ionClubPastorinoCampDakhla]) {
    assert.deepEqual(operatorPatch(zanzibar, a), { name: 'ION CLUB', website_url: 'https://www.ion-club.net' });
  }
});

test('operatorPatch: a corrected or human-curated row is left alone', () => {
  const corrected = { ...zanzibar, name: 'ION CLUB', website_url: 'https://www.ion-club.net' };
  assert.deepEqual(operatorPatch(corrected, ionClubPastorinoCampDakhla), {});
  const curated = { ...zanzibar, name: 'ION CLUB Dakhla & Zanzibar' };
  assert.deepEqual(operatorPatch(curated, ionClubPastorinoCampDakhla), { website_url: 'https://www.ion-club.net' });
});

test('operatorPatch: without `correct` only gaps are filled', () => {
  const a = { kind: 'accommodation' as const, operator: { name: 'New Name', websiteUrl: 'https://x.example', rootDomain: 'x.example', phone: '+1' } };
  assert.deepEqual(operatorPatch({ ...zanzibar, phone: null }, a), { phone: '+1', trip_types: [...zanzibar.trip_types!, 'accommodation'] });
});
