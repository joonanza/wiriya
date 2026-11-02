// ===== หน้าแรกของคนขับ: สรุปรายเดือน + กราฟ + ปฏิทินงาน + งานวันนี้/พรุ่งนี้ =====
import { requireDriver, enableNotifications } from './auth.js';
import { upcomingJobs, monthGrid, jobsByDay, jobsOnDay, monthStats, monthTrend, dayKey } from './stats.js';
import { $, esc, baht, toast, phoneDisplay, fmtDateTime, shortPlace, mapsDirLink, STATUS } from './ui.js';

const store = await requireDriver();
const cfg = await store.getFareConfig();
if (cfg.business?.name) $('bizName').textContent = cfg.business.name;

const now = new Date();
$('today').textContent = now.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const h = now.getHours();
$('greeting').textContent = h < 12 ? 'สวัสดีตอนเช้าครับ ☀️' : h < 17 ? 'สวัสดีตอนบ่ายครับ' : 'สวัสดีตอนเย็นครับ 🌙';

let quotes = [];
let view = { year: now.getFullYear(), month: now.getMonth() };       // เดือนที่แสดง (สรุป + ปฏิทิน)
let selected = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // วันที่เลือกในปฏิทิน

const monthName = (y, m) => new Date(y, m, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
const timeOf = (iso) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

// ---------------------------------------------------------------- สรุป + กราฟ
function renderSummary() {
  const s = monthStats(quotes, view.year, view.month);
  const trend = monthTrend(quotes, view.year, view.month, 6);
  const isThisMonth = view.year === now.getFullYear() && view.month === now.getMonth();
  $('sumTitle').textContent = `สรุป · ${monthName(view.year, view.month)}`;
  $('sumSub').textContent = isThisMonth ? 'เดือนนี้' : '';
  $('jobsVal').textContent = `${s.jobs.toLocaleString('th-TH')} งาน`;
  $('jobsSub').textContent = s.jobs ? `เสร็จแล้ว ${s.done} · รออีก ${s.upcoming} · ${Math.round(s.km).toLocaleString('th-TH')} km` : 'ยังไม่มีงานในเดือนนี้';
  $('revVal').textContent = baht(s.revenue);
  $('revSub').textContent = s.revenue ? `ได้รับแล้ว ~${baht(s.revenueDone)} · จะได้อีก ${baht(s.revenue - s.revenueDone)}` : 'ยังไม่มีรายได้ในเดือนนี้';
  sparkline($('jobsSpark'), trend, 'jobs', (v) => `${v} งาน`);
  sparkline($('revSpark'), trend, 'revenue', (v) => baht(v));
}

/** กราฟเส้นขนาดเล็ก (series เดียว) พร้อม tooltip เมื่อแตะ/ชี้แต่ละเดือน */
function sparkline(el, series, key, fmt) {
  const W = Math.max(200, el.clientWidth || 280), H = 84, padX = 10, padTop = 10, padBot = 22;
  const vals = series.map((d) => d[key]);
  const max = Math.max(1, ...vals);
  const x = (i) => padX + (i * (W - padX * 2)) / Math.max(1, series.length - 1);
  const y = (v) => padTop + (H - padTop - padBot) * (1 - v / max);
  const pts = series.map((d, i) => [x(i), y(d[key])]);
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const area = `${line} L${pts.at(-1)[0].toFixed(1)},${H - padBot} L${pts[0][0].toFixed(1)},${H - padBot} Z`;
  const last = pts.length - 1;
  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="แนวโน้ม 6 เดือน: ${series.map((d) => `${d.label} ${fmt(d[key])}`).join(', ')}">
      <line x1="${padX}" x2="${W - padX}" y1="${H - padBot}" y2="${H - padBot}" class="baseline"/>
      <path d="${area}" class="spark-area"/>
      <path d="${line}" class="spark-line"/>
      ${pts.map(([px, py], i) => `<g class="spark-pt" data-i="${i}" tabindex="0">
        <rect x="${px - (W / series.length) / 2}" y="0" width="${W / series.length}" height="${H}" fill="transparent"/>
        <circle cx="${px}" cy="${py}" r="${i === last ? 4.5 : 3}" class="${i === last ? 'pt-current' : 'pt'}"/></g>`).join('')}
      <text x="${padX}" y="${H - 6}" class="axis">${esc(series[0].label)}</text>
      <text x="${W - padX}" y="${H - 6}" class="axis" text-anchor="end">${esc(series.at(-1).label)}</text>
    </svg>`;
  const tip = $('chartTip');
  el.querySelectorAll('.spark-pt').forEach((g) => {
    const show = () => {
      const d = series[Number(g.dataset.i)];
      tip.innerHTML = `<b>${esc(monthName(d.year, d.month))}</b><br>${esc(fmt(d[key]))}`;
      tip.hidden = false;
      const r = g.querySelector('circle').getBoundingClientRect();
      tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2))}px`;
      tip.style.top = `${Math.max(8, r.top - 6)}px`;
      g.querySelector('circle').classList.add('hover');
    };
    const hide = () => { tip.hidden = true; g.querySelector('circle').classList.remove('hover'); };
    g.addEventListener('pointerenter', show);
    g.addEventListener('pointerleave', hide);
    g.addEventListener('focus', show);
    g.addEventListener('blur', hide);
  });
}

