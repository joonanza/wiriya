// ===== เครื่องมือวางแผน: เหมาวัน · แบต EV · ภาษี · ปรับโมเดลต้นทุน · บำรุงรักษาตามเลขไมล์ =====
// pure functions ทั้งหมด (test ได้ใน Node)

const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);

// ---------------------------------------------------------------- 3) เหมาวัน
export const DEFAULT_CHARTER = Object.freeze({
  full: { label: 'เต็มวัน', price: 2500, hours: 10, includedKm: 250 },
  half: { label: 'ครึ่งวัน', price: 1500, hours: 5, includedKm: 120 },
  extraKmRate: 8,        // ฿/km ที่เกินระยะรวม
  overtimePerHour: 300,  // ฿/ชม. ที่เกินเวลา
  overnightPerNight: 500, // ค่าที่พักคนขับต่อคืน (เหมาหลายวันต่างจังหวัด)
  roundTo: 10,
});

/**
 * ราคาเหมา
 * @param charter  ค่าตั้ง (DEFAULT_CHARTER)
 * @param trip     { type:'full'|'half', days, estKm (รวมทั้งทริป), overtimeHours, overnight:boolean, tollBaht }
 */
export function calculateCharter(charter, trip) {
  const c = { ...DEFAULT_CHARTER, ...(charter || {}) };
  const plan = c[trip.type === 'half' ? 'half' : 'full'] || DEFAULT_CHARTER.full;
  const days = Math.max(1, Math.round(num(trip.days, 1)));
  const lines = [];
  const add = (label, amount, note) => { if (Math.abs(amount) >= 0.005) lines.push({ label, amount, note }); };
  add(`เหมา${plan.label} ${days} วัน`, plan.price * days, `${plan.price.toLocaleString('th-TH')} ฿/วัน · ${plan.hours} ชม. · รวม ${plan.includedKm} km/วัน`);
  const includedKm = plan.includedKm * days;
  const extraKm = Math.max(0, num(trip.estKm) - includedKm);
  add(`ระยะเกิน ${Math.round(extraKm)} km`, extraKm * c.extraKmRate, `${c.extraKmRate} ฿/km (รวมให้แล้ว ${includedKm} km)`);
  const ot = Math.max(0, num(trip.overtimeHours));
  add(`เกินเวลา ${ot} ชม.`, ot * c.overtimePerHour, `${c.overtimePerHour} ฿/ชม.`);
  const nights = trip.overnight ? Math.max(0, days - 1) : 0;
  add(`ค่าที่พักคนขับ ${nights} คืน`, nights * c.overnightPerNight, `${c.overnightPerNight} ฿/คืน`);
  const sub = lines.reduce((s, l) => s + l.amount, 0);
  const step = c.roundTo || 1;
  const rounded = Math.ceil(sub / step - 1e-9) * step;
  add('ปัดเศษ', rounded - sub, `ปัดขึ้นทีละ ${step} ฿`);
  const toll = Math.max(0, num(trip.tollBaht));
  add('ค่าทางด่วน (ตามจริง)', toll);
  return {
    total: rounded + toll, fareExToll: rounded, lines,
    km: Math.max(num(trip.estKm), 0), min: (plan.hours + ot) * 60 * days,
    days, plan, includedKm, extraKm,
  };
}

// ---------------------------------------------------------------- 5) วางแผนแบต EV
/**
 * @param p { socPct, batteryKwh, kwhPer100km (ที่แบต), tripKm, returnKm, reservePct, dcKw }
 * @returns { usedKwh, endPct, ok, chargeNeededKwh, chargeMinutes, rangeKm }
 */
export function batteryPlan(p) {
  const cap = Math.max(1, num(p.batteryKwh, 50.6));
  const per = Math.max(1, num(p.kwhPer100km, 14.4)) / 100;
  const soc = Math.min(100, Math.max(0, num(p.socPct, 100)));
  const reserve = Math.min(50, Math.max(0, num(p.reservePct, 15)));
  const km = Math.max(0, num(p.tripKm)) + Math.max(0, num(p.returnKm));
  const usedKwh = km * per;
  const startKwh = (cap * soc) / 100;
  const endKwh = startKwh - usedKwh;
  const endPct = (endKwh / cap) * 100;
  const reserveKwh = (cap * reserve) / 100;
  const chargeNeededKwh = Math.max(0, reserveKwh - endKwh);
  const dcKw = Math.max(1, num(p.dcKw, 60));
  return {
    usedKwh, endPct, ok: endKwh >= reserveKwh,
    chargeNeededKwh,
    // ชาร์จ DC ช่วง 20–80% เฉลี่ย ~60 kW (เผื่อประสิทธิภาพ 90%)
    chargeMinutes: chargeNeededKwh > 0 ? Math.ceil((chargeNeededKwh / (dcKw * 0.9)) * 60) : 0,
    rangeKm: Math.max(0, (startKwh - reserveKwh) / per),
  };
}

