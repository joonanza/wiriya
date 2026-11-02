// ===== ส่งออกข้อมูล CSV / JSON สำหรับสำรอง (เปิดใน Excel / Google Sheets ได้) =====
import { STATUS } from './ui.js';
import { EXPENSE_CATEGORIES } from './stats.js';

/** escape ค่า 1 ช่องตาม RFC 4180 + กัน CSV/formula injection (ค่าที่ขึ้นต้นด้วย = + - @ จะถูกเติม ') */
export function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** columns = [[หัวคอลัมน์, (row) => ค่า], ...] → ข้อความ CSV (มี BOM ให้ Excel อ่านภาษาไทยถูก) */
export function toCSV(rows, columns) {
  const head = columns.map(([h]) => csvCell(h)).join(',');
  const body = rows.map((r) => columns.map(([, f]) => csvCell(f(r))).join(','));
  return `﻿${[head, ...body].join('\r\n')}\r\n`;
}

const dt = (iso) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16) : '');

export const CUSTOMER_COLUMNS = [
  ['ชื่อ', (c) => c.name],
  ['เบอร์โทร', (c) => c.phone],
  ['LINE ID', (c) => c.line_id],
  ['บันทึก', (c) => c.note],
  ['สร้างเมื่อ', (c) => dt(c.created_at)],
];

export const QUOTE_COLUMNS = [
  ['สร้างเมื่อ', (q) => dt(q.created_at)],
  ['วัน-เวลารับ', (q) => dt(q.pickup_at)],
  ['สถานะ', (q) => STATUS[q.status]?.label || q.status],
  ['ที่มา', (q) => (q.source === 'customer' ? 'ลูกค้าขอเอง' : 'คนขับเสนอ')],
  ['ลูกค้า', (q) => q.customer_name],
  ['เบอร์โทร', (q) => q.customer_phone],
  ['LINE ID', (q) => q.customer_line],
  ['จุดรับ', (q) => q.pickup?.name],
  ['จุดส่ง', (q) => q.dropoff?.name],
  ['ระยะทาง (km)', (q) => q.distance_km],
  ['ไป-กลับ', (q) => (q.options?.roundTrip ? 'ใช่' : '')],
  ['ค่าทางด่วน', (q) => q.options?.tollBaht || ''],
  ['ราคาคำนวณ', (q) => q.fare_calc],
  ['ราคาที่เสนอ', (q) => q.fare_quoted],
  ['ส่งทาง', (q) => q.channel],
  ['หมายเหตุ', (q) => q.note],
];

export const EXPENSE_COLUMNS = [
  ['วันที่', (e) => e.date],
  ['ประเภท', (e) => EXPENSE_CATEGORIES[e.category] || e.category],
  ['จำนวนเงิน', (e) => e.amount],
  ['เลขไมล์', (e) => e.odometer_km],
  ['รายละเอียด', (e) => e.note],
];

export function downloadFile(filename, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const stamp = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
