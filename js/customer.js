// ===== หน้าลูกค้า: เลือกเส้นทาง → ส่งคำขอจองเข้าระบบของคนขับ (บันทึกประวัติทั้งฝั่งคนขับและในเครื่องลูกค้า) =====
import { getStore } from './store.js';
import { createTripPlanner } from './trip.js';
import {
  $, esc, baht, toast, copySync, normalizePhone, phoneDisplay, fmtDateTime, mapsDirLink, shortPlace,
} from './ui.js';

const ME_KEY = 'wiriya.me.v1';
const MY_REQ_KEY = 'wiriya.myRequests.v1';
const store = await getStore();
const cfg = await store.getFareConfig();
const showPrice = !!cfg.showPriceToCustomer;
const online = store.canSubmitRequest; // เชื่อมฐานข้อมูลแล้ว → ส่งคำขอเข้าแอปคนขับได้

if (cfg.business?.name) { $('bizName').textContent = cfg.business.name; document.title = `${cfg.business.name} · จองรถ`; }
$('quoteTitle').textContent = showPrice ? 'ราคาประเมิน' : 'สรุปการเดินทาง';
$('priceNote').textContent = showPrice
  ? 'ราคาเป็นการประเมินจากเส้นทาง คนขับจะยืนยันราคาสุดท้ายกับคุณอีกครั้ง'
  : 'คนขับจะคำนวณและแจ้งราคาให้คุณทาง SMS / LINE / โทร';

const planner = createTripPlanner(cfg, { onUpdate: refreshBooking, showPrice });

// ---------- จดจำข้อมูลลูกค้าในเครื่อง ----------
const readJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage ถูกบล็อก */ } };

function saveMe() {
  if ($('rememberMe').checked) {
    writeJson(ME_KEY, { name: $('custName').value.trim(), phone: normalizePhone($('custPhone').value), line_id: $('custLine').value.trim() });
  } else {
    try { localStorage.removeItem(ME_KEY); } catch { /* ignore */ }
  }
}
const me = readJson(ME_KEY, null);
if (me) {
  $('custName').value = me.name || '';
  $('custPhone').value = me.phone ? phoneDisplay(me.phone) : '';
  $('custLine').value = me.line_id || '';
  if (me.name) { $('welcomeBack').hidden = false; $('welcomeBack').textContent = `ยินดีต้อนรับกลับมา คุณ${me.name} 👋`; }
}
$('rememberMe').addEventListener('change', saveMe);

