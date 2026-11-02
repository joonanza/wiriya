// ===== Helper ที่ใช้ร่วมกันทุกหน้า =====
export const $ = (id) => document.getElementById(id);

export const baht = (x) => `${Math.round(Number(x) || 0).toLocaleString('th-TH')} ฿`;
export const bahtExact = (x) => `${Number(x).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ฿`;

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
export function toast(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

/** คัดลอกแบบ synchronous (ต้องเรียกใน click handler โดยตรง ไม่งั้น iOS Safari บล็อก) */
export function copySync(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.append(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  if (!ok) navigator.clipboard?.writeText(text).catch(() => {});
  return true;
}

/** เบอร์ไทย → 0XXXXXXXXX (ตัดขีด/วรรค, +66 → 0) */
export function normalizePhone(p) {
  let d = String(p ?? '').replace(/\D/g, '');
  if (d.startsWith('66') && d.length === 11) d = '0' + d.slice(2);
  return d;
}
export const phoneDisplay = (p) => {
  const d = normalizePhone(p);
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d;
};
export const phoneIntl = (p) => {
  const d = normalizePhone(p);
  return d.startsWith('0') ? '66' + d.slice(1) : d;
};

const pad = (x) => String(x).padStart(2, '0');
/** Date → ค่าสำหรับ <input type="datetime-local"> */
export const toLocalInput = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function fmtDateTime(iso) {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

/** ชื่อสถานที่จาก Nominatim ยาวมาก → เอา 2–3 ส่วนแรก */
export function shortPlace(name, parts = 3) {
  if (!name) return '-';
  const segs = String(name).split(',').map((s) => s.trim()).filter(Boolean);
  return segs.slice(0, parts).join(', ');
}

export const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);

/** ลิงก์ SMS: iOS ใช้ &body=, Android ใช้ ?body= */
export function smsLink(phone, text) {
  const num = normalizePhone(phone);
  return `sms:${num}${isIOS() ? '&' : '?'}body=${encodeURIComponent(text)}`;
}
export const waLink = (phone, text) => `https://wa.me/${phoneIntl(phone)}?text=${encodeURIComponent(text)}`;
export const lineShareLink = (text) => `https://line.me/R/msg/text/?${encodeURIComponent(text)}`;
export const mapsDirLink = (a, b) =>
  `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}`;

export const STATUS = {
  request: { label: 'คำขอใหม่', cls: 'st-request' },
  draft: { label: 'ร่าง', cls: 'st-draft' },
  sent: { label: 'ส่งแล้ว', cls: 'st-sent' },
  confirmed: { label: 'ยืนยันแล้ว', cls: 'st-confirmed' },
  done: { label: 'เสร็จสิ้น', cls: 'st-done' },
  cancelled: { label: 'ยกเลิก', cls: 'st-cancelled' },
};
export const statusBadge = (s) => `<span class="badge ${STATUS[s]?.cls || ''}">${esc(STATUS[s]?.label || s)}</span>`;

/** token สุ่มสำหรับลิงก์ยืนยัน (base62, ค่าเริ่มต้น 32 ตัว ≈ 190 bit) */
export function randomToken(len = 32) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const out = [];
  const buf = new Uint8Array(len * 2);
  while (out.length < len) {
    crypto.getRandomValues(buf);
    for (const b of buf) { if (b < 248 && out.length < len) out.push(abc[b % 62]); } // ตัด bias
  }
  return out.join('');
}
