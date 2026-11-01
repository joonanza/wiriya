import { loadFareConfig } from './config.js';
import { calculateFare } from './pricing.js';
import { searchPlaces, reverseGeocode, getRoute } from './geo.js';

const cfg = loadFareConfig();
const $ = (id) => document.getElementById(id);
const baht = (x) => `${Math.round(x).toLocaleString('th-TH')} ฿`;
const bahtExact = (x) => `${x.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ฿`;

const state = { pickup: null, dropoff: null, route: null, fare: null };

// ---------- init form ----------
if (cfg.business?.name) { $('bizName').textContent = cfg.business.name; document.title = `${cfg.business.name} · คำนวณค่าเดินทาง`; }
for (const v of cfg.vehicles) {
  const o = document.createElement('option');
  o.value = v.id; o.textContent = `${v.name}`;
  $('vehicle').append(o);
}
if (cfg.vehicles.length < 2) $('vehicle').closest('.field').hidden = true;
const pad = (x) => String(x).padStart(2, '0');
const now = new Date(Date.now() + 30 * 60000);
$('datetime').value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

// ---------- map ----------
const hasMap = typeof window.L !== 'undefined';
let map, markers = {}, routeLine;
if (hasMap) {
  map = L.map('map').setView([13.7563, 100.5018], 11);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  map.on('click', async (e) => {
    const which = !state.pickup ? 'pickup' : !state.dropoff ? 'dropoff' : 'dropoff';
    await setPlace(which, { lat: e.latlng.lat, lng: e.latlng.lng }, null);
  });
} else {
  $('map').innerHTML = '<p class="empty" style="padding:16px">โหลดแผนที่ไม่ได้ — ยังค้นหาสถานที่จากช่องด้านซ้ายได้</p>';
}

function markerIcon(kind) {
  const color = getComputedStyle(document.documentElement).getPropertyValue(kind === 'pickup' ? '--accent' : '--danger').trim();
  return L.divIcon({
    className: '',
    html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [18, 18], iconAnchor: [9, 9],
  });
}

async function setPlace(which, latlng, name) {
  state[which] = { ...latlng, name: name || 'กำลังค้นหาที่อยู่…' };
  $(which).value = state[which].name;
  if (hasMap) {
    if (markers[which]) markers[which].setLatLng(latlng);
    else {
      markers[which] = L.marker(latlng, { draggable: true, icon: markerIcon(which) }).addTo(map);
      markers[which].on('dragend', (ev) => {
        const p = ev.target.getLatLng();
        setPlace(which, { lat: p.lat, lng: p.lng }, null);
      });
    }
  }
  const routeP = updateRoute();
  if (!name) {
    const resolved = await reverseGeocode(latlng.lat, latlng.lng);
    if (state[which] && state[which].lat === latlng.lat) { state[which].name = resolved; $(which).value = resolved; updateBooking(); }
  }
  await routeP;
}

