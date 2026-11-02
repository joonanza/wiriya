// ===== สร้างข้อความ LINE (Flex Message) สำหรับแจ้งคนขับเมื่อมีคำขอจองใหม่ =====
// ไฟล์นี้เป็น JavaScript ล้วน ใช้ได้ทั้งใน Supabase Edge Function (Deno) และ unit test (Node)

const GREEN = '#0f7a4f';
const cut = (s, n) => {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const shortPlace = (name, parts = 3) =>
  cut(String(name || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, parts).join(', ') || '-', 120);

export function fmtThaiDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
}

const phoneDisplay = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d;
};

const row = (label, value) => ({
  type: 'box',
  layout: 'baseline',
  spacing: 'sm',
  contents: [
    { type: 'text', text: label, color: '#888888', size: 'sm', flex: 2 },
    { type: 'text', text: cut(value, 300) || '-', wrap: true, size: 'sm', color: '#111111', flex: 6 },
  ],
});

const uriButton = (label, uri, style = 'secondary') => ({
  type: 'button',
  style,
  height: 'sm',
  ...(style === 'primary' ? { color: GREEN } : {}),
  action: { type: 'uri', label, uri },
});

const validLatLng = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));

/** ข้อความแจ้งคำขอจองใหม่ */
export function buildRequestMessage(q, appUrl) {
  const base = String(appUrl || '').replace(/\/?$/, '/');
  const name = cut(q.customer_name || 'ลูกค้า', 60);
  const phone = String(q.customer_phone || '').replace(/\D/g, '');
  const opts = q.options || {};
  const km = Number(q.distance_km) || 0;
  const min = Number(q.duration_min) || 0;
  const tripLine = [
    km ? `${km.toFixed(1)} km` : null,
    min ? `~${Math.round(min)} นาที` : null,
    opts.roundTrip ? 'ไป-กลับ' : null,
    opts.airport ? 'สนามบิน' : null,
    opts.waitHours ? `รอ ${opts.waitHours} ชม.` : null,
  ].filter(Boolean).join(' · ') || '-';

  const rows = [
    row('ลูกค้า', name),
    phone ? row('โทร', phoneDisplay(phone)) : null,
    q.customer_line ? row('LINE', q.customer_line) : null,
    row('🟢 รับ', shortPlace(q.pickup?.name)),
    row('🔴 ส่ง', shortPlace(q.dropoff?.name)),
    row('ระยะทาง', tripLine),
    q.note ? row('หมายเหตุ', q.note) : null,
  ].filter(Boolean);

  const buttons = [
    base.startsWith('https://') ? uriButton('เสนอราคา', `${base}quote.html?quote=${encodeURIComponent(q.id)}`, 'primary') : null,
    validLatLng(q.pickup) && validLatLng(q.dropoff)
      ? uriButton('นำทาง (Google Maps)', `https://www.google.com/maps/dir/?api=1&origin=${q.pickup.lat},${q.pickup.lng}&destination=${q.dropoff.lat},${q.dropoff.lng}`)
      : null,
    phone.length >= 9 ? uriButton(`โทร ${phoneDisplay(phone)}`, `tel:${phone}`) : null,
  ].filter(Boolean);

  const when = fmtThaiDate(q.pickup_at);
  const altText = cut(`🔔 คำขอจองใหม่: ${name}${phone ? ' ' + phoneDisplay(phone) : ''} | ${when} | ${shortPlace(q.pickup?.name, 1)} → ${shortPlace(q.dropoff?.name, 1)}`, 400);

  return {
    type: 'flex',
    altText,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: GREEN,
        paddingAll: '16px',
        contents: [
          { type: 'text', text: '🔔 คำขอจองใหม่', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: `📅 ${when}`, color: '#e2f3ea', size: 'sm', margin: 'sm' },
        ],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'md', contents: rows },
      ...(buttons.length ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons } } : {}),
    },
  };
}

/** ข้อความทดสอบจากหน้าตั้งค่า */
export function buildTestMessage(appUrl) {
  const base = String(appUrl || '').replace(/\/?$/, '/');
  return {
    type: 'text',
    text: `✅ ทดสอบการแจ้งเตือนสำเร็จ\nเมื่อลูกค้าส่งคำขอจอง คุณจะได้รับข้อความแบบนี้ทาง LINE${base.startsWith('https://') ? `\n\nเปิดแอป: ${base}` : ''}`,
  };
}
