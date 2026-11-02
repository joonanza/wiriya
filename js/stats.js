// ===== สถิติสำหรับหน้าแรก / แดชบอร์ด (pure functions, test ได้ใน Node) =====
import { computeCostPerKm } from './cost.js';

export const EXPENSE_CATEGORIES = {
  charge: 'ชาร์จไฟ',
  maintenance: 'บำรุงรักษา/ซ่อม',
  tires: 'ยาง',
  insurance: 'ประกัน/ภาษี',
  toll: 'ทางด่วน/ที่จอด',
  other: 'อื่น ๆ',
};

/** วันที่อ้างอิงของงาน = เวลารับ (ถ้ามี) ไม่งั้นใช้เวลาสร้าง */
export const tripDate = (q) => new Date(q.pickup_at || q.created_at);

/** งานที่วิ่งจริงแล้ว: เสร็จสิ้น หรือ ยืนยันแล้วและเลยเวลารับมาแล้ว */
export function isCompleted(q, now = new Date()) {
  if (q.status === 'done') return true;
  return q.status === 'confirmed' && tripDate(q) <= now;
}

/** ระยะทางที่มีผู้โดยสาร (รวมไป-กลับ) */
export const tripKm = (q) => (Number(q.distance_km) || 0) * (q.options?.roundTrip ? 2 : 1);

export function periodRange(key, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth();
  switch (key) {
    case 'today': return { from: new Date(y, m, now.getDate()), to: new Date(y, m, now.getDate() + 1) };
    case 'month': return { from: new Date(y, m, 1), to: new Date(y, m + 1, 1) };
    case 'lastMonth': return { from: new Date(y, m - 1, 1), to: new Date(y, m, 1) };
    case '3m': return { from: new Date(y, m - 2, 1), to: new Date(y, m + 1, 1) };
    case 'year': return { from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1) };
    default: return { from: new Date(0), to: new Date(8.64e15) };
  }
}
const inRange = (d, r) => d >= r.from && d < r.to;
const expDate = (e) => new Date(`${e.date}T00:00:00`);

/**
 * สรุปผลในช่วงเวลา
 * - ต้นทุนประมาณจากโมเดลต้นทุนรถ: คิดจากระยะที่มีผู้โดยสาร × (1 + ระยะรถเปล่า%)
 * - ค่าใช้จ่ายจริง: จากรายการที่บันทึก
 */
export function summarize(quotes, expenses, costInputs, range, now = new Date()) {
  const trips = quotes.filter((q) => isCompleted(q, now) && inRange(tripDate(q), range));
  const km = trips.reduce((s, q) => s + tripKm(q), 0);
  const revenue = trips.reduce((s, q) => s + (Number(q.fare_quoted) || 0), 0);
  const toll = trips.reduce((s, q) => s + (Number(q.options?.tollBaht) || 0), 0);
  const deadheadKm = km * (costInputs.deadheadPct || 0);
  const totalKm = km + deadheadKm;
  const cpk = computeCostPerKm(costInputs);
  const est = {
    energy: cpk.energy * totalKm,
    maintenance: cpk.maintenance * totalKm,
    depreciation: cpk.depreciation * totalKm,
    fixed: cpk.fixed * totalKm,
  };
  est.total = est.energy + est.maintenance + est.depreciation + est.fixed;
  const exp = expenses.filter((e) => inRange(expDate(e), range));
  const actualByCat = Object.fromEntries(Object.keys(EXPENSE_CATEGORIES).map((k) => [k, 0]));
  for (const e of exp) actualByCat[e.category in actualByCat ? e.category : 'other'] += Number(e.amount) || 0;
  const actualTotal = Object.values(actualByCat).reduce((a, b) => a + b, 0);
  const netRevenue = revenue - toll;
  return {
    trips: trips.length,
    km, deadheadKm, totalKm,
    revenue, toll, netRevenue,
    avgFare: trips.length ? revenue / trips.length : 0,
    perKm: km ? netRevenue / km : 0,
    est,
    estProfit: netRevenue - est.total,
    actualByCat, actualTotal,
    cashProfit: netRevenue - actualTotal,
    hours: trips.reduce((s, q) => s + (Number(q.duration_min) || 0) * (q.options?.roundTrip ? 2 : 1), 0) / 60,
  };
}

/** รายได้/ระยะทาง/จำนวนเที่ยว ย้อนหลัง n เดือน (เก่า → ใหม่) */
export function monthlySeries(quotes, n = 6, now = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const from = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const to = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const trips = quotes.filter((q) => isCompleted(q, now) && inRange(tripDate(q), { from, to }));
    out.push({
      label: from.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' }),
      revenue: trips.reduce((s, q) => s + (Number(q.fare_quoted) || 0), 0),
      km: trips.reduce((s, q) => s + tripKm(q), 0),
      trips: trips.length,
    });
  }
  return out;
}

