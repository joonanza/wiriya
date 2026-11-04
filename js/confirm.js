// ===== หน้ายืนยันการจองของลูกค้า (เปิดจากลิงก์ในใบเสนอราคา: confirm.html?t=<token>) =====
import { getStore } from './store.js';
import { $, esc, toast, fmtDateTime, shortPlace, mapsDirLink } from './ui.js';

const token = new URLSearchParams(location.search).get('t') || '';
const store = await getStore();
let cfg = {};
try { cfg = await store.getFareConfig(); } catch { /* ใช้ค่าเริ่มต้น */ }
const biz = cfg.business || {};
if (biz.name) { $('bizName').textContent = biz.name; document.title = `ยืนยันการจอง · ${biz.name}`; }

function renderContact() {
  const phone = (biz.phone || '').replace(/[^\d+]/g, '');
  const line = biz.lineOaId ? `https://line.me/R/ti/p/${encodeURIComponent(biz.lineOaId.startsWith('@') ? biz.lineOaId : '@' + biz.lineOaId)}`
    : biz.lineId ? `https://line.me/ti/p/~${encodeURIComponent(biz.lineId)}` : '';
  if (!phone && !line) return;
  $('contact').hidden = false;
  $('contact').innerHTML = `<h2>ติดต่อคนขับ</h2><div class="actions">
    ${phone ? `<a class="btn" href="tel:${esc(phone)}">📞 โทร ${esc(biz.phone)}</a>` : ''}
    ${line ? `<a class="btn line" href="${esc(line)}" target="_blank" rel="noopener">LINE</a>` : ''}</div>`;
}

