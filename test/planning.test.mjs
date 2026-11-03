import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCharter, DEFAULT_CHARTER, batteryPlan, progressiveTax, taxComparison,
  calibrateFromExpenses, estimateOdometer, maintenanceDue,
} from '../js/planning.js';

test('charter: full day within included km', () => {
  const r = calculateCharter(DEFAULT_CHARTER, { type: 'full', days: 1, estKm: 200 });
  assert.equal(r.total, 2500);
});

test('charter: 2 days, extra km, overtime, overnight, toll', () => {
  const r = calculateCharter(DEFAULT_CHARTER, { type: 'full', days: 2, estKm: 600, overtimeHours: 2, overnight: true, tollBaht: 120 });
  // 5000 + (600-500)×8=800 + 2×300=600 + 1 คืน 500 = 6900 + toll 120
  assert.equal(r.fareExToll, 6900);
  assert.equal(r.total, 7020);
  assert.equal(r.min, (10 + 2) * 60 * 2);
});

test('charter: half day uses half plan', () => {
  const r = calculateCharter(DEFAULT_CHARTER, { type: 'half', days: 1, estKm: 150 });
  assert.equal(r.total, 1500 + 30 * 8);
});

test('battery: round trip feasible vs needs charging', () => {
  const ok = batteryPlan({ socPct: 90, batteryKwh: 50.6, kwhPer100km: 14.4, tripKm: 100, returnKm: 100, reservePct: 15 });
  // ใช้ 28.8 kWh จาก 45.54 → เหลือ 16.74 kWh = 33%
  assert.ok(ok.ok);
  assert.ok(Math.abs(ok.endPct - 33.08) < 0.1);
  const no = batteryPlan({ socPct: 60, batteryKwh: 50.6, kwhPer100km: 14.4, tripKm: 150, returnKm: 150, reservePct: 15 });
  assert.equal(no.ok, false);
  assert.ok(no.chargeNeededKwh > 0 && no.chargeMinutes > 0);
  assert.ok(Math.abs(no.rangeKm - (50.6 * 0.45) / 0.144) < 0.5);
});

test('progressive tax brackets', () => {
  assert.equal(progressiveTax(150000), 0);
  assert.equal(progressiveTax(300000), 7500);
  assert.equal(progressiveTax(500000), 27500);
  assert.equal(progressiveTax(1000000), 115000);
});

test('tax comparison: flat 60% vs actual; picks lower', () => {
  const r = taxComparison({ income: 600000, actualExpenses: 200000, allowances: 60000 });
  // เหมา: 600k-360k-60k = 180k → 1,500 · จริง: 600k-200k-60k = 340k → 7,500+4,000 = 11,500
  assert.equal(r.flat.net, 180000);
  assert.equal(r.flat.tax, 1500);
  assert.equal(r.actual.tax, 11500);
  assert.equal(r.best, 'flat');
  const r2 = taxComparison({ income: 600000, actualExpenses: 450000, allowances: 60000 });
  assert.equal(r2.best, 'actual');
});

test('tax: minimum tax method 2 (0.5%) applies when higher', () => {
  // รายได้ 2,000,000 หักเหมา → 800k - 60k = 740k → method1 = 63,500 ; method2 = 10,000 → ใช้ 1
  const a = taxComparison({ income: 2000000, actualExpenses: 0, allowances: 60000 });
  assert.equal(a.flat.method, 1);
  // ค่าใช้จ่ายจริงสูงมาก → method1 ~0, method2 = 10,000 → ใช้ 2
  const b = taxComparison({ income: 2000000, actualExpenses: 1990000, allowances: 60000 });
  assert.equal(b.actual.tax, 10000);
  assert.equal(b.actual.method, 2);
  assert.equal(a.vatWarning, true);
});

test('tax: extra tax on top of salary', () => {
  const r = taxComparison({ income: 300000, actualExpenses: 0, otherNetIncome: 500000, allowances: 100000 });
  // เงินเดือนสุทธิ 400k → 17,500 ; + ขับรถ 120k → 520k → 30,500 ; ส่วนเพิ่ม 13,000
  assert.equal(r.flat.extraTax, 13000);
});

const EXP = [
  { date: '2026-09-01', category: 'other', amount: 0, odometer_km: 10000 },
  { date: '2026-09-10', category: 'charge', amount: 300, kwh: 60 },
  { date: '2026-09-20', category: 'charge', amount: 280, kwh: 56 },
  { date: '2026-09-25', category: 'tires', amount: 400, item: 'สลับยาง', odometer_km: 10500 },
  { date: '2026-10-01', category: 'charge', amount: 300, kwh: 60, odometer_km: 11000 },
];

test('calibration: actual kWh/100 km, ฿/kWh, ฿/km from logs', () => {
  const r = calibrateFromExpenses(EXP, { energyType: 'ev', homeSharePct: 0.7, homeRate: 3, dcRate: 7.5 });
  assert.ok(r.ok);
  assert.equal(r.km, 1000);
  assert.ok(Math.abs(r.kwhPer100km - 17.6) < 1e-9);      // 176 kWh / 1000 km
  assert.ok(Math.abs(r.bahtPerKwh - 880 / 176) < 1e-9);
  assert.ok(Math.abs(r.energyPerKm - 0.88) < 1e-9);
  assert.ok(Math.abs(r.maintenancePerKm - 0.4) < 1e-9);
  assert.equal(calibrateFromExpenses([EXP[0]], {}).ok, false);
});

test('odometer estimate adds completed trips after last reading (+deadhead)', () => {
  const quotes = [
    { status: 'done', pickup_at: '2026-10-05T03:00:00Z', distance_km: 50, options: {} },
    { status: 'done', pickup_at: '2026-09-20T03:00:00Z', distance_km: 999, options: {} }, // ก่อนเลขไมล์ล่าสุด
    { status: 'confirmed', pickup_at: '2026-10-06T03:00:00Z', distance_km: 25, options: { roundTrip: true } },
  ];
  const o = estimateOdometer(EXP, quotes, 0.3, new Date('2026-11-01T00:00:00Z'));
  assert.equal(o.reading, 11000);
  assert.equal(o.estimated, 11000 + Math.round(100 * 1.3));
});

test('maintenance due: from last service or interval multiples', () => {
  const items = [{ name: 'สลับยาง', intervalKm: 10000 }, { name: 'เช็กระยะ', intervalKm: 20000 }];
  const d = maintenanceDue(items, EXP, 19800);
  const rot = d.find((x) => x.name === 'สลับยาง');
  assert.equal(rot.dueAt, 20500);
  assert.equal(rot.status, 'soon');
  const svc = d.find((x) => x.name === 'เช็กระยะ');
  assert.equal(svc.noHistory, true);
  assert.equal(svc.dueAt, 20000);
  assert.equal(d[0].name, 'เช็กระยะ'); // เหลือน้อยกว่า → ขึ้นก่อน
  assert.equal(maintenanceDue(items, [], 21000).find((x) => x.name === 'เช็กระยะ').dueAt, 40000);
  assert.deepEqual(maintenanceDue(items, [], null), []);
});

test('taxComparison: ค่าใช้จ่ายจริงหักได้ไม่เกินรายได้ ภาษีส่วนเพิ่มไม่ติดลบ', () => {
  const t = taxComparison({ income: 50000, actualExpenses: 200000, otherNetIncome: 400000, allowances: 60000 });
  assert.equal(t.actual.expense, 50000);
  assert.ok(t.actual.extraTax >= 0);
});
