import { buildFareConfig } from './config.js';
import { DEFAULT_COST_INPUTS } from './cost.js';
import { requireDriver } from './auth.js';
import { parseCoordinates } from './geo.js';
import { esc } from './ui.js';
import { computeCostPerKm, recommendRates, blendedKwhRate } from './cost.js';
import { calculateFare, estimateTripProfit } from './pricing.js';

const $ = (id) => document.getElementById(id);
const fmt = (x, d = 2) => Number(x).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });
const baht0 = (x) => `${Math.round(x).toLocaleString('th-TH')} ฿`;

const store = await requireDriver();
let cost = await store.getCostInputs();
let fare = await store.getFareConfig();
const clone = (o) => JSON.parse(JSON.stringify(o));

// บันทึกต้นทุนแบบหน่วงเวลา (ไม่ยิงฐานข้อมูลทุกครั้งที่พิมพ์)
let costTimer;
function saveCostDebounced() {
  clearTimeout(costTimer);
  costTimer = setTimeout(() => store.saveCostInputs(cost).catch((e) => toast(`บันทึกต้นทุนไม่สำเร็จ: ${e.message}`)), 800);
}
async function persistFare(msg) {
  try { await store.saveFareConfig(fare); toast(msg); }
  catch (e) { toast(`บันทึกไม่สำเร็จ: ${e.message}`); }
}

// สำรองข้อมูล / ส่งออก
document.querySelectorAll('[data-export]').forEach((btn) => btn.addEventListener('click', async () => {
  const kind = btn.dataset.export;
  $('exportStatus').textContent = 'กำลังเตรียมไฟล์…';
  try {
    const { toCSV, downloadFile, stamp, CUSTOMER_COLUMNS, QUOTE_COLUMNS, EXPENSE_COLUMNS } = await import('./export.js');
    const d = stamp();
    if (kind === 'customers') { const rows = await store.listCustomers(); downloadFile(`wiriya-customers-${d}.csv`, toCSV(rows, CUSTOMER_COLUMNS)); $('exportStatus').textContent = `✅ ดาวน์โหลดลูกค้า ${rows.length} รายการ`; }
    if (kind === 'quotes') { const rows = await store.listQuotes({ limit: 10000 }); downloadFile(`wiriya-quotes-${d}.csv`, toCSV(rows, QUOTE_COLUMNS)); $('exportStatus').textContent = `✅ ดาวน์โหลดประวัติ ${rows.length} รายการ`; }
    if (kind === 'expenses') { const rows = await store.listExpenses({ limit: 10000 }); downloadFile(`wiriya-expenses-${d}.csv`, toCSV(rows, EXPENSE_COLUMNS)); $('exportStatus').textContent = `✅ ดาวน์โหลดค่าใช้จ่าย ${rows.length} รายการ`; }
    if (kind === 'all') {
      const [customers, quotes, expenses] = await Promise.all([store.listCustomers(), store.listQuotes({ limit: 10000 }), store.listExpenses({ limit: 10000 })]);
      const backup = { app: 'wiriya', version: 1, exported_at: new Date().toISOString(), fareConfig: fare, costInputs: cost, customers, quotes, expenses };
      downloadFile(`wiriya-backup-${d}.json`, JSON.stringify(backup, null, 2), 'application/json');
      $('exportStatus').textContent = `✅ สำรองแล้ว: ลูกค้า ${customers.length} · งาน ${quotes.length} · ค่าใช้จ่าย ${expenses.length}`;
    }
  } catch (e) { $('exportStatus').textContent = `❌ ส่งออกไม่สำเร็จ: ${e.message}`; }
}));

