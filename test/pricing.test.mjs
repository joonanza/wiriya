import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tieredDistanceCharge, timeMultiplier, calculateFare } from '../js/pricing.js';
import { computeCostPerKm, recommendRates, blendedKwhRate, DEFAULT_COST_INPUTS } from '../js/cost.js';
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
}, {
  charging: { rangeKm: 280, minutesPerStop: 30, billTime: false },
  vehicles: [
    { id: 'sedan', name: 'sedan', seats: 4, multiplier: 1.0 },
    { id: 'van', name: 'van', seats: 10, multiplier: 1.6 },
  ],
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

test('EV charging stops: info only by default, billable when enabled', () => {
  const t = { distanceKm: 300, durationMin: 240, vehicleId: 'sedan', datetime: noon };
  const info = calculateFare(cfg, t);
  assert.equal(info.chargeStops, 1);
  assert.equal(info.chargeMinutes, 30);
  const billed = calculateFare({ ...cfg, charging: { ...cfg.charging, billTime: true } }, t);
  assert.equal(billed.total - info.total, 60); // 30 min × 2 ฿
  assert.equal(calculateFare(cfg, { ...t, distanceKm: 280 }).chargeStops, 0);
  assert.equal(calculateFare(cfg, { ...t, distanceKm: 300, roundTrip: true }).chargeStops, 2);
});

test('EV cost model (Omoda C5 EV defaults)', () => {
  assert.equal(DEFAULT_COST_INPUTS.energyType, 'ev');
  assert.ok(Math.abs(blendedKwhRate(DEFAULT_COST_INPUTS) - 4.35) < 1e-9); // 0.7×3.0 + 0.3×7.5
  const c = computeCostPerKm(DEFAULT_COST_INPUTS);
  assert.ok(Math.abs(c.energy - 0.696) < 1e-9);                       // 16/100 × 4.35
  assert.ok(Math.abs(c.depreciation - 649000 * 0.7 / 200000) < 1e-9); // 2.2715
  assert.ok(c.total > 4 && c.total < 5, `total=${c.total}`);
  const r = recommendRates(DEFAULT_COST_INPUTS);
  assert.equal(r.distanceTiers[0].rate, 7);
  assert.equal(r.perMinute, 2.5);
});

test('fuel mode still supported', () => {
  const c = computeCostPerKm({ ...DEFAULT_COST_INPUTS, energyType: 'fuel', fuelPrice: 35, kmPerLiter: 14 });
  assert.ok(Math.abs(c.energy - 2.5) < 1e-9);
});
