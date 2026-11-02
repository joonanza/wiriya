// ===== หน้าแรกของคนขับ =====
import { requireDriver, enableNotifications } from './auth.js';
import { summarize, periodRange, upcomingJobs } from './stats.js';
import { $, esc, baht, toast, phoneDisplay, fmtDateTime, shortPlace, mapsDirLink } from './ui.js';

const store = await requireDriver();
const [cfg, costInputs] = await Promise.all([store.getFareConfig(), store.getCostInputs()]);
if (cfg.business?.name) $('bizName').textContent = cfg.business.name;

const now = new Date();
$('today').textContent = now.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const h = now.getHours();
$('greeting').textContent = h < 12 ? 'สวัสดีตอนเช้าครับ ☀️' : h < 17 ? 'สวัสดีตอนบ่ายครับ' : 'สวัสดีตอนเย็นครับ 🌙';

// ลิงก์ลูกค้า
const custUrl = new URL('customer.html', location.href).href;
$('custLink').value = custUrl;
$('shareLink').addEventListener('click', async () => {
  if (navigator.share) {
    try { await navigator.share({ title: cfg.business?.name || 'จองรถ', text: 'จองรถกับเราได้ที่ลิงก์นี้', url: custUrl }); } catch { /* ยกเลิก */ }
    return;
  }
  try { await navigator.clipboard.writeText(custUrl); toast('คัดลอกลิงก์แล้ว'); } catch { $('custLink').select(); }
});

// การแจ้งเตือน (ใช้ได้เมื่อเชื่อมฐานข้อมูล)
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

const jobCard = (q, extra = '') => `
  <a class="job" href="quote.html?quote=${encodeURIComponent(q.id)}">
    <div class="job-time num">${esc(q.pickup_at ? fmtDateTime(q.pickup_at) : '-')}</div>
    <div><b>${esc(q.customer_name || '(ไม่มีชื่อ)')}</b>${q.customer_phone ? ` <span class="muted">${esc(phoneDisplay(q.customer_phone))}</span>` : ''}</div>
    <div class="muted">🟢 ${esc(shortPlace(q.pickup?.name, 2))} → 🔴 ${esc(shortPlace(q.dropoff?.name, 2))}</div>
    <div class="job-foot"><b class="num">${q.fare_quoted ? baht(q.fare_quoted) : '-'}</b>${extra}</div>
  </a>`;

try {
  const quotes = await store.listQuotes({ limit: 5000 });
  const requests = quotes.filter((q) => q.status === 'request');
  if (requests.length) {
    $('requestAlert').hidden = false;
    $('requestAlert').innerHTML = `🔔 <b>คำขอใหม่ ${requests.length} รายการ</b> · ล่าสุดจาก ${esc(requests[0].customer_name || 'ลูกค้า')} <span class="muted">แตะเพื่อเสนอราคา →</span>`;
  }
  const today = summarize(quotes, [], costInputs, periodRange('today'));
  const month = summarize(quotes, [], costInputs, periodRange('month'));
  $('kpis').innerHTML = [
    ['รายได้วันนี้', baht(today.revenue), `${today.trips} เที่ยว`],
    ['รายได้เดือนนี้', baht(month.revenue), `${month.trips} เที่ยว · ${Math.round(month.km).toLocaleString('th-TH')} km`],
  ].map(([k, v, sub]) => `<a class="kpi" href="dashboard.html"><div class="k">${k}</div><div class="v num">${v}</div><div class="k">${sub}</div></a>`).join('');

  const up = upcomingJobs(quotes, new Date(), 5);
  $('upcoming').innerHTML = up.length
    ? up.map((q) => jobCard(q, q.pickup && q.dropoff ? `<span class="muted">แตะเพื่อดู · </span><span class="muted" data-nav="${esc(mapsDirLink(q.pickup, q.dropoff))}">นำทาง ↗</span>` : '')).join('')
    : '<p class="empty">ยังไม่มีงานที่ยืนยันแล้ว</p>';
  $('upcoming').querySelectorAll('[data-nav]').forEach((el) => el.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation(); window.open(el.dataset.nav, '_blank', 'noopener');
  }));

  const pending = quotes.filter((q) => q.status === 'sent').slice(0, 5);
  $('pending').innerHTML = pending.length
    ? pending.map((q) => jobCard(q, ` <span class="muted">ส่งเมื่อ ${esc(fmtDateTime(q.updated_at || q.created_at))}</span>`)).join('')
    : '<p class="empty">ไม่มีใบเสนอราคาที่รอการยืนยัน</p>';
} catch (err) {
  toast(`โหลดข้อมูลไม่สำเร็จ: ${err.message}`);
}