// ลบข้อมูลเก่า (PDPA)
$('purgeBtn').onclick = async () => {
  if (!confirm('ลบคำขอ/ใบเสนอราคาที่ไม่ได้เดินทางจริงและเก่ากว่า 1 ปี?\nแนะนำให้กด "สำรองทั้งหมด" ก่อน · ลบแล้วกู้คืนไม่ได้')) return;
  $('purgeBtn').disabled = true;
  try {
    const r = await store.purgeOldData(365);
    $('purgeStatus').textContent = `✅ ลบแล้ว: ใบเสนอราคา/คำขอ ${r.quotes} รายการ · ลูกค้า ${r.customers} คน`;
  } catch (e) {
    $('purgeStatus').textContent = `❌ ลบไม่สำเร็จ: ${e.message}${/purge_old_data|function/.test(e.message) ? ' → รัน schema.sql ใหม่' : ''}`;
  } finally { $('purgeBtn').disabled = false; }
};

// ตรวจสอบการเชื่อมต่อ
$('diagBtn').onclick = async () => {
  $('diagBtn').disabled = true;
  $('diagList').hidden = false;
  $('diagList').innerHTML = '<li>กำลังตรวจ…</li>';
  try {
    const rows = await store.diagnose();
    $('diagList').innerHTML = rows.map((r) => `<li class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✅' : '❌'} <b>${esc(r.label)}</b> <span class="muted">${esc(r.detail || '')}</span></li>`).join('');
  } catch (e) {
    $('diagList').innerHTML = `<li class="bad">❌ ${esc(e.message)}</li>`;
  } finally { $('diagBtn').disabled = false; }
};

// ทดสอบแจ้งเตือน LINE OA
if (store.mode !== 'supabase') {
  $('testLineBtn').disabled = true;
  $('lineStatus').textContent = '⚠️ ต้องเชื่อมฐานข้อมูล Supabase ก่อน จึงจะส่งแจ้งเตือนผ่าน LINE OA ได้';
}
$('testLineBtn').onclick = async () => {
  $('testLineBtn').disabled = true;
  $('lineStatus').textContent = 'กำลังส่ง…';
  try {
    await store.testLine();
    $('lineStatus').textContent = '✅ ส่งแล้ว ลองเช็ก LINE ของคุณ';
  } catch (e) {
    $('lineStatus').textContent = `❌ ส่งไม่สำเร็จ: ${e.message}`;
  } finally { $('testLineBtn').disabled = false; }
};

// ลิงก์สำหรับลูกค้า
const custUrl = new URL('customer.html', location.href).href;
$('custLink').value = custUrl;
$('openCustLink').href = custUrl;
$('copyCustLink').onclick = async () => {
  try { await navigator.clipboard.writeText(custUrl); toast('คัดลอกลิงก์แล้ว'); }
  catch { $('custLink').select(); toast('กดค้างที่ช่องเพื่อคัดลอก'); }
};

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
$('resetCost').onclick = () => { cost = clone(DEFAULT_COST_INPUTS); bindCostForm(); onCostChange(); toast('คืนค่าต้นทุนเริ่มต้นแล้ว'); };

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

function onCostChange() { saveCostDebounced(); renderCost(); renderSim(); }

