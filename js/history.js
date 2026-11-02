// ===== ประวัติใบเสนอราคา / งาน =====
import { requireDriver } from './auth.js';
import {
  $, esc, baht, toast, phoneDisplay, fmtDateTime, shortPlace, mapsDirLink, STATUS, statusBadge,
} from './ui.js';

const store = await requireDriver();
const PAGE = 50;
const CHANNEL = { sms: 'SMS', line: 'LINE', whatsapp: 'WhatsApp', copy: 'คัดลอก' };
let all = [];
const params = new URLSearchParams(location.search);
let filter = params.get('status') || '';
let customerFilter = params.get('customer') || '';
let shown = PAGE;

const FILTERS = [['', 'ทั้งหมด'], ...Object.entries(STATUS).map(([k, v]) => [k, v.label])];

function renderFilters() {
  $('filters').innerHTML = FILTERS.map(([k, label]) => {
    const n = k ? all.filter((q) => q.status === k).length : all.length;
    return `<button type="button" class="chip ${k === filter ? 'active' : ''}" data-f="${k}" role="tab" aria-selected="${k === filter}">${label} <span class="muted">${n}</span></button>`;
  }).join('');
  $('filters').querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.f; shown = PAGE; render();
  }));
}

function renderKpis() {
  const now = new Date();
  const month = (iso) => { const d = new Date(iso); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); };
  const won = all.filter((q) => (q.status === 'confirmed' || q.status === 'done') && month(q.pickup_at || q.created_at));
  const upcoming = all.filter((q) => q.status === 'confirmed' && q.pickup_at && new Date(q.pickup_at) >= now);
  const sentAll = all.filter((q) => ['sent', 'confirmed', 'done', 'cancelled'].includes(q.status));
  const winRate = sentAll.length ? all.filter((q) => q.status === 'confirmed' || q.status === 'done').length / sentAll.length : 0;
  $('kpis').innerHTML = [
    ['คำขอใหม่', all.filter((q) => q.status === 'request').length, 'request'],
    ['รอลูกค้ายืนยัน', all.filter((q) => q.status === 'sent').length, 'sent'],
    ['งานที่จะถึง', upcoming.length, 'confirmed'],
    ['รายได้เดือนนี้', baht(won.reduce((s, q) => s + (Number(q.fare_quoted) || 0), 0)), ''],
    ['อัตราปิดงาน', `${Math.round(winRate * 100)}%`, ''],
  ].map(([k, v, f]) => `<button type="button" class="kpi ${f ? 'clickable' : ''}" ${f ? `data-f="${f}"` : 'disabled'}><div class="k">${k}</div><div class="v num">${v}</div></button>`).join('');
  $('kpis').querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; shown = PAGE; render(); }));
}

function matches(q, s) {
  if (!s) return true;
  const t = s.toLowerCase();
  const digits = t.replace(/\D/g, '');
  return [q.customer_name, q.customer_line, q.pickup?.name, q.dropoff?.name, q.note].some((x) => (x || '').toLowerCase().includes(t))
    || (digits.length >= 3 && (q.customer_phone || '').includes(digits));
}

