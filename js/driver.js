// ===== หน้าคนขับ: คำนวณราคา → ปรับราคา → ส่งใบเสนอราคาให้ลูกค้า (SMS / LINE / WhatsApp / คัดลอก) =====
import { requireDriver } from './auth.js';
import { createTripPlanner } from './trip.js';
import { collectRecentPlaces } from './geo.js';
import { findConflicts } from './stats.js';
import { batteryPlan } from './planning.js';
import { searchCategory } from './geo.js';
import { computeCostPerKm } from './cost.js';
import {
  $, esc, baht, toast, copySync, normalizePhone, phoneDisplay, fmtDateTime, shortPlace,
  smsLink, waLink, lineShareLink, statusBadge, mapsDirLink, randomToken,
} from './ui.js';

const store = await requireDriver();
const cfg = await store.getFareConfig();
const costInputs = await store.getCostInputs();
const costPerKm = computeCostPerKm(costInputs).total;

if (cfg.business?.name) { $('bizName').textContent = cfg.business.name; }

let editing = null;                      // quote ที่กำลังแก้ไข (ถ้ามี)
let customer = { id: null, phone: '' };  // ลูกค้าที่เลือกจากฐานข้อมูล
let quotedManual = false;                // คนขับแก้ราคาเองแล้ว
let msgManual = false;                   // คนขับแก้ข้อความเองแล้ว
let confirmToken = null;                 // token ของลิงก์ยืนยัน (สร้างครั้งเดียวต่อใบ)
const confirmUrl = () => {
  if (!store.canConfirmLinks) return null;
  confirmToken ||= randomToken(32);
  return new URL(`confirm.html?t=${confirmToken}`, location.href).href;
};

// งานทั้งหมด (ใช้ทั้งสถานที่ที่เคยใช้ และเช็กเวลาชนกัน)
let allQuotes = [];
const quotesReady = store.listQuotes({ limit: 1000 }).then((qs) => { allQuotes = qs; return qs; }).catch(() => []);

const planner = createTripPlanner(cfg, {
  onUpdate: refreshOffer,
  recentPlaces: async () => collectRecentPlaces((await quotesReady).slice(0, 200)),
});
quotesReady.then(() => renderConflicts());

/** เตือนเมื่อเวลารับทับกับงานที่ยืนยันแล้ว / รอยืนยัน (เผื่อเวลาเดินทางไปจุดรับ 30 นาที) */
function renderConflicts() {
  const box = $('conflictBox');
  const st = planner.state;
  if (!st.fare || !st.trip) { box.hidden = true; return; }
  const busyMin = st.fare.min + (st.trip.waitHours || 0) * 60;
  const hits = findConflicts(allQuotes, { start: st.trip.datetime, busyMin }, { excludeId: editing?.id });
  box.hidden = hits.length === 0;
  if (!hits.length) return;
  const t = (d) => d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  box.innerHTML = `<b>⚠️ เวลาชนกับงานอื่น ${hits.length} งาน</b>
    <ul>${hits.map(({ q, start, end }) => `<li>
      <a href="quote.html?quote=${encodeURIComponent(q.id)}" target="_blank" rel="noopener">${esc(q.customer_name || '(ไม่มีชื่อ)')}</a>
      · ${esc(start.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }))} ${t(start)}–${t(end)}
      · ${q.status === 'confirmed' ? 'ยืนยันแล้ว' : 'รอลูกค้ายืนยัน'}</li>`).join('')}</ul>
    <span class="muted">เผื่อเวลาเดินทางไปจุดรับ 30 นาที · ยังส่งใบเสนอราคาได้ตามปกติ</span>`;
}

