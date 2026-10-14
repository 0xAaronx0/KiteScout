// badgeCols: live / instant badges only while the provider's engine shows an open future date (Aaron 2026-10-14)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgeCols } from '../../src/offers/ingest.js';
import type { Slot } from '../../src/offers/types.js';

const today = '2026-10-14';
const now = '2026-10-14T06:00:00.000Z';
const slot = (availability: Slot['availability'], startDate: string, endDate: string): Slot => ({
  key: `${availability}|${startDate}`, startDate, endDate, unit: null, price: 100, currency: 'EUR', priceUnit: 'per_night',
  priceBasis: 'room', occupancy: 2, availability, availabilityText: null, spotsLeft: null,
});
const stay = { kind: 'accommodation' as const };

test('badges: open future date on a live, instant site -> both badges', () => {
  assert.deepEqual(badgeCols({ ...stay, liveAvailability: true, instantBooking: true }, [slot('limited', '2026-11-07', '2026-11-14')], today, true, now),
    { live_availability: true, availability_checked_at: now, instant_booking: true });
});

test('badges: live engine with only sold-out, closed or unknown dates -> no badges, check time still moves', () => {
  const slots = [slot('sold_out', '2026-11-07', '2026-11-14'), slot('closed', '2026-12-05', '2026-12-12'), slot('unknown', '2027-01-09', '2027-01-16')];
  assert.deepEqual(badgeCols({ ...stay, liveAvailability: true, instantBooking: true }, slots, today, true, now),
    { live_availability: false, availability_checked_at: now, instant_booking: false });
});

test('badges: only past open dates -> no badges', () => {
  assert.equal(badgeCols({ ...stay, liveAvailability: true, instantBooking: true }, [slot('available', '2026-09-01', '2026-09-30')], today, true, now).live_availability, false);
});

test('badges: live but request-only site -> live badge, no instant badge', () => {
  assert.deepEqual(badgeCols({ ...stay, liveAvailability: true, instantBooking: false }, [slot('available', '2026-11-07', '2026-11-14')], today, true, now),
    { live_availability: true, availability_checked_at: now, instant_booking: false });
});

test('badges: incomplete live run keeps the last state', () => {
  assert.deepEqual(badgeCols({ ...stay, liveAvailability: true, instantBooking: true }, [], today, false, now), {});
});

test('badges: non-live adapter never shows badges, even when the site books instantly', () => {
  assert.deepEqual(badgeCols({ ...stay, instantBooking: true }, [slot('unknown', '2026-11-01', '2026-11-30')], today, true, now),
    { live_availability: false, availability_checked_at: null, instant_booking: false });
});
