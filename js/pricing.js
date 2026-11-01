// ===== Pricing engine (pure functions, ใช้ได้ทั้ง browser และ Node) =====
//
//   Fare = max(F_min, (F_base + Σ r_d,i·d_i + r_t·t) · k_vehicle · k_time + C_return + C_wait + C_airport)
//          → ปัดขึ้นทีละ roundTo บาท → + ค่าทางด่วน (คิดตามจริง ไม่ปัด)

/** คิดค่าระยะทางแบบขั้นบันได tiers = [{upToKm, rate}], upToKm = null คือไม่จำกัด */
export function tieredDistanceCharge(km, tiers) {
  let charge = 0;
  let prev = 0;
  const parts = [];
  for (const t of tiers) {
    if (km <= prev) break;
    const cap = t.upToKm == null ? Infinity : t.upToKm;
    const seg = Math.min(km, cap) - prev;
    if (seg > 0) {
      charge += seg * t.rate;
      parts.push({ fromKm: prev, toKm: prev + seg, rate: t.rate, amount: seg * t.rate });
    }
    prev = cap;
  }
  return { charge, parts };
}

const inHourRange = (h, start, end) => (start <= end ? h >= start && h < end : h >= start || h < end);

/** คืนค่าตัวคูณช่วงเวลา (เลือกค่าสูงสุด ไม่คูณซ้อน) */
export function timeMultiplier(cfg, date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return { multiplier: 1, label: null };
  const h = date.getHours() + date.getMinutes() / 60;
  const weekday = date.getDay() >= 1 && date.getDay() <= 5;
  let best = { multiplier: 1, label: null };
  const night = cfg.night;
  if (night && inHourRange(h, night.startHour, night.endHour) && night.multiplier > best.multiplier) {
    best = { multiplier: night.multiplier, label: 'กลางคืน' };
  }
  const peak = cfg.peak;
  if (peak && weekday && peak.multiplier > best.multiplier &&
      (peak.windows || []).some(([s, e]) => inHourRange(h, s, e))) {
    best = { multiplier: peak.multiplier, label: 'ชั่วโมงเร่งด่วน' };
  }
  return best;
}

/**
 * @param {object} cfg  fare config (ดู js/config.js)
 * @param {object} trip { distanceKm, durationMin, vehicleId, datetime(Date), roundTrip, waitHours, airport, tollBaht }
 */
export function calculateFare(cfg, trip) {
  const vehicle = cfg.vehicles.find((v) => v.id === trip.vehicleId) || cfg.vehicles[0];
  const legs = trip.roundTrip ? 2 : 1;
  const km = Math.max(0, trip.distanceKm || 0) * legs;
  const min = Math.max(0, trip.durationMin || 0) * legs;
  const lines = [];
  const add = (label, amount, note) => { if (Math.abs(amount) >= 0.005) lines.push({ label, amount, note }); };

  // 1) ค่าวิ่ง
  const dist = tieredDistanceCharge(km, cfg.distanceTiers);
  const timeCharge = min * cfg.perMinute;
  const runBase = cfg.baseFare + dist.charge + timeCharge;
  add('ค่าเรียกรถ', cfg.baseFare);
  add(`ค่าระยะทาง ${km.toFixed(1)} km`, dist.charge,
    dist.parts.map((p) => `${p.fromKm}–${p.toKm.toFixed(1)} km × ${p.rate} ฿`).join(', '));
  add(`ค่าเวลา ${Math.round(min)} นาที`, timeCharge, `× ${cfg.perMinute} ฿/นาที`);

  // 2) ประเภทรถ
  const vehicleAdj = runBase * (vehicle.multiplier - 1);
  add(`ประเภทรถ: ${vehicle.name}`, vehicleAdj, `× ${vehicle.multiplier}`);
  const running = runBase + vehicleAdj;

  // 3) ช่วงเวลา
  const tm = timeMultiplier(cfg, trip.datetime);
  add(`ช่วงเวลา${tm.label ? ': ' + tm.label : ''}`, running * (tm.multiplier - 1), `× ${tm.multiplier}`);
  let subtotal = running * tm.multiplier;

  // 4) ขากลับรถเปล่า สำหรับทริปทางไกลขาเดียว
  const rt = cfg.returnTrip;
  if (!trip.roundTrip && rt && trip.distanceKm > rt.thresholdKm) {
    const extraKm = trip.distanceKm - rt.thresholdKm;
    const c = extraKm * rt.perKm;
    add('ชดเชยขากลับรถเปล่า', c, `${extraKm.toFixed(1)} km × ${rt.perKm} ฿ (เกิน ${rt.thresholdKm} km)`);
    subtotal += c;
  }

  // 5) ค่าบริการเสริม
  const wait = Math.max(0, trip.waitHours || 0) * cfg.waitPerHour;
  add(`ค่ารอ ${trip.waitHours || 0} ชม.`, wait, `× ${cfg.waitPerHour} ฿/ชม.`);
  const airport = trip.airport ? cfg.airportFee : 0;
  add('ค่าเข้า-ออกสนามบิน', airport);
  subtotal += wait + airport;

  // 5.1) EV: แวะชาร์จระหว่างทาง (สมมติออกรถแบตเต็ม)
  const ch = cfg.charging;
  const chargeStops = ch && ch.rangeKm > 0 ? Math.max(0, Math.ceil(km / ch.rangeKm - 1e-9) - 1) : 0;
  const chargeMinutes = chargeStops * (ch?.minutesPerStop || 0);
  if (chargeStops && ch.billTime) {
    const c = chargeMinutes * cfg.perMinute;
    add(`เวลาแวะชาร์จ ${chargeStops} ครั้ง`, c, `${chargeMinutes} นาที × ${cfg.perMinute} ฿/นาที`);
    subtotal += c;
  }

  // 6) ขั้นต่ำ + ปัดเศษ
  if (subtotal < cfg.minFare) {
    add('ปรับเป็นค่าโดยสารขั้นต่ำ', cfg.minFare - subtotal, `ขั้นต่ำ ${cfg.minFare} ฿`);
    subtotal = cfg.minFare;
  }
  const step = cfg.roundTo || 1;
  const rounded = Math.ceil(subtotal / step - 1e-9) * step;
  add('ปัดเศษ', rounded - subtotal, `ปัดขึ้นทีละ ${step} ฿`);

  // 7) ค่าทางด่วน (pass-through)
  const toll = Math.max(0, trip.tollBaht || 0);
  add('ค่าทางด่วน (ตามจริง)', toll);

  return {
    total: rounded + toll,
    fareExToll: rounded,
    lines,
    km,
    min,
    chargeStops,
    chargeMinutes,
    vehicle,
    timeMultiplier: tm,
  };
}

/** ต้นทุนและกำไรโดยประมาณของทริป (ใช้ในหน้า Admin) */
export function estimateTripProfit(fare, costPerKm, costInputs) {
  const deadhead = costInputs.deadheadPct || 0;
  const carCost = costPerKm * fare.km * (1 + deadhead);
  const labor = (costInputs.driverHourly || 0) * fare.min / 60;
  const profit = fare.fareExToll - carCost;
  return { carCost, labor, profitAfterCar: profit, profitAfterLabor: profit - labor };
}
