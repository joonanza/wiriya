import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCompleted, tripKm, periodRange, summarize, monthlySeries, upcomingJobs } from '../js/stats.js';

const now = new Date(2026, 10, 15, 12, 0); // 15 พ.ย. 2026
const cost = {
  energyType: 'fuel', fuelPrice: 30, kmPerLiter: 10, // 3 ฿/km
  maintenance: [{ cost: 1000, intervalKm: 1000 }],   // 1 ฿/km
  carPrice: 0, residualPct: 0, years: 1, kmPerYear: 1000,
  insurancePerYear: 0, taxCompulsoryPerYear: 0, otherPerYear: 0,
  deadheadPct: 0.5, marginPct: 0, driverHourly: 0, returnFactor: 0,
};
const Q = (o) => ({ status: 'done', distance_km: 10, fare_quoted: 200, options: {}, created_at: '2026-11-10T08:00:00', ...o });

test('isCompleted: done always, confirmed only after pickup time', () => {
  assert.equal(isCompleted(Q({}), now), true);
  assert.equal(isCompleted(Q({ status: 'confirmed', pickup_at: '2026-11-14T08:00:00' }), now), true);
  assert.equal(isCompleted(Q({ status: 'confirmed', pickup_at: '2026-11-20T08:00:00' }), now), false);
  assert.equal(isCompleted(Q({ status: 'sent' }), now), false);
});

test('tripKm doubles round trips', () => {
  assert.equal(tripKm(Q({ options: { roundTrip: true } })), 20);
});

test('summarize: revenue, km, deadhead-based cost, expenses, profits', () => {
  const quotes = [
    Q({}),
    Q({ distance_km: 20, fare_quoted: 400, options: { tollBaht: 50, roundTrip: false } }),
    Q({ status: 'cancelled', fare_quoted: 999 }),
    Q({ created_at: '2026-10-01T08:00:00' }), // เดือนก่อน
  ];
  const expenses = [
    { date: '2026-11-03', category: 'charge', amount: 100 },
    { date: '2026-11-04', category: 'tires', amount: 50 },
    { date: '2026-10-04', category: 'tires', amount: 999 },
  ];
  const s = summarize(quotes, expenses, cost, periodRange('month', now), now);
  assert.equal(s.trips, 2);
  assert.equal(s.km, 30);
  assert.equal(s.revenue, 600);
  assert.equal(s.netRevenue, 550);           // หักทางด่วน
  assert.equal(s.totalKm, 45);               // + รถเปล่า 50%
  assert.ok(Math.abs(s.est.total - 45 * 4) < 1e-9); // (3 + 1) ฿/km
  assert.equal(s.actualTotal, 150);
  assert.equal(s.cashProfit, 400);
  assert.ok(Math.abs(s.estProfit - (550 - 180)) < 1e-9);
});

test('monthlySeries returns n months oldest first', () => {
  const m = monthlySeries([Q({}), Q({ created_at: '2026-10-01T08:00:00' })], 3, now);
  assert.equal(m.length, 3);
  assert.deepEqual(m.map((x) => x.trips), [0, 1, 1]);
});

test('upcomingJobs sorted by pickup time', () => {
  const u = upcomingJobs([
    Q({ status: 'confirmed', pickup_at: '2026-11-22T08:00:00', id: 'b' }),
    Q({ status: 'confirmed', pickup_at: '2026-11-16T08:00:00', id: 'a' }),
    Q({ status: 'confirmed', pickup_at: '2026-11-01T08:00:00', id: 'past' }),
  ], now);
  assert.deepEqual(u.map((q) => q.id), ['a', 'b']);
});