$('applyRates').onclick = () => {
  const r = recommendRates(cost);
  fare.perMinute = r.perMinute;
  fare.distanceTiers = r.distanceTiers;
  fare.minFare = r.minFare;
  fare.returnTrip = { ...fare.returnTrip, perKm: r.returnPerKm };
  bindFareForm(); renderSim();
  persistFare('นำเรทแนะนำไปใช้และบันทึกแล้ว');
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
  renderTiers(); renderVehicles(); renderPopular();
  fare.serviceArea ||= { name: '', lat: null, lng: null, zoom: 11 };
  $('serviceAreaCoord').value = fare.serviceArea.lat != null ? `${fare.serviceArea.lat}, ${fare.serviceArea.lng}` : '';
  $('serviceAreaCoord').onchange = () => {
    const c = parseCoordinates($('serviceAreaCoord').value);
    if (!c) { $('serviceAreaCoord').classList.add('invalid'); toast('อ่านพิกัดไม่ได้'); return; }
    $('serviceAreaCoord').classList.remove('invalid');
    fare.serviceArea.lat = Math.round(c.lat * 1e6) / 1e6; fare.serviceArea.lng = Math.round(c.lng * 1e6) / 1e6;
    $('serviceAreaCoord').value = `${fare.serviceArea.lat}, ${fare.serviceArea.lng}`;
  };
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

function renderPopular() {
  fare.popularPlaces ||= [];
  $('popularRows').replaceChildren(...fare.popularPlaces.map((p, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input placeholder="เช่น สถานีขนส่งชลบุรี"></td><td><input placeholder="13.3611, 100.9847 หรือวางลิงก์"></td>
      <td><button type="button" class="icon" aria-label="ลบ">✕</button></td>`;
    const [name, coord] = tr.querySelectorAll('input');
    name.value = p.name || '';
    coord.value = Number.isFinite(Number(p.lat)) && p.lat !== null && p.lat !== '' ? `${p.lat}, ${p.lng}` : '';
    name.oninput = () => { p.name = name.value.trim(); };
    coord.onchange = () => {
      const c = parseCoordinates(coord.value);
      if (!c) { coord.classList.add('invalid'); toast('อ่านพิกัดไม่ได้ วางพิกัด เช่น 13.3611, 100.9847 หรือลิงก์ Google Maps แบบยาว'); return; }
      coord.classList.remove('invalid');
      p.lat = Math.round(c.lat * 1e6) / 1e6; p.lng = Math.round(c.lng * 1e6) / 1e6;
      coord.value = `${p.lat}, ${p.lng}`;
    };
    tr.querySelector('button').onclick = () => { fare.popularPlaces.splice(i, 1); renderPopular(); };
    return tr;
  }));
}
$('addPopular').onclick = () => { fare.popularPlaces ||= []; fare.popularPlaces.push({ name: '', lat: null, lng: null }); renderPopular(); };

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
  const bad = (fare.popularPlaces || []).filter((p) => !p.name || !Number.isFinite(Number(p.lat)) || p.lat === null);
  if (bad.length) { toast('สถานที่ยอดนิยมบางรายการยังไม่มีชื่อหรือพิกัด กรอกให้ครบหรือกดลบก่อน'); return; }
  persistFare(store.mode === 'supabase' ? 'บันทึกแล้ว ลูกค้าทุกเครื่องเห็นเรทใหม่' : 'บันทึกแล้ว (ในเครื่องนี้)');
};
$('resetFare').onclick = () => {
  const keepBusiness = fare.business;
  fare = buildFareConfig(recommendRates(cost));
  fare.business = keepBusiness;
  bindFareForm(); renderSim();
  persistFare('คืนค่าเริ่มต้น (คำนวณจากต้นทุนปัจจุบัน) แล้ว');
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

/** แนะนำราคาเหมาขั้นต่ำจากต้นทุนจริง: ระยะที่รวมให้ × (1+รถเปล่า) × ต้นทุน/km + ค่าแรง × ชั่วโมง */
function renderCharterHint() {
  const el = $('charterHint');
  if (!el || !fare.charter) return;
  const cpk = computeCostPerKm(cost).total;
  const one = (p) => {
    const carCost = (p.includedKm || 0) * (1 + (cost.deadheadPct || 0)) * cpk;
    const labor = (cost.driverHourly || 0) * (p.hours || 0);
    const profit = (p.price || 0) - carCost - labor;
    return `${p.label || ''}: ต้นทุนรถ ~${baht0(carCost)} + ค่าแรง ~${baht0(labor)} → กำไร ~${baht0(profit)}/วัน`;
  };
  el.textContent = `ถ้าวิ่งเต็มระยะที่รวมให้ · ${one({ ...fare.charter.full, label: 'เต็มวัน' })} · ${one({ ...fare.charter.half, label: 'ครึ่งวัน' })}`;
}

function renderSim() {
  renderCharterHint();
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