// ---------------------------------------------------------------- ปฏิทิน
function renderCalendar() {
  $('calTitle').textContent = monthName(view.year, view.month);
  const byDay = jobsByDay(quotes, view.year, view.month);
  const heads = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map((d) => `<div class="cal-h" role="columnheader">${d}</div>`).join('');
  const cells = monthGrid(view.year, view.month).flat().map(({ date, inMonth }) => {
    const k = dayKey(date);
    const jobs = inMonth ? byDay.get(k) || [] : [];
    const isToday = k === dayKey(now);
    const isSel = k === dayKey(selected);
    const dots = jobs.slice(0, 3).map((q) => `<i class="dot-s ${q.status === 'confirmed' || q.status === 'done' ? 'st-confirmed-dot' : q.status === 'sent' ? 'st-sent-dot' : 'st-request-dot'}"></i>`).join('');
    const label = `${date.toLocaleDateString('th-TH', { day: 'numeric', month: 'long' })}${jobs.length ? ` ${jobs.length} งาน` : ''}`;
    return `<button type="button" role="gridcell" class="cal-d ${inMonth ? '' : 'out'} ${isToday ? 'today' : ''} ${isSel ? 'sel' : ''}"
      data-k="${k}" aria-label="${esc(label)}" ${isSel ? 'aria-selected="true"' : ''}>
      <span class="cal-n">${date.getDate()}</span><span class="cal-dots">${dots}${jobs.length > 3 ? '<b>+</b>' : ''}</span></button>`;
  }).join('');
  $('cal').innerHTML = heads + cells;
  $('cal').querySelectorAll('.cal-d').forEach((b) => b.addEventListener('click', () => {
    const [y, m, d] = b.dataset.k.split('-').map(Number);
    selected = new Date(y, m - 1, d);
    if (m - 1 !== view.month || y !== view.year) { view = { year: y, month: m - 1 }; renderSummary(); }
    renderCalendar();
    renderDays();
  }));
}

// ---------------------------------------------------------------- งานวันที่เลือก / วันถัดไป
const jobCard = (q, extra = '') => `
  <a class="job" href="quote.html?quote=${encodeURIComponent(q.id)}">
    <div class="job-time num">${esc(q.pickup_at ? fmtDateTime(q.pickup_at) : '-')}</div>
    <div><b>${esc(q.customer_name || '(ไม่มีชื่อ)')}</b>${q.customer_phone ? ` <span class="muted">${esc(phoneDisplay(q.customer_phone))}</span>` : ''}</div>
    <div class="muted">🟢 ${esc(shortPlace(q.pickup?.name, 2))} → 🔴 ${esc(shortPlace(q.dropoff?.name, 2))}</div>
    <div class="job-foot"><b class="num">${q.fare_quoted ? baht(q.fare_quoted) : '-'}</b>${extra}</div>
  </a>`;

const dayRow = (q) => `
  <a class="day-job" href="quote.html?quote=${encodeURIComponent(q.id)}">
    <span class="day-time num">${timeOf(q.pickup_at)}</span>
    <span class="day-txt"><b>${esc(q.customer_name || '(ไม่มีชื่อ)')}</b>
      <span class="muted">${esc(shortPlace(q.pickup?.name, 1))} → ${esc(shortPlace(q.dropoff?.name, 1))}</span></span>
    <span class="badge ${STATUS[q.status]?.cls || ''}">${esc(STATUS[q.status]?.label || q.status)}</span>
  </a>`;

