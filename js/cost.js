// ===== Cost model: คำนวณต้นทุนจริงต่อกิโลเมตร แล้วแปลงเป็นอัตราค่าโดยสารที่แนะนำ =====
//
//   C_km = C_energy + C_maint + C_depr + C_fixed                   [฿/km]
//   C_energy (น้ำมัน) = P_fuel / η                     (η = อัตราสิ้นเปลือง km/L)
//   C_energy (EV)     = (E/100) × [s·P_home + (1−s)·P_dc]
//                       E = kWh/100 km ที่ปลั๊ก (รวม charging loss), s = สัดส่วนชาร์จบ้าน
//   C_maint = Σ (ค่าอะไหล่/บริการ_i ÷ รอบเปลี่ยน_i km)
//   C_depr  = (ราคารถ − มูลค่าซาก) ÷ (อายุใช้งาน × km/ปี)
//   C_fixed = (ประกัน + ภาษี/พ.ร.บ. + ค่าใช้จ่ายรายปีอื่น) ÷ km/ปี
//
//   r_d (ราคาต่อ km) = C_km × (1 + ขาเปล่า%) × (1 + กำไร%)
//   r_t (ราคาต่อนาที) = ค่าแรงคนขับที่ต้องการต่อชั่วโมง ÷ 60

/**
 * ค่าเริ่มต้น: Omoda C5 EV 2026 (Max+, ประกอบไทย) — แบต LFP 50.6 kWh, WLTP 359 km
 * อัตราใช้ไฟ: 50.6 kWh ÷ 359 km ≈ 14.1 kWh/100 km ที่แบต → +~10% charging loss/ขับในเมือง ≈ 16 kWh/100 km ที่ปลั๊ก
 * แก้ให้ตรงกับรถจริงได้ในหน้า Admin (ดูค่าเฉลี่ยจากหน้าปัด/แอปของรถหลังใช้งาน 1–2 สัปดาห์)
 */
export const DEFAULT_COST_INPUTS = Object.freeze({
  vehicleName: 'Omoda C5 EV 2026 (Max+)',
  energyType: 'ev',       // 'ev' | 'fuel'
  // --- EV ---
  kwhPer100km: 16,        // kWh/100 km ที่ปลั๊ก
  homeRate: 3.0,          // ฿/kWh ชาร์จบ้าน TOU off-peak (รวม Ft + VAT โดยประมาณ)
  dcRate: 7.5,            // ฿/kWh ตู้ DC fast charge สาธารณะ
  homeSharePct: 0.70,     // สัดส่วนพลังงานที่ชาร์จที่บ้าน
  batteryKwh: 50.6,       // ความจุแบตที่ใช้ได้ (kWh)
  reservePct: 15,         // แบตสำรองขั้นต่ำที่ไม่อยากให้ต่ำกว่า (%)
  dcKw: 60,               // กำลังชาร์จ DC เฉลี่ยช่วง 20–80% (kW)
  // --- น้ำมัน (ใช้เมื่อ energyType = 'fuel') ---
  fuelPrice: 35,          // ฿/L
  kmPerLiter: 14,         // km/L
  // --- ค่าเสื่อม ---
  carPrice: 649000,       // ฿ (ราคาทางการ พ.ค. 2026)
  residualPct: 0.30,      // EV จีนราคาตกเร็ว: สมมติเหลือ 30% เมื่อครบ 5 ปี/200,000 km
  years: 5,
  kmPerYear: 40000,
  insurancePerYear: 25000,      // ประกันชั้น 1 EV แบบเชิงพาณิชย์ (EV แพงกว่ารถน้ำมัน)
  taxCompulsoryPerYear: 1200,   // ภาษี EV (ลดหย่อน) + พ.ร.บ.
  otherPerYear: 6000,           // ค่าจอด, โทรศัพท์/เน็ต, ล้างรถ ฯลฯ
  maintenance: [
    { name: 'ยาง 4 เส้น (215/55 R18)', cost: 16000, intervalKm: 40000 },
    { name: 'สลับยาง / ตั้งศูนย์', cost: 500, intervalKm: 10000 },
    { name: 'เช็กระยะ (ไส้กรองแอร์, น้ำมันเบรก ฯลฯ)', cost: 2500, intervalKm: 20000 },
    { name: 'ผ้าเบรก (regen ช่วยยืดอายุ)', cost: 3000, intervalKm: 60000 },
    { name: 'แบต 12V / ใบปัดน้ำฝน / อื่น ๆ', cost: 4000, intervalKm: 60000 },
  ],
  deadheadPct: 0.30,
  marginPct: 0.20,
  driverHourly: 150,
  returnFactor: 0.7,
});

const n = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** ราคาพลังงานเฉลี่ยของ EV (฿/kWh) ตามสัดส่วนชาร์จบ้าน/DC */
export const blendedKwhRate = (c) => {
  const s = Math.min(1, Math.max(0, n(c.homeSharePct)));
  return s * n(c.homeRate) + (1 - s) * n(c.dcRate);
};

export function energyCostPerKm(c) {
  return c.energyType === 'fuel'
    ? n(c.fuelPrice) / Math.max(0.1, n(c.kmPerLiter, 1))
    : (n(c.kwhPer100km) / 100) * blendedKwhRate(c);
}

/** @returns {{energy:number, maintenance:number, depreciation:number, fixed:number, total:number}} ฿/km */
export function computeCostPerKm(c) {
  const kmYear = Math.max(1, n(c.kmPerYear, 1));
  const energy = energyCostPerKm(c);
  const maintenance = (c.maintenance || []).reduce(
    (s, m) => s + (n(m.intervalKm) > 0 ? n(m.cost) / n(m.intervalKm) : 0), 0);
  const depreciation = (n(c.carPrice) * (1 - n(c.residualPct))) / (Math.max(0.1, n(c.years, 1)) * kmYear);
  const fixed = (n(c.insurancePerYear) + n(c.taxCompulsoryPerYear) + n(c.otherPerYear)) / kmYear;
  return { energy, maintenance, depreciation, fixed, total: energy + maintenance + depreciation + fixed };
}

const round = (x, step) => Math.round(x / step) * step;
const ceilTo = (x, step) => Math.ceil(x / step) * step;

/** แปลงต้นทุนเป็นเรทราคาที่แนะนำ (ปัดเศษให้อ่านง่าย) */
export function recommendRates(c) {
  const cost = computeCostPerKm(c);
  const perKm = cost.total * (1 + n(c.deadheadPct)) * (1 + n(c.marginPct));
  const r = round(perKm, 0.5);
  return {
    cost,
    perKmExact: perKm,
    perMinute: round(n(c.driverHourly) / 60, 0.25),
    // ระยะไกลลดเรทลง เพราะสัดส่วนเวลารอ/วิ่งเปล่าต่อทริปน้อยลง
    distanceTiers: [
      { upToKm: 30, rate: r },
      { upToKm: 100, rate: round(r * 0.9, 0.5) },
      { upToKm: null, rate: round(r * 0.8, 0.5) },
    ],
    returnPerKm: round(cost.total * n(c.returnFactor), 0.5),
    minFare: ceilTo(40 + r * 5, 10), // ≈ ค่าเรียก + 5 km
  };
}
