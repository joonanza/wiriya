// ===== Fare config: ค่าเริ่มต้นคำนวณจาก cost model และเก็บค่าที่แก้ไว้ใน localStorage =====
import { DEFAULT_COST_INPUTS, recommendRates } from './cost.js';
import { DEFAULT_CHARTER } from './planning.js';

const FARE_KEY = 'wiriya.fareConfig.v3';
const COST_KEY = 'wiriya.costInputs.v2';

export function buildFareConfig(rates, overrides = {}) {
  return {
    // lineId = LINE ID ส่วนตัว (เปิดหน้าโปรไฟล์ + คัดลอกข้อความให้ลูกค้าวาง), lineOaId = LINE Official Account (ส่งข้อความได้ตรง)
    business: { name: 'วิริยะ รถรับส่ง', phone: '', lineId: 'journiako', lineOaId: '' },
    baseFare: 40,
    perMinute: rates.perMinute,
    distanceTiers: rates.distanceTiers,
    minFare: rates.minFare,
    roundTo: 10,
    trafficFactor: 1.3, // OSRM ไม่มีข้อมูลจราจร → คูณเวลาเผื่อรถติด
    night: { startHour: 22, endHour: 6, multiplier: 1.2 },
    peak: { windows: [[7, 9], [16.5, 19.5]], multiplier: 1.15 },
    returnTrip: { thresholdKm: 60, perKm: rates.returnPerKm },
    waitPerHour: 150,
    airportFee: 50,
    showPriceToCustomer: false, // หน้าลูกค้า: แสดงราคาประเมินหรือไม่ (ปิด = คนขับแจ้งราคาเอง)
    // EV: ระยะใช้งานจริงต่อชาร์จ (เผื่อแบตสำรอง ~15%) → ใช้แจ้งจำนวนครั้งที่ต้องแวะชาร์จในทริปไกล
    charging: { rangeKm: 280, minutesPerStop: 30, billTime: false },
    // เหมาวัน (เต็มวัน/ครึ่งวัน) — ค่าไฟรวมในราคาแล้ว
    charter: JSON.parse(JSON.stringify(DEFAULT_CHARTER)),
    // ศูนย์กลางพื้นที่ให้บริการ: จุดเริ่มต้นแผนที่ และใช้เรียงผลค้นหาตามความใกล้
    serviceArea: { name: 'ชลบุรี', lat: 13.3611, lng: 100.9847, zoom: 11 },
    // สถานที่ยอดนิยม: แสดงให้ลูกค้า/คนขับเลือกได้ทันทีในช่องค้นหา (ทุกคนเห็น → อย่าใส่บ้านลูกค้า)
    popularPlaces: [
      { name: 'ท่าอากาศยานสุวรรณภูมิ (BKK)', lat: 13.6900, lng: 100.7501 },
      { name: 'ท่าอากาศยานดอนเมือง (DMK)', lat: 13.9126, lng: 100.6068 },
      { name: 'ท่าอากาศยานอู่ตะเภา (UTP)', lat: 12.6799, lng: 101.0050 },
    ],
    vehicles: [
      { id: 'c5ev', name: 'Omoda C5 EV (SUV, 4 ผู้โดยสาร)', seats: 4, multiplier: 1.0 },
    ],
    ...overrides,
  };
}

export const DEFAULT_FARE_CONFIG = Object.freeze(buildFareConfig(recommendRates(DEFAULT_COST_INPUTS)));

const clone = (o) => JSON.parse(JSON.stringify(o));

function read(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function loadFareConfig() {
  const saved = read(FARE_KEY);
  return saved ? { ...clone(DEFAULT_FARE_CONFIG), ...saved } : clone(DEFAULT_FARE_CONFIG);
}
export const saveFareConfig = (cfg) => write(FARE_KEY, cfg);
export const resetFareConfig = () => { try { localStorage.removeItem(FARE_KEY); } catch { /* ignore */ } };

export function loadCostInputs() {
  const saved = read(COST_KEY);
  return saved ? { ...clone(DEFAULT_COST_INPUTS), ...saved } : clone(DEFAULT_COST_INPUTS);
}
export const saveCostInputs = (c) => write(COST_KEY, c);
export const resetCostInputs = () => { try { localStorage.removeItem(COST_KEY); } catch { /* ignore */ } };