// ---------------------------------------------------------------- 4) ภาษีเงินได้บุคคลธรรมดา (ประมาณการ)
// ขั้นบันไดภาษี (เงินได้สุทธิ) — ใช้ตั้งแต่ปีภาษี 2560
const BRACKETS = [[150000, 0], [300000, 0.05], [500000, 0.10], [750000, 0.15], [1000000, 0.20], [2000000, 0.25], [5000000, 0.30], [Infinity, 0.35]];
export function progressiveTax(netIncome) {
  let tax = 0, prev = 0;
  const n = Math.max(0, num(netIncome));
  for (const [cap, rate] of BRACKETS) {
    if (n <= prev) break;
    tax += (Math.min(n, cap) - prev) * rate;
    prev = cap;
  }
  return tax;
}

/**
 * เปรียบเทียบหักค่าใช้จ่ายแบบเหมา 60% กับตามจริง (เงินได้ 40(8))
 * @param p { income (รายได้ขับรถทั้งปี), actualExpenses, otherNetIncome (เงินได้สุทธิอื่น หลังหักค่าใช้จ่าย เช่น เงินเดือน), allowances (ค่าลดหย่อนรวม), otherIncome2to8 (เงินได้ 40(2)-(8) อื่น สำหรับวิธีที่ 2) }
 */
export function taxComparison(p) {
  const income = Math.max(0, num(p.income));
  const allowances = Math.max(0, num(p.allowances, 60000));
  const otherNet = Math.max(0, num(p.otherNetIncome));
  const calc = (expense) => {
    const net = Math.max(0, income - expense + otherNet - allowances);
    const m1 = progressiveTax(net);
    // วิธีที่ 2: เงินได้ 40(2)-(8) รวม ≥ 120,000 → 0.5% ของเงินได้ (ถ้าไม่เกิน 5,000 ได้รับยกเว้น) เสียตามวิธีที่มากกว่า
    const gross28 = income + Math.max(0, num(p.otherIncome2to8));
    let m2 = gross28 >= 120000 ? gross28 * 0.005 : 0;
    if (m2 <= 5000) m2 = 0;
    const taxWithDriving = Math.max(m1, m2);
    const taxWithout = progressiveTax(Math.max(0, otherNet - allowances));
    return { expense, net, tax: taxWithDriving, method: m2 > m1 ? 2 : 1, extraTax: taxWithDriving - taxWithout };
  };
  const flat = calc(income * 0.6);
  // ค่าใช้จ่ายตามจริงหักได้ไม่เกินเงินได้ (ขาดทุนไม่นำไปหักเงินได้ประเภทอื่น)
  const actual = calc(Math.min(income, Math.max(0, num(p.actualExpenses))));
  return { income, flat, actual, best: actual.tax < flat.tax ? 'actual' : 'flat', vatWarning: income > 1800000 };
}

// ---------------------------------------------------------------- 7) ปรับโมเดลต้นทุนจากข้อมูลจริง
/**
 * ใช้บันทึกที่มีเลขไมล์ หาระยะที่วิ่งจริง แล้วเทียบค่าชาร์จ/ค่าบำรุงจริงต่อ km
 * expenses: [{ date, category, amount, odometer_km, kwh }]
 */
