import {
  loadCostInputs, saveCostInputs, resetCostInputs,
  loadFareConfig, saveFareConfig, resetFareConfig, buildFareConfig,
} from './config.js';
import { computeCostPerKm, recommendRates, blendedKwhRate } from './cost.js';
import { calculateFare, estimateTripProfit } from './pricing.js';

const $ = (id) => document.getElementById(id);
const fmt = (x, d = 2) => Number(x).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });
const baht0 = (x) => `${Math.round(x).toLocaleString('th-TH')} ฿`;

let cost = loadCostInputs();
let fare = loadFareConfig();

const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v; };
const readInput = (el) => {
  if (el.hasAttribute('data-bool')) return el.value === 'true';
  return el.type === 'number' ? (el.value === '' ? 0 : Number(el.value)) : el.value;
};

// ================= 1. Cost model =================
function bindCostForm() {
  for (const el of document.querySelectorAll('[data-c]')) {
    const key = el.dataset.c;
    const isPct = el.hasAttribute('data-pct');
    el.value = isPct ? Math.round(cost[key] * 1000) / 10 : cost[key];
    el.oninput = () => { const v = readInput(el); cost[key] = isPct ? v / 100 : v; onCostChange(); };
  }
  renderMaint();
}

function renderMaint() {
  $('maintRows').replaceChildren(...cost.maintenance.map((m, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input value=""></td><td><input type="number" step="100"></td>
      <td><input type="number" step="1000"></td><td><button type="button" class="icon" aria-label="ลบ">✕</button></td>`;
    const [name, c, km] = tr.querySelectorAll('input');
    name.value = m.name; c.value = m.cost; km.value = m.intervalKm;
    name.oninput = () => { m.name = name.value; onCostChange(); };
    c.oninput = () => { m.cost = Number(c.value) || 0; onCostChange(); };
    km.oninput = () => { m.intervalKm = Number(km.value) || 0; onCostChange(); };
    tr.querySelector('button').onclick = () => { cost.maintenance.splice(i, 1); renderMaint(); onCostChange(); };
    return tr;
  }));
}
$('addMaint').onclick = () => { cost.maintenance.push({ name: '', cost: 0, intervalKm: 10000 }); renderMaint(); onCostChange(); };
$('resetCost').onclick = () => { resetCostInputs(); cost = loadCostInputs(); bindCostForm(); onCostChange(); toast('คืนค่าต้นทุนเริ่มต้นแล้ว'); };

const COST_PARTS = [
  ['energy', 'พลังงาน', '#2f8f63'],
  ['depreciation', 'ค่าเสื่อม', '#3a6fb0'],
  ['maintenance', 'บำรุงรักษา', '#c98a1b'],
  ['fixed', 'ประกัน/ภาษี/อื่น ๆ', '#8a5bb5'],
];

function renderCost() {
  for (const el of document.querySelectorAll('[data-energy]')) el.hidden = el.dataset.energy !== cost.energyType;
  $('blendNote').textContent = `ราคาไฟเฉลี่ย ${fmt(blendedKwhRate(cost))} ฿/kWh → ${fmt(cost.kwhPer100km / 100 * blendedKwhRate(cost))} ฿/km`;
  const c = computeCostPerKm(cost);
  const r = recommendRates(cost);
  $('costKpis').innerHTML = [
    ['ต้นทุนรวม', `${fmt(c.total)} ฿/km`],
    ...COST_PARTS.map(([k, label]) => [k === 'energy' ? (cost.energyType === 'ev' ? 'ค่าไฟ' : 'น้ำมัน') : label, `${fmt(c[k])} ฿/km`]),
    ['ต้นทุนต่อเดือน', baht0(c.total * cost.kmPerYear / 12)],
  ].map(([k, v]) => `<div class="kpi"><div class="k">${k}</div><div class="v num">${v}</div></div>`).join('');

  $('costBar').innerHTML = COST_PARTS
    .map(([k, , color]) => `<div style="width:${(c[k] / c.total) * 100}%;background:${color}" title="${k}"></div>`).join('');
  $('costLegend').innerHTML = COST_PARTS
    .map(([k, label, color]) => `<span style="--c:${color}">${label} ${fmt((c[k] / c.total) * 100, 0)}%</span>`).join('');

  const tierText = r.distanceTiers.map((t, i) => {
    const from = i === 0 ? 0 : r.distanceTiers[i - 1].upToKm;
    return `${from}–${t.upToKm ?? '∞'} km: <b>${t.rate} ฿/km</b>`;
  }).join(' · ');
  $('recommend').innerHTML = `
    <table class="breakdown num">
      <tr><td>ต้นทุน × (1 + ขาเปล่า ${fmt(cost.deadheadPct * 100, 0)}%) × (1 + กำไร ${fmt(cost.marginPct * 100, 0)}%)
        <span class="note">${fmt(c.total)} × ${fmt(1 + cost.deadheadPct)} × ${fmt(1 + cost.marginPct)}</span></td>
        <td>${fmt(r.perKmExact)} ฿/km</td></tr>
      <tr><td>ค่าระยะทางแบบขั้นบันได<span class="note">${tierText}</span></td><td></td></tr>
      <tr><td>ค่าเวลา<span class="note">${cost.driverHourly} ฿/ชม. ÷ 60</span></td><td>${r.perMinute} ฿/นาที</td></tr>
      <tr><td>ค่าโดยสารขั้นต่ำ<span class="note">≈ ค่าเรียก 40 ฿ + 5 km</span></td><td>${r.minFare} ฿</td></tr>
      <tr><td>ชดเชยขากลับทางไกล<span class="note">${cost.returnFactor} × ${fmt(c.total)} ฿/km</span></td><td>${r.returnPerKm} ฿/km</td></tr>
    </table>`;
}

function onCostChange() { saveCostInputs(cost); renderCost(); renderSim(); }

$('applyRates').onclick = () => {
  const r = recommendRates(cost);
  fare.perMinute = r.perMinute;
  fare.distanceTiers = r.distanceTiers;
  fare.minFare = r.minFare;
  fare.returnTrip = { ...fare.returnTrip, perKm: r.returnPerKm };
  saveFareConfig(fare);
  bindFareForm(); renderSim();
  toast('นำเรทแนะนำไปใช้และบันทึกแล้ว');
  $('fareForm').scrollIntoView({ behavior: 'smooth' });
};

// ================= 2. Fare config =================
function bindFareForm() {
  for (const el of document.querySelectorAll('[data-f]')) {
    const p = el.dataset.f;
    el.value = String(getPath(fare, p) ?? '');
    el.oninput = () => { setPath(fare, p, readInput(el)); renderSim(); };
  }
  $('peakWindows').value = (fare.peak?.windows || []).map(([s, e]) => `${s}-${e}`).join(', ');
  $('peakWindows').oninput = () => {
    fare.peak.windows = $('peakWindows').value.split(',')
      .map((s) => s.split('-').map(Number)).filter((w) => w.length === 2 && w.every(Number.isFinite));
    renderSim();
  };
  renderTiers(); renderVehicles();
}

function renderTiers() {
  $('tierRows').replaceChildren(...fare.distanceTiers.map((t, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input type="number" step="5"></td><td><input type="number" step="0.5"></td>
      <td><button type="button" class="icon" aria-label="ลบ">✕</button></td>`;
    const [up, rate] = tr.querySelectorAll('input');
    up.value = t.upToKm ?? ''; rate.value = t.rate;
    up.oninput = () => { t.upToKm = up.value === '' ? null : Number(up.value); renderSim(); };
    rate.oninput = () => { t.rate = Number(rate.value) || 0; renderSim(); };
    tr.querySelector('button').onclick = () => { fare.distanceTiers.splice(i, 1); renderTiers(); renderSim(); };
    return tr;
  }));
}
$('addTier').onclick = () => {
  const last = fare.distanceTiers.at(-1);
  fare.distanceTiers.push({ upToKm: null, rate: last ? last.rate : 8 });
  renderTiers(); renderSim();
};

