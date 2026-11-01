import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tieredDistanceCharge, timeMultiplier, calculateFare } from '../js/pricing.js';
import { computeCostPerKm, recommendRates, DEFAULT_COST_INPUTS } from '../js/cost.js';
import { buildFareConfig } from '../js/config.js';

const tiers = [{ upToKm: 30, rate: 10 }, { upToKm: 100, rate: 9 }, { upToKm: null, rate: 8 }];

test('tiered distance: within first tier', () => {
  assert.equal(tieredDistanceCharge(12, tiers).charge, 120);
});

test('tiered distance: spans all tiers', () => {
  // 30×10 + 70×9 + 50×8 = 300 + 630 + 400
  assert.equal(tieredDistanceCharge(150, tiers).charge, 1330);
});

test('tiered distance: zero km', () => {
  assert.equal(tieredDistanceCharge(0, tiers).charge, 0);
});

const cfg = buildFareConfig({
  perMinute: 2, distanceTiers: tiers, minFare: 100, returnPerKm: 4,
});

test('time multiplier: night wraps midnight, not stacked with peak', () => {
  assert.equal(timeMultiplier(cfg, new Date(2026, 10, 2, 23, 0)).multiplier, 1.2); // Mon 23:00
  assert.equal(timeMultiplier(cfg, new Date(2026, 10, 2, 3, 0)).multiplier, 1.2);  // Mon 03:00
  assert.equal(timeMultiplier(cfg, new Date(2026, 10, 2, 8, 0)).multiplier, 1.15); // Mon peak
  assert.equal(timeMultiplier(cfg, new Date(2026, 10, 1, 8, 0)).multiplier, 1);    // Sun no peak
  assert.equal(timeMultiplier(cfg, new Date(2026, 10, 2, 13, 0)).multiplier, 1);
});

const noon = new Date(2026, 10, 2, 13, 0);

test('basic fare: 20 km, 40 min, sedan, midday', () => {
  // 40 + 200 + 80 = 320 → round to 10 → 320
  const f = calculateFare(cfg, { distanceKm: 20, durationMin: 40, vehicleId: 'sedan', datetime: noon });
  assert.equal(f.total, 320);
});

test('minimum fare applies to short trips', () => {
  const f = calculateFare(cfg, { distanceKm: 1, durationMin: 3, vehicleId: 'sedan', datetime: noon });
  assert.equal(f.total, 100);
});

test('toll is added after rounding and minimum', () => {
  const f = calculateFare(cfg, { distanceKm: 1, durationMin: 3, vehicleId: 'sedan', datetime: noon, tollBaht: 75 });
  assert.equal(f.total, 175);
  assert.equal(f.fareExToll, 100);
});

test('long one-way trip adds deadhead return; round trip does not', () => {
  const oneWay = calculateFare(cfg, { distanceKm: 100, durationMin: 90, vehicleId: 'sedan', datetime: noon });
  // run = 40 + (300 + 630) + 180 = 1150; return = (100-60)×4 = 160 → 1310
  assert.equal(oneWay.total, 1310);
  const rt = calculateFare(cfg, { distanceKm: 100, durationMin: 90, vehicleId: 'sedan', datetime: noon, roundTrip: true });
  // 200 km, 180 min: 40 + 300 + 630 + 800 + 360 = 2130
  assert.equal(rt.total, 2130);
});

test('vehicle multiplier, wait and airport', () => {
  const f = calculateFare(cfg, {
    distanceKm: 20, durationMin: 40, vehicleId: 'van', datetime: noon, waitHours: 1, airport: true,
  });
  // 320 × 1.6 = 512 + 150 + 50 = 712 → 720
  assert.equal(f.total, 720);
});

test('cost model with defaults is in a sane range', () => {
  const c = computeCostPerKm(DEFAULT_COST_INPUTS);
  assert.ok(Math.abs(c.fuel - 2.5) < 1e-9);
  assert.ok(Math.abs(c.depreciation - 1.8) < 1e-9);
  assert.ok(c.total > 5 && c.total < 7, `total=${c.total}`);
  const r = recommendRates(DEFAULT_COST_INPUTS);
  assert.ok(r.distanceTiers[0].rate >= 8 && r.distanceTiers[0].rate <= 10);
  assert.equal(r.perMinute, 2.5);
});
