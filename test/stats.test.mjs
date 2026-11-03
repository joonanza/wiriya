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

import { findConflicts, busyMinutes } from '../js/stats.js';

test('busyMinutes accounts for round trip and waiting', () => {
  assert.equal(busyMinutes({ duration_min: 40, options: { roundTrip: true, waitHours: 1 } }), 140);
  assert.equal(busyMinutes({}), 60);
});

test('findConflicts: overlap with 30-min buffer, ignores other statuses and self', () => {
  const quotes = [
    { id: 'a', status: 'confirmed', pickup_at: '2026-12-01T02:00:00Z', duration_min: 60, options: {} },  // 09:00–10:00 ไทย
    { id: 'b', status: 'sent', pickup_at: '2026-12-01T04:20:00Z', duration_min: 30, options: {} },       // 11:20–11:50
    { id: 'c', status: 'cancelled', pickup_at: '2026-12-01T03:00:00Z', duration_min: 60, options: {} },
    { id: 'd', status: 'confirmed', pickup_at: '2026-12-01T08:00:00Z', duration_min: 60, options: {} },  // ไกล
  ];
  // ทริปใหม่ 10:15–11:00 ไทย → ชน a (เผื่อ 30 นาที) และ b (11:00+30 = 11:30 > 11:20)
  const r = findConflicts(quotes, { start: new Date('2026-12-01T03:15:00Z'), busyMin: 45 });
  assert.deepEqual(r.map((x) => x.q.id), ['a', 'b']);
  // ไม่เผื่อเวลา → ไม่ชน
  assert.equal(findConflicts(quotes, { start: new Date('2026-12-01T03:15:00Z'), busyMin: 45 }, { bufferMin: 0 }).length, 0);
  // แก้ไขงาน a เอง → ไม่นับตัวเอง
  assert.deepEqual(findConflicts(quotes, { start: new Date('2026-12-01T02:00:00Z'), busyMin: 60 }, { excludeId: 'a' }).map((x) => x.q.id), []);
  assert.deepEqual(findConflicts(quotes, { start: new Date('invalid'), busyMin: 60 }), []);
});

import { monthGrid, jobsOnDay, jobsByDay, monthStats, monthTrend, dayKey } from '../js/stats.js';

test('monthGrid: Nov 2026 starts on Sunday, weeks of 7, trims empty trailing week', () => {
  const g = monthGrid(2026, 10);
  assert.equal(g[0][0].date.getDate(), 1);           // 1 พ.ย. 2569 เป็นวันอาทิตย์
  assert.ok(g.every((w) => w.length === 7));
  assert.equal(g.length, 5);                          // 1–30 พ.ย. ใช้ 5 สัปดาห์
  const feb = monthGrid(2026, 1);                     // ก.พ. 2026 เริ่มวันอาทิตย์ 28 วัน = 4 สัปดาห์พอดี
  assert.equal(feb.length, 4);
});

test('jobsOnDay / jobsByDay ignore drafts and cancelled', () => {
  const qs = [
    { id: 1, status: 'confirmed', pickup_at: new Date(2026, 10, 5, 9).toISOString() },
    { id: 2, status: 'sent', pickup_at: new Date(2026, 10, 5, 7).toISOString() },
    { id: 3, status: 'cancelled', pickup_at: new Date(2026, 10, 5, 8).toISOString() },
    { id: 4, status: 'draft', pickup_at: new Date(2026, 10, 6, 8).toISOString() },
  ];
  assert.deepEqual(jobsOnDay(qs, new Date(2026, 10, 5)).map((q) => q.id), [2, 1]);
  const m = jobsByDay(qs, 2026, 10);
  assert.equal(m.get(dayKey(new Date(2026, 10, 5))).length, 2);
  assert.equal(m.has(dayKey(new Date(2026, 10, 6))), false);
});

test('monthStats counts confirmed+done in month incl. upcoming; monthTrend spans n months', () => {
  const now = new Date(2026, 10, 15, 12);
  const qs = [
    { status: 'done', pickup_at: new Date(2026, 10, 3, 9).toISOString(), fare_quoted: 300, distance_km: 10, options: {} },
    { status: 'confirmed', pickup_at: new Date(2026, 10, 20, 9).toISOString(), fare_quoted: 500, distance_km: 20, options: { roundTrip: true } },
    { status: 'sent', pickup_at: new Date(2026, 10, 21, 9).toISOString(), fare_quoted: 999 },
    { status: 'done', pickup_at: new Date(2026, 9, 3, 9).toISOString(), fare_quoted: 200, distance_km: 5, options: {} },
  ];
  const s = monthStats(qs, 2026, 10, now);
  assert.deepEqual([s.jobs, s.done, s.upcoming, s.revenue, s.revenueDone, s.km], [2, 1, 1, 800, 300, 50]);
  const t = monthTrend(qs, 2026, 10, 6, now);
  assert.equal(t.length, 6);
  assert.deepEqual(t.slice(-2).map((x) => x.jobs), [1, 2]);
});

test('multi-day charter appears on each calendar day and blocks conflicts', () => {
  const q = { id: 'c', status: 'confirmed', pickup_at: new Date(2026, 10, 10, 8).toISOString(), options: { charter: { type: 'full', days: 3, hours: 10 } } };
  const m = jobsByDay([q], 2026, 10);
  assert.deepEqual([10, 11, 12, 13].map((d) => m.has(dayKey(new Date(2026, 10, d)))), [true, true, true, false]);
  assert.equal(jobsOnDay([q], new Date(2026, 10, 12)).length, 1);
  assert.equal(findConflicts([q], { start: new Date(2026, 10, 11, 9), busyMin: 60 }).length, 1);
  assert.equal(busyMinutes(q), (2 * 24 + 10) * 60);                                            // 10 พ.ย. 08:00 → 12 พ.ย. 18:00
  assert.equal(findConflicts([q], { start: new Date(2026, 10, 12, 19), busyMin: 60 }, { bufferMin: 30 }).length, 0); // เลิกงานแล้ว
});