export function calibrateFromExpenses(expenses, costInputs) {
  const odo = expenses.filter((e) => num(e.odometer_km) > 0).sort((a, b) => num(a.odometer_km) - num(b.odometer_km));
  if (odo.length < 2) return { ok: false, reason: 'ต้องมีบันทึกที่ใส่เลขไมล์อย่างน้อย 2 รายการ (ห่างกันพอสมควร)' };
  const first = odo[0], last = odo.at(-1);
  const km = num(last.odometer_km) - num(first.odometer_km);
  if (km < 300) return { ok: false, reason: `ระยะระหว่างเลขไมล์แรก-ล่าสุดยังสั้น (${Math.round(km)} km) ควรมีอย่างน้อย 300 km` };
  const from = first.date, to = last.date;
  // ค่าชาร์จที่เติมหลังเลขไมล์แรก ถึงเลขไมล์ล่าสุด (พลังงานที่ใช้ในช่วงนั้น)
  const inRange = (e) => e.date > from && e.date <= to;
  const charges = expenses.filter((e) => e.category === 'charge' && inRange(e));
  const chargeBaht = charges.reduce((s, e) => s + num(e.amount), 0);
  const kwhLogged = charges.filter((e) => num(e.kwh) > 0);
  const kwh = kwhLogged.reduce((s, e) => s + num(e.kwh), 0);
  const maint = expenses.filter((e) => (e.category === 'maintenance' || e.category === 'tires') && e.date >= from && e.date <= to)
    .reduce((s, e) => s + num(e.amount), 0);
  const out = {
    ok: true, km, from, to,
    energyPerKm: chargeBaht / km,
    maintenancePerKm: maint / km,
    chargeBaht, maintBaht: maint,
  };
  // ถ้าบันทึก kWh ครบทุกครั้งที่ชาร์จ → ได้ kWh/100 km และ ฿/kWh จริง
  if (kwhLogged.length && kwhLogged.length === charges.length && kwh > 0) {
    out.kwhPer100km = (kwh / km) * 100;
    out.bahtPerKwh = chargeBaht / kwh;
  } else if (costInputs?.energyType === 'ev') {
    // ประมาณ kWh/100 km จากเงินที่จ่าย ÷ ราคาไฟเฉลี่ยในโมเดล
    const s = Math.min(1, Math.max(0, num(costInputs.homeSharePct)));
    const rate = s * num(costInputs.homeRate) + (1 - s) * num(costInputs.dcRate);
    if (rate > 0) out.kwhPer100kmEstimated = (chargeBaht / rate / km) * 100;
  }
  return out;
}

// ---------------------------------------------------------------- 8) บำรุงรักษาตามเลขไมล์
/**
 * เลขไมล์ปัจจุบันโดยประมาณ = เลขไมล์ล่าสุดที่บันทึก + ระยะงานที่เสร็จหลังจากวันนั้น × (1 + รถเปล่า%)
 */
export function estimateOdometer(expenses, quotes, deadheadPct = 0.3, now = new Date()) {
  const readings = expenses.filter((e) => num(e.odometer_km) > 0).sort((a, b) => (a.date || '').localeCompare(b.date || '') || num(a.odometer_km) - num(b.odometer_km));
  if (!readings.length) return null;
  const last = readings.at(-1);
  const since = new Date(`${last.date}T23:59:59`);
  const km = quotes
    .filter((q) => (q.status === 'done' || (q.status === 'confirmed' && q.pickup_at && new Date(q.pickup_at) <= now)) && q.pickup_at && new Date(q.pickup_at) > since)
    .reduce((s, q) => s + num(q.distance_km) * (q.options?.roundTrip ? 2 : 1), 0);
  return { reading: num(last.odometer_km), readingDate: last.date, estimated: Math.round(num(last.odometer_km) + km * (1 + deadheadPct)), addedKm: Math.round(km * (1 + deadheadPct)) };
}

/**
 * รายการบำรุงรักษาที่ต้องทำ เรียงจากใกล้ถึงที่สุด
 * items: costInputs.maintenance [{name, intervalKm}] · expenses ที่มี item = ชื่อรายการ + odometer_km = ทำล่าสุดที่เลขไมล์นั้น
 */
export function maintenanceDue(items, expenses, currentOdo, { warnKm = 1000 } = {}) {
  if (currentOdo == null) return [];
  return (items || []).filter((it) => num(it.intervalKm) > 0 && it.name).map((it) => {
    const done = expenses.filter((e) => e.item === it.name && num(e.odometer_km) > 0).sort((a, b) => num(b.odometer_km) - num(a.odometer_km))[0];
    const lastKm = done ? num(done.odometer_km) : null;
    const base = lastKm ?? 0;
    const interval = num(it.intervalKm);
    // ไม่มีประวัติ: นับรอบจากเลขไมล์ 0 (รอบถัดไปที่ยังไม่ถึง)
    const dueAt = lastKm != null ? base + interval : Math.ceil((currentOdo + 1) / interval) * interval;
    const remaining = dueAt - currentOdo;
    return {
      name: it.name, intervalKm: interval, lastKm, lastDate: done?.date || null, dueAt, remaining,
      status: remaining <= 0 ? 'overdue' : remaining <= warnKm ? 'soon' : 'ok', noHistory: lastKm == null,
    };
  }).sort((a, b) => a.remaining - b.remaining);
}
