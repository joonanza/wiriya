// ===== หน้าลูกค้า: ประเมินราคาเอง → ส่งคำขอจองเข้าระบบ / ส่งทาง LINE / โทร =====
import { getStore } from './store.js';
import { createTripPlanner } from './trip.js';
import {
  $, baht, toast, copySync, normalizePhone, phoneDisplay, fmtDateTime, mapsDirLink,
} from './ui.js';

const ME_KEY = 'wiriya.me.v1';
const store = await getStore();
const cfg = await store.getFareConfig();

if (cfg.business?.name) { $('bizName').textContent = cfg.business.name; document.title = `${cfg.business.name} · จองรถ`; }

const planner = createTripPlanner(cfg, { onUpdate: refreshBooking });

// ---------- จดจำข้อมูลลูกค้าในเครื่อง ----------
function loadMe() {
  try { return JSON.parse(localStorage.getItem(ME_KEY) || 'null'); } catch { return null; }
}
function saveMe() {
  try {
    if ($('rememberMe').checked) {
      localStorage.setItem(ME_KEY, JSON.stringify({
        name: $('custName').value.trim(), phone: normalizePhone($('custPhone').value), line_id: $('custLine').value.trim(),
      }));
    } else localStorage.removeItem(ME_KEY);
  } catch { /* storage ถูกบล็อก */ }
}
const me = loadMe();
if (me) {
  $('custName').value = me.name || '';
  $('custPhone').value = me.phone ? phoneDisplay(me.phone) : '';
  $('custLine').value = me.line_id || '';
  if (me.name) { $('welcomeBack').hidden = false; $('welcomeBack').textContent = `ยินดีต้อนรับกลับมา คุณ${me.name} 👋`; }
}
$('rememberMe').addEventListener('change', saveMe);

// ---------- ข้อความจอง ----------
function bookingText() {
  const st = planner.state, f = st.fare, t = st.trip;
  if (!f) return '';
  const dt = t.datetime instanceof Date && !Number.isNaN(t.datetime.getTime()) ? fmtDateTime(t.datetime) : '-';
  const extras = [t.roundTrip && 'ไป-กลับ', t.airport && 'สนามบิน', t.waitHours && `รอ ${t.waitHours} ชม.`].filter(Boolean).join(', ');
  return [
    '🚗 ขอจองรถ',
    `ชื่อ: ${$('custName').value || '-'}`,
    `โทร: ${$('custPhone').value || '-'}`,
    $('custLine').value && `LINE: ${$('custLine').value}`,
    `วัน-เวลา: ${dt}`,
    `รับ: ${st.pickup.name}`,
    `ส่ง: ${st.dropoff.name}`,
    `แผนที่: ${mapsDirLink(st.pickup, st.dropoff)}`,
    `รถ: ${f.vehicle.name}`,
    extras && `เพิ่มเติม: ${extras}`,
    `ระยะทาง: ${f.km.toFixed(1)} km`,
    f.chargeStops && `แวะชาร์จ: ${f.chargeStops} ครั้ง (~${f.chargeMinutes} นาที)`,
    `ราคาประเมิน: ${baht(f.total)}`,
    $('custNote').value && `หมายเหตุ: ${$('custNote').value}`,
  ].filter(Boolean).join('\n');
}

function refreshBooking(st) {
  $('bookCard').hidden = !st.fare;
  if (!st.fare) return;
  $('submitBtn').hidden = !store.canSubmitRequest;
  const text = encodeURIComponent(bookingText());
  const oa = (cfg.business?.lineOaId || '').trim();
  const lineId = (cfg.business?.lineId || '').trim().replace(/^~/, '');
  const btn = $('lineBtn');
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
  if (!store.canSubmitRequest) btn.classList.add('primary');
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

// ---------- ส่งคำขอจองเข้าระบบ (เฉพาะเมื่อเชื่อมฐานข้อมูลแล้ว) ----------
$('submitBtn').addEventListener('click', async () => {
  const st = planner.state;
  const phone = normalizePhone($('custPhone').value);
  const line = $('custLine').value.trim();
  if (!$('custName').value.trim()) { toast('กรุณาใส่ชื่อ'); $('custName').focus(); return; }
  if (phone.length < 9 && !line) { toast('กรุณาใส่เบอร์โทรหรือ LINE ID'); $('custPhone').focus(); return; }
  $('submitBtn').disabled = true;
  try {
    const dt = st.trip.datetime;
    await store.submitRequest({
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
    });
    saveMe();
    $('successBox').hidden = false;
    $('successBox').innerHTML = `✅ ส่งคำขอจองแล้ว คนขับจะติดต่อกลับเพื่อยืนยันราคาทาง${phone ? ' SMS/โทร' : ''}${line ? ' LINE' : ''} โดยเร็ว`;
    $('submitBtn').textContent = 'ส่งคำขอแล้ว';
  } catch (err) {
    $('submitBtn').disabled = false;
    toast(`ส่งไม่สำเร็จ: ${err.message}`);
  }
});