/** งานที่จะถึง (ยืนยันแล้ว เวลารับยังไม่ถึง) เรียงตามเวลา */
export function upcomingJobs(quotes, now = new Date(), limit = 5) {
  return quotes
    .filter((q) => q.status === 'confirmed' && q.pickup_at && new Date(q.pickup_at) > now)
    .sort((a, b) => new Date(a.pickup_at) - new Date(b.pickup_at))
    .slice(0, limit);
}

/** ช่วงเวลาที่รถไม่ว่างของงานหนึ่ง (นาที): เวลาเดินทาง (×2 ถ้าไป-กลับ) + ค่ารอ */
export function busyMinutes(q) {
  const o = q.options || {};
  return (Number(q.duration_min) || 60) * (o.roundTrip ? 2 : 1) + (Number(o.waitHours) || 0) * 60;
}

/**
 * หางานที่เวลาชนกับทริปใหม่
 * @param quotes   รายการงานทั้งหมด
 * @param trip     { start: Date, busyMin: number }
 * @param opts     { excludeId, bufferMin = 30 (เผื่อเวลาเดินทางไปจุดรับ), statuses = ['confirmed','sent'] }
 * @returns [{ q, start: Date, end: Date }] เรียงตามเวลา
 */
export function findConflicts(quotes, trip, { excludeId = null, bufferMin = 30, statuses = ['confirmed', 'sent'] } = {}) {
  if (!(trip?.start instanceof Date) || Number.isNaN(trip.start.getTime())) return [];
  const aStart = trip.start.getTime() - bufferMin * 60000;
  const aEnd = trip.start.getTime() + (trip.busyMin || 60) * 60000 + bufferMin * 60000;
  return quotes
    .filter((q) => q.id !== excludeId && statuses.includes(q.status) && q.pickup_at)
    .map((q) => {
      const start = new Date(q.pickup_at);
      return { q, start, end: new Date(start.getTime() + busyMinutes(q) * 60000) };
    })
    .filter(({ start, end }) => start.getTime() < aEnd && aStart < end.getTime())
    .sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------- หน้าแรก: ปฏิทิน + สรุปรายเดือน
const CAL_STATUSES = ['request', 'sent', 'confirmed', 'done'];
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** ตารางปฏิทิน 6 สัปดาห์ (เริ่มวันอาทิตย์) ของเดือนที่กำหนด */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      days.push({ date, inMonth: date.getMonth() === month });
    }
    weeks.push(days);
  }
  // ตัดสัปดาห์สุดท้ายที่ไม่มีวันของเดือนนี้เลย
  while (weeks.length > 4 && weeks.at(-1).every((x) => !x.inMonth)) weeks.pop();
  return weeks;
}

/** งานที่เวลารับตรงกับวันนั้น (ไม่รวมร่าง/ยกเลิก) เรียงตามเวลา */
export function jobsOnDay(quotes, date) {
  return quotes
    .filter((q) => q.pickup_at && CAL_STATUSES.includes(q.status) && sameDay(new Date(q.pickup_at), date))
    .sort((a, b) => new Date(a.pickup_at) - new Date(b.pickup_at));
}

/** map dayKey → งานในเดือนนั้น (ใช้วาดจุดบนปฏิทิน) */
export function jobsByDay(quotes, year, month) {
  const map = new Map();
  for (const q of quotes) {
    if (!q.pickup_at || !CAL_STATUSES.includes(q.status)) continue;
    const d = new Date(q.pickup_at);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const k = dayKey(d);
    (map.get(k) || map.set(k, []).get(k)).push(q);
  }
  return map;
}

/** สรุปงานที่ยืนยัน/เสร็จในเดือน (นับตามเวลารับ รวมงานที่จะถึง) */
export function monthStats(quotes, year, month, now = new Date()) {
  const inMonth = quotes.filter((q) => (q.status === 'confirmed' || q.status === 'done') && q.pickup_at
    && new Date(q.pickup_at).getFullYear() === year && new Date(q.pickup_at).getMonth() === month);
  const done = inMonth.filter((q) => isCompleted(q, now));
  const sum = (arr) => arr.reduce((s, q) => s + (Number(q.fare_quoted) || 0), 0);
  return {
    jobs: inMonth.length,
    done: done.length,
    upcoming: inMonth.length - done.length,
    revenue: sum(inMonth),
    revenueDone: sum(done),
    km: inMonth.reduce((s, q) => s + tripKm(q), 0),
  };
}

/** ข้อมูลกราฟย้อนหลัง n เดือน สิ้นสุดที่เดือนที่เลือก */
export function monthTrend(quotes, year, month, n = 6, now = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(year, month - i, 1);
    const s = monthStats(quotes, d.getFullYear(), d.getMonth(), now);
    out.push({ year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleDateString('th-TH', { month: 'short' }), ...s });
  }
  return out;
}