// ---------- ประวัติคำขอในเครื่องลูกค้า ----------
function renderMyRequests() {
  const list = readJson(MY_REQ_KEY, []);
  $('myRequestsCard').hidden = list.length === 0;
  $('myRequests').innerHTML = list.map((r, i) => `
    <div class="my-req">
      <div><b>${esc(fmtDateTime(r.pickup_at))}</b> <span class="muted">· ส่งเมื่อ ${esc(fmtDateTime(r.sent_at))}</span></div>
      <div>🟢 ${esc(shortPlace(r.pickup?.name, 2))}<br>🔴 ${esc(shortPlace(r.dropoff?.name, 2))}</div>
      <button type="button" class="link-btn" data-again="${i}">ใช้เส้นทางนี้อีกครั้ง</button>
    </div>`).join('');
  $('myRequests').querySelectorAll('[data-again]').forEach((b) => b.addEventListener('click', () => {
    const r = list[Number(b.dataset.again)];
    planner.load({ pickup: r.pickup, dropoff: r.dropoff, options: r.options });
    $('successBox').hidden = true;
    $('submitBtn').disabled = false; $('submitBtn').textContent = '📨 ส่งคำขอจอง';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
}
renderMyRequests();

// ---------- ข้อความจอง (ใช้เมื่อยังไม่เชื่อมฐานข้อมูล) ----------
function bookingText() {
  const st = planner.state, f = st.fare, t = st.trip;
  if (!f) return '';
  const extras = [t.roundTrip && 'ไป-กลับ', t.airport && 'สนามบิน', t.waitHours && `รอ ${t.waitHours} ชม.`].filter(Boolean).join(', ');
  return [
    '🚗 ขอจองรถ',
    `ชื่อ: ${$('custName').value || '-'}`,
    `โทร: ${$('custPhone').value || '-'}`,
    $('custLine').value && `LINE: ${$('custLine').value}`,
    `วัน-เวลา: ${fmtDateTime(t.datetime)}`,
    `รับ: ${st.pickup.name}`,
    `ส่ง: ${st.dropoff.name}`,
    `แผนที่: ${mapsDirLink(st.pickup, st.dropoff)}`,
    extras && `เพิ่มเติม: ${extras}`,
    `ระยะทาง: ${f.km.toFixed(1)} km`,
    showPrice && `ราคาประเมิน: ${baht(f.total)}`,
    $('custNote').value && `หมายเหตุ: ${$('custNote').value}`,
  ].filter(Boolean).join('\n');
}

function refreshBooking(st) {
  $('bookCard').hidden = !st.fare;
  if (!st.fare) return;
  $('submitBtn').hidden = !online;
  // ยังไม่เชื่อมฐานข้อมูล → ใช้ LINE / คัดลอกแทน
  $('lineBtn').hidden = online;
  $('copyBtn').hidden = online;
  if (!online) {
    const text = encodeURIComponent(bookingText());
    const oa = (cfg.business?.lineOaId || '').trim();
    const lineId = (cfg.business?.lineId || '').trim().replace(/^~/, '');
    const btn = $('lineBtn');
    btn.classList.add('primary');
    $('lineHint').hidden = true;
    if (oa) {
      btn.href = `https://line.me/R/oaMessage/${encodeURIComponent(oa.startsWith('@') ? oa : '@' + oa)}/?${text}`;
      btn.textContent = 'ส่งทาง LINE';
    } else if (lineId) {
      btn.href = `https://line.me/ti/p/~${encodeURIComponent(lineId)}`;
      btn.textContent = `คัดลอก + เปิด LINE (${lineId})`;
      $('lineHint').textContent = 'กดแล้วระบบจะคัดลอกรายละเอียดการจองให้อัตโนมัติ เมื่อ LINE เปิดขึ้นมา ให้กด "แชท" แล้ว "วาง" ข้อความส่งได้เลย';
      $('lineHint').hidden = false;
    } else {
      btn.href = `https://line.me/R/msg/text/?${text}`;
      btn.textContent = 'ส่งทาง LINE';
    }
  }
  const phone = (cfg.business?.phone || '').replace(/[^\d+]/g, '');
  $('callBtn').hidden = !phone;
  if (phone) { $('callBtn').href = `tel:${phone}`; $('callBtn').textContent = `โทร ${cfg.business.phone}`; }
}
for (const id of ['custName', 'custPhone', 'custLine', 'custNote']) {
  $(id).addEventListener('input', () => refreshBooking(planner.state));
}

$('lineBtn').addEventListener('click', () => {
  saveMe();
  if (cfg.business?.lineOaId || !cfg.business?.lineId) return;
  copySync(bookingText());
  toast('คัดลอกรายละเอียดแล้ว ให้วางในแชท LINE');
});
$('copyBtn').addEventListener('click', () => { saveMe(); copySync(bookingText()); toast('คัดลอกแล้ว'); });

// ---------- ส่งคำขอจองเข้าระบบ ----------
$('submitBtn').addEventListener('click', async () => {
  const st = planner.state;
  const phone = normalizePhone($('custPhone').value);
  const line = $('custLine').value.trim();
  if (!$('custName').value.trim()) { toast('กรุณาใส่ชื่อ'); $('custName').focus(); return; }
  if (phone.length < 9 && !line) { toast('กรุณาใส่เบอร์โทรหรือ LINE ID'); $('custPhone').focus(); return; }
  $('submitBtn').disabled = true;
  $('submitBtn').textContent = 'กำลังส่ง…';
  try {
    const dt = st.trip.datetime;
    const payload = {
      customer_name: $('custName').value.trim(),
      customer_phone: phone,
      customer_line: line,
      pickup: st.pickup,
      dropoff: st.dropoff,
      pickup_at: dt instanceof Date && !Number.isNaN(dt.getTime()) ? dt.toISOString() : '',
      distance_km: Math.round(st.route.distanceKm * 100) / 100,
      duration_min: Math.round(st.trip.durationMin * 10) / 10,
      options: planner.readOptions(),
      fare_calc: st.fare.total,
      note: $('custNote').value.trim(),
    };
    await store.submitRequest(payload);
    saveMe();
    const mine = readJson(MY_REQ_KEY, []);
    mine.unshift({ pickup: payload.pickup, dropoff: payload.dropoff, pickup_at: payload.pickup_at, options: payload.options, sent_at: new Date().toISOString() });
    writeJson(MY_REQ_KEY, mine.slice(0, 10));
    renderMyRequests();
    $('successBox').hidden = false;
    $('successBox').innerHTML = `✅ ส่งคำขอจองแล้ว คนขับจะติดต่อกลับเพื่อแจ้งราคาทาง${phone ? ' SMS / โทร' : ''}${line ? ' LINE' : ''} โดยเร็ว`;
    $('submitBtn').textContent = '✓ ส่งคำขอแล้ว';
  } catch (err) {
    $('submitBtn').disabled = false;
    $('submitBtn').textContent = '📨 ส่งคำขอจอง';
    toast(`ส่งไม่สำเร็จ: ${err.message}`);
  }
});
