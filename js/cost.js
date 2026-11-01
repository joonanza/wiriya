// ===== Cost model: คำนวณต้นทุนจริงต่อกิโลเมตร แล้วแปลงเป็นอัตราค่าโดยสารที่แนะนำ =====
//
//   C_km = C_fuel + C_maint + C_depr + C_fixed                     [฿/km]
//   C_fuel  = P_fuel / η                     (η = อัตราสิ้นเปลือง km/L)
//   C_maint = Σ (ค่าอะไหล่/บริการ_i ÷ รอบเปลี่ยน_i km)
//   C_depr  = (ราคารถ − มูลค่าซาก) ÷ (อายุใช้งาน × km/ปี)
//   C_fixed = (ประกัน + ภาษี/พ.ร.บ. + ค่าใช้จ่ายรายปีอื่น) ÷ km/ปี
//
//   r_d (ราคาต่อ km) = C_km × (1 + ขาเปล่า%) × (1 + กำไร%)
//   r_t (ราคาต่อนาที) = ค่าแรงคนขับที่ต้องการต่อชั่วโมง ÷ 60

/** ค่าเริ่มต้น: รถเก๋ง 1.2 L (ระดับ Yaris Ativ / City) เติมแก๊สโซฮอล์ 95 — แก้ให้ตรงกับรถจริงในหน้า Admin */
export const DEFAULT_COST_INPUTS = Object.freeze({
  vehicleName: 'รถเก๋ง 1.2 L (ตัวอย่าง)',
  fuelPrice: 35,          // ฿/L
  kmPerLiter: 14,         // km/L (ขับผสมในเมือง)
  carPrice: 600000,       // ฿
  residualPct: 0.40,      // มูลค่าซากเมื่อครบอายุ (สัดส่วนของราคารถ)
  years: 5,               // ปี
  kmPerYear: 40000,       // km/ปี
  insurancePerYear: 20000,      // ประกันชั้น 1 แบบเชิงพาณิชย์
  taxCompulsoryPerYear: 2500,   // ภาษีรถ + พ.ร.บ.
  otherPerYear: 6000,           // ค่าจอด, โทรศัพท์/เน็ต, ล้างรถ ฯลฯ
  maintenance: [
    { name: 'น้ำมันเครื่อง + ไส้กรอง', cost: 1500, intervalKm: 10000 },
    { name: 'ยาง 4 เส้น', cost: 12000, intervalKm: 50000 },
    { name: 'ผ้าเบรก', cost: 3000, intervalKm: 40000 },
    { name: 'เช็กระยะ/อื่น ๆ', cost: 6000, intervalKm: 20000 },
  ],
  deadheadPct: 0.30,      // สัดส่วนระยะวิ่งรถเปล่า (ไปรับ/กลับ) ต่อระยะที่มีผู้โดยสาร
  marginPct: 0.20,        // กำไรที่ต้องการบนต้นทุนรถ
  driverHourly: 150,      // ค่าแรงคนขับที่ต้องการ ฿/ชม. (คิดผ่านอัตราต่อนาที)
  returnFactor: 0.7,      // ทริปทางไกลขาเดียว: คิดค่าขากลับรถเปล่า = factor × C_km ต่อ km ที่เกินระยะ
});

const n = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** @returns {{fuel:number, maintenance:number, depreciation:number, fixed:number, total:number}} ฿/km */
export function computeCostPerKm(c) {
  const kmYear = Math.max(1, n(c.kmPerYear, 1));
  const fuel = n(c.fuelPrice) / Math.max(0.1, n(c.kmPerLiter, 1));
  const maintenance = (c.maintenance || []).reduce(
    (s, m) => s + (n(m.intervalKm) > 0 ? n(m.cost) / n(m.intervalKm) : 0), 0);
  const depreciation = (n(c.carPrice) * (1 - n(c.residualPct))) / (Math.max(0.1, n(c.years, 1)) * kmYear);
  const fixed = (n(c.insurancePerYear) + n(c.taxCompulsoryPerYear) + n(c.otherPerYear)) / kmYear;
  return { fuel, maintenance, depreciation, fixed, total: fuel + maintenance + depreciation + fixed };
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
