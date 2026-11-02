// ===== ฐานข้อมูลลูกค้า =====
import { requireDriver } from './auth.js';
import { customerStats } from './store.js';
import { $, esc, baht, toast, normalizePhone, phoneDisplay, fmtDateTime } from './ui.js';

const store = await requireDriver();
let customers = [];
let stats = new Map();

function matches(c, s) {
  if (!s) return true;
  const t = s.toLowerCase();
  const digits = t.replace(/\D/g, '');
  return (c.name || '').toLowerCase().includes(t) || (c.line_id || '').toLowerCase().includes(t)
    || (c.note || '').toLowerCase().includes(t) || (digits.length >= 2 && (c.phone || '').includes(digits));
}

function render() {
  const s = $('search').value.trim();
  const rows = customers.filter((c) => matches(c, s));
  const totalRevenue = [...stats.values()].reduce((a, x) => a + x.total, 0);
  $('summary').textContent = `ลูกค้าทั้งหมด ${customers.length} คน · รายได้รวมจากงานที่ยืนยัน ${baht(totalRevenue)}`;
  if (!rows.length) {
    $('list').innerHTML = `<div class="card empty">${customers.length ? 'ไม่พบลูกค้า' : 'ยังไม่มีลูกค้า ระบบจะบันทึกให้อัตโนมัติเมื่อส่งใบเสนอราคา หรือกด "+ เพิ่มลูกค้า"'}</div>`;
    return;
  }
  $('list').innerHTML = rows.map((c) => {
    const st = stats.get(c.id) || { trips: 0, total: 0, last: null, quotes: 0 };
    return `
    <article class="card item" data-id="${esc(c.id)}">
      <div class="item-head">
        <div><b class="item-name">${esc(c.name || '(ไม่มีชื่อ)')}</b></div>
        <div class="muted num">${st.trips} งาน · ${baht(st.total)}</div>
      </div>
      <div class="item-who">
        ${c.phone ? `📞 <a href="tel:${esc(c.phone)}">${esc(phoneDisplay(c.phone))}</a>` : ''}
        ${c.line_id ? ` · LINE ${esc(c.line_id)}` : ''}
      </div>
      <div class="muted">ใบเสนอราคา ${st.quotes} ใบ${st.last ? ' · ล่าสุด ' + esc(fmtDateTime(st.last)) : ''}</div>
      ${c.note ? `<div class="muted">📝 ${esc(c.note)}</div>` : ''}
      <div class="item-actions">
        <a class="btn primary" href="quote.html?customer=${encodeURIComponent(c.id)}">เสนอราคา</a>
        ${c.phone ? `<a class="btn" href="sms:${esc(c.phone)}">SMS</a>` : ''}
        ${c.line_id ? `<a class="btn" target="_blank" rel="noopener" href="https://line.me/ti/p/~${encodeURIComponent(c.line_id)}">LINE</a>` : ''}
        <a class="btn" href="history.html?customer=${encodeURIComponent(c.id)}">ประวัติ</a>
        <button type="button" data-act="edit">แก้ไข</button>
        <button type="button" data-act="delete" class="danger-text">ลบ</button>
      </div>
    </article>`;
  }).join('');
  $('list').querySelectorAll('[data-act="edit"]').forEach((b) => b.addEventListener('click', () => {
    openForm(customers.find((c) => c.id === b.closest('[data-id]').dataset.id));
  }));
  $('list').querySelectorAll('[data-act="delete"]').forEach((b) => b.addEventListener('click', async () => {
    const c = customers.find((x) => x.id === b.closest('[data-id]').dataset.id);
    if (!confirm(`ลบลูกค้า "${c.name}"? ประวัติใบเสนอราคายังอยู่ แต่จะไม่ผูกกับลูกค้าคนนี้แล้ว`)) return;
    try { await store.deleteCustomer(c.id); toast('ลบแล้ว'); load(); }
    catch (err) { toast(`ลบไม่สำเร็จ: ${err.message}`); }
  }));
}

function openForm(c) {
  $('form').hidden = false;
  $('formTitle').textContent = c ? 'แก้ไขลูกค้า' : 'เพิ่มลูกค้า';
  $('fId').value = c?.id || '';
  $('fName').value = c?.name || '';
  $('fPhone').value = c?.phone ? phoneDisplay(c.phone) : '';
  $('fLine').value = c?.line_id || '';
  $('fNote').value = c?.note || '';
  $('form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('fName').focus();
}

$('addBtn').addEventListener('click', () => openForm(null));
$('cancelBtn').addEventListener('click', () => { $('form').hidden = true; });
$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const phone = normalizePhone($('fPhone').value);
  if (!phone && !$('fLine').value.trim()) { toast('ใส่เบอร์โทรหรือ LINE ID อย่างน้อย 1 อย่าง'); return; }
  try {
    await store.upsertCustomer({
      id: $('fId').value || undefined,
      name: $('fName').value.trim(),
      phone,
      line_id: $('fLine').value.trim(),
      note: $('fNote').value.trim(),
    });
    $('form').hidden = true;
    toast('บันทึกลูกค้าแล้ว');
    load();
  } catch (err) { toast(`บันทึกไม่สำเร็จ: ${err.message}`); }
});
$('search').addEventListener('input', render);

async function load() {
  try {
    const [cs, qs] = await Promise.all([store.listCustomers(), store.listQuotes({ limit: 2000 })]);
    customers = cs;
    stats = customerStats(qs);
  } catch (err) { toast(`โหลดไม่สำเร็จ: ${err.message}`); }
  render();
}
load();