// ================= ลูกค้า =================
function setupCustomerSearch(inputId) {
  const input = $(inputId);
  const list = $(`${inputId}Suggest`);
  let timer, items = [];
  const close = () => { list.hidden = true; };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { close(); return; }
    timer = setTimeout(async () => {
      try { items = await store.searchCustomers(q, 6); } catch { items = []; }
      list.replaceChildren(...items.map((c) => {
        const li = document.createElement('li');
        li.innerHTML = `<b>${esc(c.name || '(ไม่มีชื่อ)')}</b> <span class="muted">${esc(phoneDisplay(c.phone) || '')}${c.line_id ? ' · LINE ' + esc(c.line_id) : ''}</span>`;
        li.addEventListener('mousedown', (e) => { e.preventDefault(); close(); selectCustomer(c); });
        return li;
      }));
      list.hidden = items.length === 0;
    }, 250);
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
}
setupCustomerSearch('custName');
setupCustomerSearch('custPhone');

async function selectCustomer(c) {
  customer = { id: c.id, phone: c.phone || '' };
  $('custName').value = c.name || '';
  $('custPhone').value = c.phone ? phoneDisplay(c.phone) : '';
  $('custLine').value = c.line_id || '';
  await renderCustomerInfo(c);
  refreshMessage();
}

