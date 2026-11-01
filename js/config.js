// ===== Fare config: ค่าเริ่มต้นคำนวณจาก cost model และเก็บค่าที่แก้ไว้ใน localStorage =====
import { DEFAULT_COST_INPUTS, recommendRates } from './cost.js';

const FARE_KEY = 'wiriya.fareConfig.v1';
const COST_KEY = 'wiriya.costInputs.v1';

export function buildFareConfig(rates, overrides = {}) {
  return {
    business: { name: 'วิริยะ รถรับส่ง', phone: '', lineOaId: '' },
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
    vehicles: [
      { id: 'sedan', name: 'รถเก๋ง 4 ที่นั่ง', seats: 4, multiplier: 1.0 },
      { id: 'suv', name: 'SUV / MPV 7 ที่นั่ง', seats: 7, multiplier: 1.3 },
      { id: 'van', name: 'รถตู้ 10 ที่นั่ง', seats: 10, multiplier: 1.6 },
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