// ---------- autocomplete ----------
function setupAutocomplete(which) {
  const input = $(which);
  const list = $(`${which}Suggest`);
  let timer, ctrl, items = [], active = -1;
  const close = () => { list.hidden = true; active = -1; };
  const render = () => {
    list.replaceChildren(...items.map((it, i) => {
      const li = document.createElement('li');
      li.textContent = it.name;
      li.className = i === active ? 'active' : '';
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });
      return li;
    }));
    list.hidden = items.length === 0;
  };
  const choose = (i) => {
    const it = items[i]; if (!it) return;
    close();
    setPlace(which, { lat: it.lat, lng: it.lng }, it.name);
    if (hasMap) map.setView([it.lat, it.lng], Math.max(map.getZoom(), 13));
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { items = []; close(); return; }
    timer = setTimeout(async () => {
      ctrl?.abort(); ctrl = new AbortController();
      try { items = await searchPlaces(q, { signal: ctrl.signal }); active = -1; render(); }
      catch (err) { if (err.name !== 'AbortError') toast(err.message || 'ค้นหาไม่สำเร็จ'); }
    }, 600); // หน่วงเพื่อไม่ยิง Nominatim ถี่เกิน
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { choose(active < 0 ? 0 : active); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
}
setupAutocomplete('pickup');
setupAutocomplete('dropoff');

$('gpsBtn').addEventListener('click', () => {
  if (!navigator.geolocation) { toast('อุปกรณ์นี้ไม่รองรับ GPS'); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setPlace('pickup', p, null);
      if (hasMap) map.setView([p.lat, p.lng], 15);
    },
    () => toast('ไม่สามารถอ่านตำแหน่งได้ — กรุณาอนุญาตการเข้าถึงตำแหน่ง'),
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

$('swapBtn').addEventListener('click', () => {
  [state.pickup, state.dropoff] = [state.dropoff, state.pickup];
  $('pickup').value = state.pickup?.name || '';
  $('dropoff').value = state.dropoff?.name || '';
  if (hasMap) {
    for (const k of ['pickup', 'dropoff']) { markers[k]?.remove(); delete markers[k]; }
    for (const k of ['pickup', 'dropoff']) {
      if (state[k]) {
        markers[k] = L.marker(state[k], { draggable: true, icon: markerIcon(k) }).addTo(map);
        markers[k].on('dragend', (ev) => { const p = ev.target.getLatLng(); setPlace(k, { lat: p.lat, lng: p.lng }, null); });
      }
    }
  }
  updateRoute();
});

// ---------- routing & pricing ----------
let routeSeq = 0;
async function updateRoute() {
  if (!state.pickup || !state.dropoff) { state.route = null; renderQuote(); return; }
  const seq = ++routeSeq;
  $('quote').innerHTML = '<p class="empty">กำลังคำนวณเส้นทาง…</p>';
  const r = await getRoute(state.pickup, state.dropoff);
  if (seq !== routeSeq) return; // มีคำขอใหม่กว่าแล้ว
  state.route = r;
  if (hasMap) {
    routeLine?.remove();
    const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    routeLine = L.polyline(r.coords, { color, weight: 5, opacity: 0.85, dashArray: r.estimated ? '8 8' : null }).addTo(map);
    map.fitBounds(routeLine.getBounds(), { padding: [40, 40] });
  }
  renderQuote();
}

function readTrip() {
  const r = state.route;
  return {
    distanceKm: r.distanceKm,
    durationMin: r.durationMin * (r.estimated ? 1 : cfg.trafficFactor || 1),
    vehicleId: $('vehicle').value,
    datetime: new Date($('datetime').value),
    roundTrip: $('roundTrip').checked,
    airport: $('airport').checked,
    waitHours: Number($('wait').value) || 0,
    tollBaht: Number($('toll').value) || 0,
  };
}

function renderQuote() {
  const box = $('quote');
  if (!state.route) {
    box.innerHTML = '<p class="empty">เลือกจุดรับและจุดส่งเพื่อดูราคา</p>';
    $('bookCard').hidden = true; state.fare = null; return;
  }
  const trip = readTrip();
  const f = calculateFare(cfg, trip);
  state.fare = f; state.trip = trip;

  const rows = f.lines.map((l) => `
    <tr><td>${esc(l.label)}${l.note ? `<span class="note">${esc(l.note)}</span>` : ''}</td>
    <td class="num">${bahtExact(Math.round(l.amount * 100) / 100)}</td></tr>`).join('');
  box.innerHTML = `
    <div class="total"><span>รวมทั้งหมด</span><span class="amount num">${baht(f.total)}</span></div>
    <div class="stats num">
      <span>ระยะทาง ${f.km.toFixed(1)} km</span>
      <span>เวลาประมาณ ${Math.round(f.min)} นาที</span>
      ${f.timeMultiplier.label ? `<span>${esc(f.timeMultiplier.label)} ×${f.timeMultiplier.multiplier}</span>` : ''}
    </div>
    ${f.chargeStops ? `<div class="notice">ระยะทางเกินระยะวิ่งต่อชาร์จ ต้องแวะชาร์จ ${f.chargeStops} ครั้ง (ประมาณ +${f.chargeMinutes} นาที)</div>` : ''}
    <table class="breakdown">${rows}</table>
    ${state.route.estimated ? '<div class="notice">เชื่อมต่อระบบเส้นทางไม่ได้ จึงใช้ระยะประมาณจากเส้นตรง × 1.35 ราคาอาจคลาดเคลื่อน</div>' : ''}`;
  $('bookCard').hidden = false;
  updateBooking();
}

function bookingText() {
  const f = state.fare, t = state.trip;
  if (!f) return '';
  const dt = t.datetime instanceof Date && !Number.isNaN(t.datetime.getTime())
    ? t.datetime.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
  const extras = [t.roundTrip && 'ไป-กลับ', t.airport && 'สนามบิน', t.waitHours && `รอ ${t.waitHours} ชม.`].filter(Boolean).join(', ');
  return [
    '🚗 ขอจองรถ',
    `ชื่อ: ${$('custName').value || '-'}`,
    `โทร: ${$('custPhone').value || '-'}`,
    `วัน-เวลา: ${dt}`,
    `รับ: ${state.pickup.name}`,
    `ส่ง: ${state.dropoff.name}`,
    `แผนที่: https://www.google.com/maps/dir/?api=1&origin=${state.pickup.lat},${state.pickup.lng}&destination=${state.dropoff.lat},${state.dropoff.lng}`,
    `รถ: ${f.vehicle.name}`,
    extras && `เพิ่มเติม: ${extras}`,
    `ระยะทาง: ${f.km.toFixed(1)} km`,
    f.chargeStops && `แวะชาร์จ: ${f.chargeStops} ครั้ง (~${f.chargeMinutes} นาที)`,
    `ราคาประเมิน: ${baht(f.total)}`,
    $('custNote').value && `หมายเหตุ: ${$('custNote').value}`,
  ].filter(Boolean).join('\n');
}

function updateBooking() {
  if (!state.fare) return;
  const text = encodeURIComponent(bookingText());
  const oa = (cfg.business?.lineOaId || '').trim();
  // มี LINE OA → ส่งข้อความเข้า OA โดยตรง, ไม่มี → เปิดหน้าแชร์ของ LINE
  $('lineBtn').href = oa
    ? `https://line.me/R/oaMessage/${encodeURIComponent(oa.startsWith('@') ? oa : '@' + oa)}/?${text}`
    : `https://line.me/R/msg/text/?${text}`;
  const phone = (cfg.business?.phone || '').replace(/[^\d+]/g, '');
  $('callBtn').hidden = !phone;
  if (phone) { $('callBtn').href = `tel:${phone}`; $('callBtn').textContent = `โทร ${cfg.business.phone}`; }
}

$('copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(bookingText()); toast('คัดลอกแล้ว'); }
  catch { toast('คัดลอกไม่สำเร็จ'); }
});

for (const id of ['vehicle', 'datetime', 'roundTrip', 'airport', 'wait', 'toll']) {
  $(id).addEventListener('input', renderQuote);
  $(id).addEventListener('change', renderQuote);
}
for (const id of ['custName', 'custPhone', 'custNote']) $(id).addEventListener('input', updateBooking);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