function render() {
  renderFilters();
  renderKpis();
  const s = $('search').value.trim();
  const rows = all.filter((q) => (!filter || q.status === filter) && (!customerFilter || q.customer_id === customerFilter) && matches(q, s));
  const cf = $('custFilter');
  if (customerFilter) {
    const any = all.find((q) => q.customer_id === customerFilter);
    cf.hidden = false;
    cf.innerHTML = `เฉพาะลูกค้า: <b>${esc(any?.customer_name || '-')}</b> <button type="button" class="link-btn" id="clearCust">แสดงทั้งหมด ✕</button>`;
    $('clearCust').onclick = () => { customerFilter = ''; history.replaceState(null, '', 'history.html'); render(); };
  } else cf.hidden = true;
  const list = $('list');
  if (!rows.length) {
    list.innerHTML = `<div class="card empty">${all.length ? 'ไม่พบรายการที่ตรงกับเงื่อนไข' : 'ยังไม่มีใบเสนอราคา เริ่มจากหน้า "เสนอราคา"'}</div>`;
    $('moreBtn').hidden = true;
    return;
  }
  list.innerHTML = rows.slice(0, shown).map((q) => `
    <article class="card item ${q.status === 'request' ? 'is-request' : ''}" data-id="${esc(q.id)}">
      <div class="item-head">
        <div>${statusBadge(q.status)} <span class="muted">${q.source === 'customer' ? 'ลูกค้าขอเอง · ' : ''}${q.channel ? 'ส่งทาง ' + esc(CHANNEL[q.channel] || q.channel) + ' · ' : ''}${esc(fmtDateTime(q.created_at))}</span></div>
        <div class="item-price num">${q.fare_quoted ? baht(q.fare_quoted) : '-'}</div>
      </div>
      <div class="item-who"><b>${esc(q.customer_name || '(ไม่มีชื่อ)')}</b>
        ${q.customer_phone ? `· <a href="tel:${esc(q.customer_phone)}">${esc(phoneDisplay(q.customer_phone))}</a>` : ''}
        ${q.customer_line ? `· LINE ${esc(q.customer_line)}` : ''}</div>
      <div class="item-route">📅 ${esc(q.pickup_at ? fmtDateTime(q.pickup_at) : '-')}<br>
        🟢 ${esc(shortPlace(q.pickup?.name))}<br>🔴 ${esc(shortPlace(q.dropoff?.name))}
        ${q.distance_km ? `<span class="muted"> · ${Number(q.distance_km).toFixed(1)} km${q.options?.roundTrip ? ' (ไป-กลับ)' : ''}</span>` : ''}</div>
      ${q.note ? `<div class="muted">📝 ${esc(q.note)}</div>` : ''}
      ${q.customer_response === 'confirmed' ? `<div class="resp-ok">✅ ลูกค้ากดยืนยันเอง · ${esc(fmtDateTime(q.responded_at))}</div>` : ''}
      ${q.customer_response === 'change_requested' ? `<div class="resp-change">✏️ ลูกค้าขอเปลี่ยนแปลง: <b>${esc(q.response_note || '-')}</b></div>` : ''}
      <div class="item-actions">
        <select data-act="status" aria-label="เปลี่ยนสถานะ">
          ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === q.status ? 'selected' : ''}>${v.label}</option>`).join('')}
        </select>
        <a class="btn ${q.status === 'request' ? 'primary' : ''}" href="quote.html?quote=${encodeURIComponent(q.id)}">${q.status === 'request' ? 'เสนอราคา' : 'เปิด/แก้ไข'}</a>
        ${q.pickup && q.dropoff ? `<a class="btn" target="_blank" rel="noopener" href="${mapsDirLink(q.pickup, q.dropoff)}">นำทาง</a>` : ''}
        <button type="button" data-act="delete" class="danger-text">ลบ</button>
      </div>
    </article>`).join('');
  $('moreBtn').hidden = rows.length <= shown;

  list.querySelectorAll('[data-act="status"]').forEach((sel) => sel.addEventListener('change', async () => {
    const id = sel.closest('[data-id]').dataset.id;
    try {
      const saved = await store.updateQuoteStatus(id, sel.value);
      Object.assign(all.find((q) => q.id === id), saved);
      toast(`เปลี่ยนสถานะเป็น "${STATUS[sel.value].label}" แล้ว`);
      render();
    } catch (err) { toast(`ไม่สำเร็จ: ${err.message}`); }
  }));
  list.querySelectorAll('[data-act="delete"]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.closest('[data-id]').dataset.id;
    if (!confirm('ลบใบเสนอราคานี้? (กู้คืนไม่ได้)')) return;
    try { await store.deleteQuote(id); all = all.filter((q) => q.id !== id); toast('ลบแล้ว'); render(); }
    catch (err) { toast(`ลบไม่สำเร็จ: ${err.message}`); }
  }));
}

async function load() {
  try { all = await store.listQuotes({ limit: 1000 }); }
  catch (err) { toast(`โหลดไม่สำเร็จ: ${err.message}`); all = []; }
  render();
}

$('search').addEventListener('input', () => { shown = PAGE; render(); });
$('moreBtn').addEventListener('click', () => { shown += PAGE; render(); });
$('refreshBtn').addEventListener('click', load);
load();