function calendarLink(q) {
  if (!q.pickup_at) return '';
  const start = new Date(q.pickup_at);
  const end = new Date(start.getTime() + Math.max(30, Number(q.duration_min) || 60) * 60000);
  const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `รถรับส่ง ${biz.name || ''}`.trim(),
    dates: `${f(start)}/${f(end)}`,
    location: q.pickup_name || '',
    details: `รับ: ${q.pickup_name || '-'}\nส่ง: ${q.dropoff_name || '-'}\nราคา ${Math.round(q.fare_quoted || 0)} บาท`,
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

const dRow = (label, valueHtml) => `<dt>${label}</dt><dd>${valueHtml}</dd>`;
const fmtDuration = (min) => {
  const m = Math.round(Number(min) || 0);
  return m >= 60 ? `${Math.floor(m / 60)} ชม.${m % 60 ? ` ${m % 60} นาที` : ''}` : `${m} นาที`;
};

function render(q) {
  const opts = q.options || {};
  const ch = opts.charter;
  const charter = ch && ch.type
    ? `เหมา${ch.type === 'half' ? 'ครึ่งวัน' : 'เต็มวัน'}${Number(ch.days) > 1 ? ` ${Number(ch.days)} วัน` : ''} · รวมค่าไฟ/ค่าชาร์จแล้ว`
    : '';
  const extras = [opts.roundTrip && 'ไป-กลับ', opts.airport && 'รับ/ส่งสนามบิน', opts.waitHours && `รอ ${opts.waitHours} ชม.`].filter(Boolean).join(' · ');
  const state = q.customer_response === 'confirmed' || q.status === 'confirmed'
    ? `<div class="success">✅ ยืนยันการจองแล้ว${q.responded_at ? ` เมื่อ ${esc(fmtDateTime(q.responded_at))}` : ''} · แล้วพบกันครับ 🙏</div>`
    : q.customer_response === 'change_requested'
      ? '<div class="notice">✏️ ส่งคำขอเปลี่ยนแปลงแล้ว คนขับจะติดต่อกลับพร้อมใบเสนอราคาใหม่</div>'
      : q.expired ? '<div class="notice">⌛ ลิงก์นี้หมดอายุแล้ว กรุณาติดต่อคนขับ</div>' : '';
  const coords = q.pickup && q.dropoff;
  $('box').innerHTML = `
    <h2>ใบเสนอราคา${q.customer_name ? ` · คุณ${esc(q.customer_name)}` : ''}</h2>
    <div class="confirm-price"><span class="muted">ราคา</span><span class="amount num">${Math.round(q.fare_quoted || 0).toLocaleString('th-TH')} บาท</span></div>
    <p class="muted">${opts.tollBaht ? 'รวมค่าทางด่วนแล้ว' : 'ไม่รวมค่าทางด่วน (ถ้ามี)'}</p>
    <dl class="detail-list">
      ${dRow('📅 วัน-เวลารับ', `<b>${esc(q.pickup_at ? fmtDateTime(q.pickup_at) : '-')}</b>`)}
      ${dRow('🟢 จุดรับ', esc(shortPlace(q.pickup_name)))}
      ${q.dropoff_name && q.dropoff_name !== q.pickup_name ? dRow('🔴 จุดส่ง', esc(shortPlace(q.dropoff_name))) : ''}
      ${charter ? dRow('🚐 รูปแบบ', esc(charter)) : ''}
      ${q.distance_km ? dRow('📏 ระยะทาง', `${charter ? '~' : ''}${Number(q.distance_km).toFixed(0)} km${q.duration_min && !charter ? ` (~${fmtDuration(q.duration_min)})` : ''}`) : ''}
      ${extras ? dRow('➕ เพิ่มเติม', esc(extras)) : ''}
      ${q.note ? dRow('📝 หมายเหตุ', esc(q.note)) : ''}
      ${q.customer_phone_masked ? dRow('📞 เบอร์ผู้จอง', esc(q.customer_phone_masked)) : ''}
    </dl>
    ${state}
    <div class="actions">
      ${coords ? `<a class="btn" target="_blank" rel="noopener" href="${mapsDirLink(q.pickup, q.dropoff)}">🗺️ ดูเส้นทาง</a>` : ''}
      ${(q.status === 'confirmed' && q.pickup_at) ? `<a class="btn" target="_blank" rel="noopener" href="${calendarLink(q)}">📅 เพิ่มลงปฏิทิน</a>` : ''}
    </div>`;
  const canConfirm = q.status === 'sent' && !q.expired && q.customer_response !== 'confirmed';
  const canChange = (q.status === 'sent' && !q.expired) || q.status === 'confirmed';
  $('actions').hidden = !(canConfirm || canChange);
  $('confirmBtn').hidden = !canConfirm;
  $('changeToggle').textContent = canConfirm ? 'ขอเปลี่ยนแปลง / ยกเลิก' : 'ขอเปลี่ยนแปลง / ยกเลิกการจอง';
}

async function load() {
  if (store.mode === 'error') {
    $('box').innerHTML = `<p class="notice">เชื่อมต่อระบบไม่ได้ (${esc(store.connectionError || '')})</p><button type="button" class="primary" onclick="location.reload()">ลองใหม่</button>`;
    renderContact();
    return null;
  }
  if (!store.canConfirmLinks) {
    $('box').innerHTML = '<p class="notice">ระบบยืนยันออนไลน์ยังไม่พร้อม กรุณาตอบกลับคนขับทางข้อความ</p>';
    renderContact();
    return null;
  }
  try {
    const q = await store.getQuoteByToken(token);
    if (!q) {
      $('box').innerHTML = '<h2>ไม่พบใบเสนอราคา</h2><p class="notice">ลิงก์ไม่ถูกต้อง หรือถูกยกเลิกแล้ว กรุณาติดต่อคนขับ</p>';
      renderContact();
      return null;
    }
    render(q);
    renderContact();
    return q;
  } catch (e) {
    $('box').innerHTML = `<p class="notice">โหลดไม่สำเร็จ (${esc(e.message)}) ลองรีเฟรชอีกครั้ง</p>`;
    return null;
  }
}

async function respond(action) {
  const note = $('changeNote').value.trim();
  if (action === 'change' && !note) { toast('กรุณาพิมพ์สิ่งที่ต้องการเปลี่ยน'); $('changeNote').focus(); return; }
  const btn = action === 'confirm' ? $('confirmBtn') : $('changeBtn');
  btn.disabled = true;
  try {
    const r = await store.respondToQuote(token, action, note);
    if (r?.id && !r.already) store.notifyLineResponse(r.id).catch((e) => console.warn('แจ้ง LINE ไม่สำเร็จ', e));
    toast(action === 'confirm' ? 'ยืนยันการจองแล้ว ขอบคุณครับ' : 'ส่งคำขอเปลี่ยนแปลงแล้ว');
    $('changeBox').hidden = true;
    await load();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    toast(e.message);
  } finally { btn.disabled = false; }
}

$('confirmBtn').addEventListener('click', () => respond('confirm'));
$('changeToggle').addEventListener('click', () => { $('changeBox').hidden = !$('changeBox').hidden; if (!$('changeBox').hidden) $('changeNote').focus(); });
$('changeBtn').addEventListener('click', () => respond('change'));
load();