function renderDays() {
  const next = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate() + 1);
  const today = dayKey(selected) === dayKey(now);
  const label = (d) => d.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
  $('day1Title').textContent = today ? 'วันนี้' : label(selected);
  $('day2Title').textContent = today ? 'พรุ่งนี้' : label(next);
  for (const [id, d] of [['day1', selected], ['day2', next]]) {
    const jobs = jobsOnDay(quotes, d);
    const firm = jobs.filter((q) => q.status === 'confirmed' || q.status === 'done');
    $(`${id}Sum`).textContent = `${firm.length} งาน · ${baht(firm.reduce((s, q) => s + (Number(q.fare_quoted) || 0), 0))}`;
    $(id).innerHTML = jobs.length ? jobs.map(dayRow).join('') : '<p class="empty">ไม่มีงาน</p>';
  }
}

// ---------------------------------------------------------------- เปลี่ยนเดือน
function shiftMonth(delta) {
  const d = new Date(view.year, view.month + delta, 1);
  view = { year: d.getFullYear(), month: d.getMonth() };
  renderSummary();
  renderCalendar();
}
for (const [id, delta] of [['mPrev', -1], ['mNext', 1], ['cPrev', -1], ['cNext', 1]]) $(id).addEventListener('click', () => shiftMonth(delta));

// ---------------------------------------------------------------- ลิงก์ลูกค้า + การแจ้งเตือน
const custUrl = new URL('customer.html', location.href).href;
$('custLink').value = custUrl;
$('shareLink').addEventListener('click', async () => {
  if (navigator.share) {
    try { await navigator.share({ title: cfg.business?.name || 'จองรถ', text: 'จองรถกับเราได้ที่ลิงก์นี้', url: custUrl }); } catch { /* ยกเลิก */ }
    return;
  }
  try { await navigator.clipboard.writeText(custUrl); toast('คัดลอกลิงก์แล้ว'); } catch { $('custLink').select(); }
});
if (store.mode === 'supabase' && 'Notification' in window) {
  $('notifyRow').hidden = Notification.permission === 'granted';
  $('notifyNote').textContent = Notification.permission === 'granted'
    ? '🔔 เปิดการแจ้งเตือนแล้ว (แจ้งเตือนขณะเปิดแอปค้างไว้ในเบราว์เซอร์)'
    : 'เปิดการแจ้งเตือนเพื่อให้มือถือเด้งเมื่อมีคำขอใหม่ ขณะแอปเปิดค้างไว้';
  $('notifyBtn').addEventListener('click', async () => {
    const r = await enableNotifications();
    toast(r === 'granted' ? 'เปิดการแจ้งเตือนแล้ว' : 'ไม่ได้รับอนุญาตให้แจ้งเตือน');
    $('notifyRow').hidden = r === 'granted';
  });
} else if (store.mode !== 'supabase') {
  $('notifyNote').textContent = '⚠️ ต้องเชื่อมฐานข้อมูลก่อน ลูกค้าจึงส่งคำขอเข้าแอปได้ (ตอนนี้ลูกค้าจะส่งทาง LINE แทน)';
}

// ---------------------------------------------------------------- โหลดข้อมูล
try {
  quotes = await store.listQuotes({ limit: 5000 });
} catch (err) {
  toast(`โหลดข้อมูลไม่สำเร็จ: ${err.message}`);
}
const requests = quotes.filter((q) => q.status === 'request');
if (requests.length) {
  $('requestAlert').hidden = false;
  $('requestAlert').innerHTML = `🔔 <b>คำขอใหม่ ${requests.length} รายการ</b> · ล่าสุดจาก ${esc(requests[0].customer_name || 'ลูกค้า')} <span class="muted">แตะเพื่อเสนอราคา →</span>`;
}
renderSummary();
renderCalendar();
renderDays();

const up = upcomingJobs(quotes, new Date(), 5);
$('upcoming').innerHTML = up.length
  ? up.map((q) => jobCard(q, q.pickup && q.dropoff ? `<span class="muted" data-nav="${esc(mapsDirLink(q.pickup, q.dropoff))}">นำทาง ↗</span>` : '')).join('')
  : '<p class="empty">ยังไม่มีงานที่ยืนยันแล้ว</p>';
$('upcoming').querySelectorAll('[data-nav]').forEach((el) => el.addEventListener('click', (e) => {
  e.preventDefault(); e.stopPropagation(); window.open(el.dataset.nav, '_blank', 'noopener');
}));
const pending = quotes.filter((q) => q.status === 'sent').slice(0, 5);
$('pending').innerHTML = pending.length
  ? pending.map((q) => jobCard(q, ` <span class="muted">ส่งเมื่อ ${esc(fmtDateTime(q.updated_at || q.created_at))}</span>`)).join('')
  : '<p class="empty">ไม่มีใบเสนอราคาที่รอการยืนยัน</p>';

let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderSummary, 150); });