function renderVehicles() {
  $('vehicleRows').replaceChildren(...fare.vehicles.map((v, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input></td><td><input type="number" step="1"></td><td><input type="number" step="0.05"></td>
      <td>${fare.vehicles.length > 1 ? '<button type="button" class="icon" aria-label="ลบ">✕</button>' : ''}</td>`;
    tr.querySelector('button')?.addEventListener('click', () => { fare.vehicles.splice(i, 1); renderVehicles(); renderSim(); });
    const [name, seats, mult] = tr.querySelectorAll('input');
    name.value = v.name; seats.value = v.seats; mult.value = v.multiplier;
    name.oninput = () => { v.name = name.value; };
    seats.oninput = () => { v.seats = Number(seats.value) || 0; };
    mult.oninput = () => { v.multiplier = Number(mult.value) || 1; renderSim(); };
    return tr;
  }));
}

$('addVehicle').onclick = () => {
  fare.vehicles.push({ id: `v${Date.now().toString(36)}`, name: 'รถคันใหม่', seats: 4, multiplier: 1 });
  renderVehicles();
};

function validTiers() {
  const ts = fare.distanceTiers;
  for (let i = 0; i < ts.length; i++) {
    if (ts[i].upToKm == null && i !== ts.length - 1) return 'ช่วงที่ไม่จำกัดระยะต้องอยู่ท้ายสุด';
    if (i > 0 && ts[i].upToKm != null && ts[i].upToKm <= ts[i - 1].upToKm) return 'ระยะ "ถึง km" ต้องเพิ่มขึ้นเรื่อย ๆ';
  }
  if (ts.length && ts.at(-1).upToKm != null) return 'ช่วงสุดท้ายควรเว้นว่าง (ไม่จำกัดระยะ)';
  return null;
}

$('saveFare').onclick = () => {
  const err = validTiers();
  if (err) { toast(err); return; }
  toast(saveFareConfig(fare) ? 'บันทึกแล้ว' : 'บันทึกไม่สำเร็จ (เบราว์เซอร์บล็อก storage)');
};
$('resetFare').onclick = () => {
  resetFareConfig();
  fare = buildFareConfig(recommendRates(cost));
  saveFareConfig(fare);
  bindFareForm(); renderSim();
  toast('คืนค่าเริ่มต้น (คำนวณจากต้นทุนปัจจุบัน) แล้ว');
};
$('exportFare').onclick = () => {
  const blob = new Blob([JSON.stringify({ fareConfig: fare, costInputs: cost }, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'fare-config.json' });
  a.click(); URL.revokeObjectURL(a.href);
};

// ================= Simulation =================
const SAMPLE_TRIPS = [
  { label: 'ในซอย/ใกล้', km: 3, min: 12 },
  { label: 'ในเมือง', km: 12, min: 35 },
  { label: 'ข้ามเมือง', km: 25, min: 55 },
  { label: 'สนามบิน', km: 35, min: 50, airport: true },
  { label: 'ต่างจังหวัดใกล้', km: 90, min: 90 },
  { label: 'ต่างจังหวัดไกล', km: 200, min: 180 },
];

function renderSim() {
  const cpk = computeCostPerKm(cost).total;
  const noon = new Date(); noon.setHours(13, 0, 0, 0);
  while (noon.getDay() === 0 || noon.getDay() === 6) noon.setDate(noon.getDate() + 1);
  const rows = SAMPLE_TRIPS.map((t) => {
    const f = calculateFare(fare, { distanceKm: t.km, durationMin: t.min, vehicleId: fare.vehicles[0]?.id, datetime: noon, airport: t.airport });
    const p = estimateTripProfit(f, cpk, cost);
    const color = p.profitAfterLabor < 0 ? 'color:var(--danger)' : '';
    return `<tr><td>${t.label}<span class="note">${t.km} km · ${t.min} นาที${t.airport ? ' · สนามบิน' : ''}</span></td>
      <td>${baht0(f.total)}<span class="note">${fmt(f.total / t.km, 1)} ฿/km</span></td>
      <td>${baht0(p.carCost)}<span class="note">ค่าแรง ${baht0(p.labor)}</span></td>
      <td style="${color}">${baht0(p.profitAfterLabor)}<span class="note">ก่อนค่าแรง ${baht0(p.profitAfterCar)}</span></td></tr>`;
  }).join('');
  $('simTable').innerHTML = `<tr><td class="muted">ทริป</td><td class="muted">ราคา</td><td class="muted">ต้นทุนรถ*</td><td class="muted">กำไรสุทธิ</td></tr>${rows}
    <tr><td colspan="4" class="muted">* ต้นทุนรถ = ต้นทุน/km × ระยะ × (1 + ขาเปล่า) · กำไรสุทธิ = ราคา − ต้นทุนรถ − ค่าแรงคนขับ</td></tr>`;
}

let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

bindCostForm();
bindFareForm();
renderCost();
renderSim();