async function renderCustomerInfo(c) {
  const box = $('custInfo');
  if (!c?.id) { box.hidden = true; box.innerHTML = ''; return; }
  let quotes = [];
  try { quotes = await store.listQuotes({ customerId: c.id, limit: 30 }); } catch { /* ignore */ }
  const trips = quotes.filter((q) => q.status === 'confirmed' || q.status === 'done');
  const total = trips.reduce((s, q) => s + (Number(q.fare_quoted) || 0), 0);
  const seen = new Set();
  const routes = quotes.filter((q) => q.pickup && q.dropoff && q.id !== editing?.id).filter((q) => {
    const k = `${q.pickup.lat.toFixed(4)},${q.pickup.lng.toFixed(4)}>${q.dropoff.lat.toFixed(4)},${q.dropoff.lng.toFixed(4)}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  }).slice(0, 3);
  box.hidden = false;
  box.innerHTML = `
    <div class="cust-info">
      <span class="badge st-confirmed">ลูกค้าเก่า</span>
      เดินทาง ${trips.length} ครั้ง · รวม ${baht(total)}${quotes[0] ? ` · ล่าสุด ${esc(fmtDateTime(quotes[0].created_at))}` : ''}
      ${c.note ? `<div class="muted">📝 ${esc(c.note)}</div>` : ''}
    </div>
    ${routes.length ? `<div class="recent-routes"><span class="muted">เส้นทางที่เคยใช้:</span>
      ${routes.map((q, i) => `<button type="button" class="chip" data-route="${i}">${esc(shortPlace(q.pickup.name, 1))} → ${esc(shortPlace(q.dropoff.name, 1))}</button>`).join('')}
    </div>` : ''}`;
  box.querySelectorAll('[data-route]').forEach((b) => b.addEventListener('click', () => {
    const q = routes[Number(b.dataset.route)];
    planner.load({ pickup: q.pickup, dropoff: q.dropoff, options: q.options });
    toast('ใส่เส้นทางเดิมแล้ว');
  }));
}

$('custPhone').addEventListener('input', () => {
  // เปลี่ยนเป็นเบอร์อื่น = ลูกค้าคนใหม่ ไม่เขียนทับคนเดิม
  const p = normalizePhone($('custPhone').value);
  if (customer.id && customer.phone && p && p !== customer.phone) {
    customer = { id: null, phone: '' };
    renderCustomerInfo(null);
  }
  refreshMessage();
});
for (const id of ['custName', 'custLine']) $(id).addEventListener('input', refreshMessage);

$('clearCustomer').addEventListener('click', () => {
  customer = { id: null, phone: '' };
  for (const id of ['custName', 'custPhone', 'custLine']) $(id).value = '';
  renderCustomerInfo(null);
  refreshMessage();
});

// ================= ราคาที่เสนอ =================
function quotedValue() {
  const v = Number($('quoted').value);
  return Number.isFinite(v) && v > 0 ? v : (planner.state.fare?.total || 0);
}

function refreshOffer(st) {
  const f = st.fare;
  $('offerCard').hidden = !f;
  if (!f) return;
  if (!quotedManual) $('quoted').value = f.total;
  $('resetQuoted').hidden = !quotedManual;
  renderProfit();
  refreshMessage();
  renderConflicts();
  renderBattery();
}

// ================= 🔋 วางแผนแบต EV + หาที่ชาร์จ =================
const isEV = costInputs.energyType === 'ev';
const SOC_KEY = 'wiriya.socNow.v1';
try { const v = localStorage.getItem(SOC_KEY); if (v) $('socNow').value = v; } catch { /* ignore */ }

function renderBattery() {
  const st = planner.state;
  $('batteryCard').hidden = !isEV || !st.fare;
  if ($('batteryCard').hidden) return;
  const t = st.trip;
  const legKm = st.route ? st.route.distanceKm : 0;
  // ระยะที่มีผู้โดยสาร: เหมา = ระยะรวม, ไป-กลับ = ×2, เที่ยวเดียว = 1 ขา (+ ขากลับรถเปล่าถ้าติ๊ก)
  const tripKm = t.charter ? t.distanceKm : legKm * (t.roundTrip ? 2 : 1);
  const returnKm = !t.charter && !t.roundTrip && $('incReturn').checked ? legKm : 0;
  const plan = batteryPlan({
    socPct: Number($('socNow').value),
    batteryKwh: costInputs.batteryKwh ?? 50.6,
    kwhPer100km: (costInputs.kwhPer100km || 16) * 0.9, // ค่าที่ปลั๊ก → ที่แบต (ประสิทธิภาพชาร์จ ~90%)
    tripKm: tripKm + (Number($('toPickupKm').value) || 0),
    returnKm,
    reservePct: costInputs.reservePct ?? 15,
    dcKw: costInputs.dcKw ?? 60,
  });
  const dcCost = plan.chargeNeededKwh / 0.9 * (costInputs.dcRate || 7.5);
  $('incReturn').closest('.field').hidden = !!t.charter || !!t.roundTrip;
  $('findChargersMid').hidden = !(st.route && st.route.coords?.length > 2 && legKm > 60);
  $('batteryResult').innerHTML = `
    <div class="${plan.ok ? 'success' : 'notice'}">
      ${plan.ok ? '✅ แบตพอ' : '⚠️ แบตไม่พอ ต้องชาร์จระหว่างทาง'}
      · ใช้ไฟ ~${plan.usedKwh.toFixed(1)} kWh · ${plan.ok ? 'เหลือ' : 'จะเหลือ'} ~${Math.max(0, plan.endPct).toFixed(0)}%
      ${!plan.ok ? `<br>ควรชาร์จเพิ่ม ~${plan.chargeNeededKwh.toFixed(0)} kWh (DC ~${plan.chargeMinutes} นาที · ~${Math.round(dcCost)} ฿) เพื่อเหลือสำรอง ${costInputs.reservePct ?? 15}%` : ''}
    </div>
    <p class="muted small">วิ่งได้อีก ~${Math.round(plan.rangeKm)} km ก่อนถึงแบตสำรอง · คำนวณจาก ${((costInputs.kwhPer100km || 16) * 0.9).toFixed(1)} kWh/100 km ที่แบต (ทางหลวงความเร็วสูง/เปิดแอร์หนักจะใช้มากกว่านี้)</p>`;
}
for (const id of ['socNow', 'toPickupKm', 'incReturn']) {
  $(id).addEventListener('input', () => {
    try { localStorage.setItem(SOC_KEY, $('socNow').value); } catch { /* ignore */ }
    renderBattery();
  });
}

async function showChargers(near, label) {
  const box = $('chargerList');
  box.innerHTML = '<p class="empty">กำลังค้นหาที่ชาร์จ…</p>';
  try {
    const list = (await searchCategory('charging', { near, limit: 8 })).slice(0, 6);
    box.innerHTML = list.length
      ? `<p class="muted small">⚡ ที่ชาร์จใกล้${esc(label)} (ข้อมูลจาก OpenStreetMap อาจไม่ครบ ควรเช็กในแอปผู้ให้บริการชาร์จด้วย)</p>`
        + list.map((c) => `<a class="day-job" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}">
          <span class="day-time num">${c.distanceKm < 1 ? Math.round(c.distanceKm * 1000) + ' m' : c.distanceKm.toFixed(1) + ' km'}</span>
          <span class="day-txt"><b>${esc(c.title)}</b><span class="muted">${esc(c.subtitle || '')}</span></span><span class="muted">นำทาง ↗</span></a>`).join('')
      : `<p class="empty">ไม่พบที่ชาร์จใกล้${esc(label)}ในข้อมูลแผนที่</p>`;
  } catch (e) { box.innerHTML = `<p class="empty">ค้นหาไม่สำเร็จ: ${esc(e.message)}</p>`; }
}
$('findChargers').addEventListener('click', () => {
  const st = planner.state;
  const target = st.dropoff || st.pickup;
  if (target) showChargers(target, st.dropoff ? 'ปลายทาง' : 'จุดรับ');
});
$('findChargersMid').addEventListener('click', () => {
  const c = planner.state.route?.coords;
  if (!c?.length) return;
  const [lat, lng] = c[Math.floor(c.length / 2)];
  showChargers({ lat, lng }, 'กลางทาง');
});

function renderProfit() {
  const st = planner.state;
  if (!st.fare) return;
  const toll = st.trip.tollBaht || 0;
  const carCost = costPerKm * st.fare.km * (1 + (costInputs.deadheadPct || 0));
  const labor = (costInputs.driverHourly || 0) * st.fare.min / 60;
  const profit = quotedValue() - toll - carCost - labor;
  const diff = quotedValue() - st.fare.total;
  $('profit').innerHTML = `
    ต้นทุนรถ ~${baht(carCost)} · ค่าแรง ~${baht(labor)} ·
    <b class="${profit < 0 ? 'neg' : 'pos'}">กำไร ~${baht(profit)}</b>
    ${diff ? `<span class="muted">(${diff > 0 ? '+' : ''}${baht(diff)} จากราคาคำนวณ)</span>` : ''}`;
}

$('quoted').addEventListener('input', () => {
  quotedManual = true;
  $('resetQuoted').hidden = false;
  renderProfit();
  refreshMessage();
});
$('resetQuoted').addEventListener('click', () => {
  quotedManual = false;
  refreshOffer(planner.state);
});

// ================= ข้อความใบเสนอราคา =================
function quoteText() {
  const st = planner.state, f = st.fare, t = st.trip;
  if (!f) return '';
  const name = $('custName').value.trim();
  const dt = t.datetime instanceof Date && !Number.isNaN(t.datetime.getTime()) ? fmtDateTime(t.datetime) : '-';
  const extras = [t.roundTrip && 'ไป-กลับ', t.airport && 'รับ/ส่งสนามบิน', t.waitHours && `รอ ${t.waitHours} ชม.`].filter(Boolean).join(' · ');
  const note = $('custNote').value.trim();
  return [
    `สวัสดีครับ${name ? 'คุณ' + name : ''} 🙏`,
    `ใบเสนอราคา: ${cfg.business?.name || 'รถรับส่ง'}`,
    '',
    `📅 ${dt}`,
    `🟢 รับ: ${shortPlace(st.pickup.name)}`,
    st.dropoff && `🔴 ${t.charter ? 'จุดหมายหลัก' : 'ส่ง'}: ${shortPlace(st.dropoff.name)}`,
    st.dropoff && `🗺️ เส้นทาง: ${mapsDirLink(st.pickup, st.dropoff)}`,
    t.charter
      ? `🚐 เหมา${f.plan.label} ${f.days} วัน · ${f.plan.hours} ชม./วัน · รวมระยะ ${f.includedKm} km${f.km > f.includedKm ? ` (ประมาณ ${Math.round(f.km)} km)` : ''}`
      : `🚗 ${f.vehicle.name} · ${f.km.toFixed(1)} km (~${Math.round(f.min)} นาที)`,
    t.charter && '⚡ รวมค่าไฟ/ค่าชาร์จแล้ว',
    extras && `➕ ${extras}`,
    f.chargeStops && `🔌 แวะชาร์จระหว่างทาง ${f.chargeStops} ครั้ง (~${f.chargeMinutes} นาที)`,
    '',
    `💰 ราคา ${Math.round(quotedValue()).toLocaleString('th-TH')} บาท${t.tollBaht ? ' (รวมค่าทางด่วนแล้ว)' : ' (ไม่รวมค่าทางด่วน ถ้ามี)'}`,
    note && `📝 ${note}`,
    '',
    confirmUrl() ? `✅ กดยืนยันการจอง: ${confirmUrl()}` : 'ตอบกลับ "ยืนยัน" เพื่อจองได้เลยครับ',
    cfg.business?.phone ? `โทร ${cfg.business.phone}` : '',
  ].filter((x) => x !== false && x !== 0 && x !== null && x !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function refreshMessage() {
  if (!planner.state.fare) return;
  if (!msgManual) $('msgPreview').value = quoteText();
  $('resetMsg').hidden = !msgManual;
  updateSendLinks();
}

$('msgPreview').addEventListener('input', () => { msgManual = true; $('resetMsg').hidden = false; updateSendLinks(); });
$('resetMsg').addEventListener('click', () => { msgManual = false; refreshMessage(); });
$('custNote').addEventListener('input', refreshMessage);

function updateSendLinks() {
  const text = $('msgPreview').value;
  const phone = normalizePhone($('custPhone').value);
  const okPhone = phone.length >= 9;
  for (const [id, href] of [['smsBtn', okPhone ? smsLink(phone, text) : null], ['waBtn', okPhone ? waLink(phone, text) : null]]) {
    const a = $(id);
    if (href) { a.href = href; a.removeAttribute('aria-disabled'); }
    else { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); }
  }
  $('lineBtn').href = lineShareLink(text);
  const st = planner.state;
  if (st.pickup && st.dropoff) $('mapsBtn').href = mapsDirLink(st.pickup, st.dropoff);
  $('sendHint').textContent = okPhone
    ? 'SMS จะส่งจากเบอร์มือถือของคุณ · LINE จะให้เลือกแชทของลูกค้า'
    : 'ใส่เบอร์โทรลูกค้าเพื่อส่ง SMS / WhatsApp · LINE จะให้เลือกแชทของลูกค้า';
}

// ================= บันทึก / ส่ง =================
async function save({ status, channel }) {
  const st = planner.state;
  if (!st.fare) { toast('ยังไม่มีเส้นทาง'); return null; }
  const name = $('custName').value.trim();
  const phone = normalizePhone($('custPhone').value);
  const line = $('custLine').value.trim();
  try {
    let cust = null;
    if (phone || line) {
      cust = await store.upsertCustomer({ id: customer.id || undefined, name, phone, line_id: line });
      customer = { id: cust.id, phone: cust.phone || '' };
    }
    const dt = st.trip.datetime;
    // งานที่ยืนยัน/เสร็จแล้วคงสถานะเดิม ยกเว้นลูกค้าขอเปลี่ยนแปลง → ส่งใบใหม่ให้ยืนยันอีกครั้ง
    const keepStatus = editing && ['confirmed', 'done'].includes(editing.status)
      && !(status === 'sent' && editing.customer_response === 'change_requested');
    editing = await store.saveQuote({
      id: editing?.id,
      customer_id: cust?.id ?? editing?.customer_id ?? null,
      customer_name: name,
      customer_phone: phone || null,
      customer_line: line || null,
      pickup: st.pickup,
      dropoff: st.dropoff,
      pickup_at: dt instanceof Date && !Number.isNaN(dt.getTime()) ? dt.toISOString() : null,
      distance_km: Math.round((st.trip.charter ? st.trip.distanceKm : st.route.distanceKm) * 100) / 100,
      duration_min: Math.round(st.trip.durationMin * 10) / 10,
      options: planner.readOptions(),
      fare_calc: st.fare.total,
      fare_quoted: Math.round(quotedValue()),
      status: keepStatus ? editing.status : status,
      source: editing?.source || 'driver',
      channel: channel || editing?.channel || null,
      note: $('custNote').value.trim(),
      ...(store.canConfirmLinks ? { confirm_token: confirmToken || editing?.confirm_token || null } : {}),
      // ส่งใบเสนอราคาใหม่หลังลูกค้าขอเปลี่ยนแปลง → เปิดให้ลูกค้าตอบได้อีกครั้ง
      ...(status === 'sent' && !keepStatus && editing?.customer_response ? { customer_response: null, response_note: null, responded_at: null } : {}),
    });
    renderEditBanner();
    return editing;
  } catch (err) {
    toast(`บันทึกไม่สำเร็จ: ${err.message}`);
    return null;
  }
}

const sendAndSave = (channel) => async (e) => {
  if (e.currentTarget.getAttribute('aria-disabled') === 'true') { e.preventDefault(); toast('ใส่เบอร์โทรลูกค้าก่อน'); return; }
  const saved = await save({ status: 'sent', channel });
  if (saved) toast('บันทึกใบเสนอราคาแล้ว');
};
$('smsBtn').addEventListener('click', sendAndSave('sms'));
$('waBtn').addEventListener('click', sendAndSave('whatsapp'));
$('lineBtn').addEventListener('click', sendAndSave('line'));
$('copyBtn').addEventListener('click', async () => {
  copySync($('msgPreview').value);
  toast('คัดลอกข้อความแล้ว');
  await save({ status: 'sent', channel: 'copy' });
});
$('saveBtn').addEventListener('click', async () => {
  const saved = await save({ status: editing?.status && editing.status !== 'request' ? editing.status : 'draft' });
  if (saved) toast('บันทึกแล้ว');
});

function renderEditBanner() {
  const b = $('editBanner');
  if (!editing) { b.hidden = true; return; }
  b.hidden = false;
  b.innerHTML = `
    <div>${statusBadge(editing.status)} ${editing.source === 'customer' ? 'คำขอจากลูกค้า' : 'ใบเสนอราคา'}
      · สร้าง ${esc(fmtDateTime(editing.created_at))}
      ${editing.customer_response === 'confirmed' ? `<div>✅ ลูกค้ากดยืนยันเองเมื่อ ${esc(fmtDateTime(editing.responded_at))}</div>` : ''}
      ${editing.customer_response === 'change_requested' ? `<div class="resp-change">✏️ ลูกค้าขอเปลี่ยนแปลง: <b>${esc(editing.response_note || '-')}</b><br><span class="muted">แก้ไขแล้วกดส่งใหม่ ลิงก์เดิมจะแสดงราคา/รายละเอียดล่าสุด</span></div>` : ''}</div>
    <a class="link-btn" href="quote.html">+ ใบใหม่</a>`;
}

// ================= เปิดจากลิงก์ (?quote= / ?customer=) =================
const params = new URLSearchParams(location.search);
if (params.get('quote')) {
  const q = await store.getQuote(params.get('quote')).catch(() => null);
  if (!q) toast('ไม่พบใบเสนอราคานี้');
  else {
    editing = q;
    confirmToken = q.confirm_token || null;
    renderEditBanner();
    $('custName').value = q.customer_name || '';
    $('custPhone').value = q.customer_phone ? phoneDisplay(q.customer_phone) : '';
    $('custLine').value = q.customer_line || '';
    $('custNote').value = q.note || '';
    if (q.customer_id) {
      const c = await store.getCustomer(q.customer_id).catch(() => null);
      if (c) { customer = { id: c.id, phone: c.phone || '' }; renderCustomerInfo(c); }
    }
    if (q.fare_quoted && q.source === 'driver') { quotedManual = true; $('quoted').value = q.fare_quoted; }
    await planner.load(q);
  }
} else if (params.get('customer')) {
  const c = await store.getCustomer(params.get('customer')).catch(() => null);
  if (c) selectCustomer(c);
}
