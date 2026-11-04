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

/** ข้อความแจ้งคนขับเมื่อลูกค้ากดยืนยัน / ขอเปลี่ยนแปลงจากลิงก์ในใบเสนอราคา */
export function buildResponseMessage(q, appUrl) {
  const base = String(appUrl || '').replace(/\/?$/, '/');
  const confirmed = q.customer_response === 'confirmed';
  const name = cut(q.customer_name || 'ลูกค้า', 60);
  const phone = String(q.customer_phone || '').replace(/\D/g, '');
  const when = fmtThaiDate(q.pickup_at);
  const head = confirmed ? '✅ ลูกค้ายืนยันการจองแล้ว' : '✏️ ลูกค้าขอเปลี่ยนแปลง';
  const rows = [
    row('ลูกค้า', name),
    row('📅 เวลา', when),
    row('🟢 รับ', shortPlace(q.pickup?.name)),
    row('🔴 ส่ง', shortPlace(q.dropoff?.name)),
    q.fare_quoted ? row('ราคา', `${Math.round(Number(q.fare_quoted)).toLocaleString('th-TH')} บาท`) : null,
    !confirmed && q.response_note ? row('ข้อความ', q.response_note) : null,
  ].filter(Boolean);
  const buttons = [
    base.startsWith('https://') ? uriButton(confirmed ? 'ดูงาน' : 'แก้ไขใบเสนอราคา', `${base}quote.html?quote=${encodeURIComponent(q.id)}`, 'primary') : null,
    phone.length >= 9 ? uriButton(`โทร ${phoneDisplay(phone)}`, `tel:${phone}`) : null,
  ].filter(Boolean);
  return {
    type: 'flex',
    altText: cut(`${head}: ${name} | ${when}${!confirmed && q.response_note ? ' | ' + q.response_note : ''}`, 400),
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box', layout: 'vertical', paddingAll: '16px', backgroundColor: confirmed ? GREEN : '#9a5b00',
        contents: [{ type: 'text', text: head, color: '#ffffff', weight: 'bold', size: 'lg' }],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'md', contents: rows },
      ...(buttons.length ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons } } : {}),
    },
  };
}

// ---------- 📋 สรุปงานพรุ่งนี้ (ส่งทุก 22:00 น.) ----------
const TZ_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Bangkok (UTC+7, ไม่มี DST)
const DAILY_MAX_JOBS = 12;               // กันข้อความ Flex ใหญ่เกินขีดจำกัดของ LINE
const STATUS_LABEL = {
  request: ['คำขอใหม่', '#b42318'],
  draft: ['ร่าง', '#888888'],
  sent: ['รอยืนยัน', '#9a5b00'],
  confirmed: ['ยืนยันแล้ว', GREEN],
  done: ['เสร็จแล้ว', GREEN],
};

/** ช่วงเวลา [start, end) ของ "พรุ่งนี้" ตามเวลาไทย คืนค่าเป็น Date (UTC) */
export function bangkokTomorrow(now) {
  const local = new Date(now.getTime() + TZ_OFFSET_MS);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) - TZ_OFFSET_MS;
  return { start: new Date(start), end: new Date(start + 24 * 60 * 60 * 1000) };
}

const fmtTime = (iso) => new Date(iso).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
const fmtDay = (d) => d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' });

/**
 * เลือกงานที่ต้องทำในวัน [start,end) — งานที่เวลารับอยู่ในวันนั้น และงานเหมาหลายวันที่คาบเกี่ยว
 * ไม่รวมงานที่ยกเลิก เรียงตามเวลา
 */
export function jobsForDay(quotes, start, end) {
  const DAY = 24 * 60 * 60 * 1000;
  const out = [];
  for (const q of quotes || []) {
    if (!q || !q.pickup_at || q.status === 'cancelled' || !STATUS_LABEL[q.status]) continue;
    const t = new Date(q.pickup_at).getTime();
    if (!Number.isFinite(t)) continue;
    const days = Math.max(1, Math.round(Number(q.options?.charter?.days) || 1));
    if (t >= start.getTime() && t < end.getTime()) { out.push({ q, dayIndex: 1, days, sortKey: t }); continue; }
    if (days > 1 && t < start.getTime()) {
      // วันที่เท่าไรของงานเหมา (นับตามวันปฏิทินไทย)
      const idx = Math.floor((start.getTime() + TZ_OFFSET_MS) / DAY) - Math.floor((t + TZ_OFFSET_MS) / DAY) + 1;
      if (idx >= 2 && idx <= days) out.push({ q, dayIndex: idx, days, sortKey: start.getTime() - 1 });
    }
  }
  return out.sort((a, b) => a.sortKey - b.sortKey);
}

/** ข้อความสรุปงานพรุ่งนี้ */
export function buildDailyMessage(jobs, day, appUrl) {
  const base = String(appUrl || '').replace(/\/?$/, '/');
  const hasApp = base.startsWith('https://');
  const dayLabel = fmtDay(day);
  const shown = jobs.slice(0, DAILY_MAX_JOBS);
  const total = shown.reduce((s, j) => s + (j.dayIndex === 1 ? Number(j.q.fare_quoted) || 0 : 0), 0);

  const jobBox = ({ q, dayIndex, days }, i) => {
    const [label, color] = STATUS_LABEL[q.status];
    const phone = String(q.customer_phone || '').replace(/\D/g, '');
    const charter = q.options?.charter;
    const time = dayIndex > 1 ? `ทั้งวัน (วันที่ ${dayIndex}/${days})` : fmtTime(q.pickup_at);
    const lines = [
      {
        type: 'box', layout: 'baseline', spacing: 'sm',
        contents: [
          { type: 'text', text: `🕒 ${time}`, weight: 'bold', size: 'md', color: '#111111', flex: 5, wrap: true },
          { type: 'text', text: label, size: 'xs', color, align: 'end', flex: 2 },
        ],
      },
      { type: 'text', text: `🟢 ${shortPlace(q.pickup?.name, 2)}`, size: 'sm', wrap: true, color: '#333333' },
    ];
    const drop = q.dropoff?.name && q.dropoff?.name !== q.pickup?.name ? shortPlace(q.dropoff.name, 2) : null;
    if (drop) lines.push({ type: 'text', text: `🔴 ${drop}`, size: 'sm', wrap: true, color: '#333333' });
    if (charter && charter.type) lines.push({ type: 'text', text: `🚐 เหมา${charter.type === 'half' ? 'ครึ่งวัน' : 'เต็มวัน'}${days > 1 ? ` ${days} วัน` : ''}`, size: 'xs', color: '#555555' });
    const who = [cut(q.customer_name || 'ลูกค้า', 40), phone ? phoneDisplay(phone) : null,
      q.fare_quoted && dayIndex === 1 ? `${Math.round(Number(q.fare_quoted)).toLocaleString('th-TH')} ฿` : null].filter(Boolean).join(' · ');
    lines.push({ type: 'text', text: `👤 ${who}`, size: 'xs', color: '#888888', wrap: true });
    return {
      type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '10px', cornerRadius: '8px', backgroundColor: '#f5f7f6',
      ...(i > 0 ? { margin: 'md' } : {}),
      ...(hasApp ? { action: { type: 'uri', label: 'เปิดงาน', uri: `${base}quote.html?quote=${encodeURIComponent(q.id)}` } } : {}),
      contents: lines,
    };
  };

  const body = shown.map(jobBox);
  if (jobs.length > shown.length) body.push({ type: 'text', text: `+ อีก ${jobs.length - shown.length} งาน ดูในแอป`, size: 'sm', color: '#888888', margin: 'md' });

  const first = shown[0];
  const altText = cut(`📋 งานพรุ่งนี้ ${dayLabel}: ${jobs.length} งาน${first ? ` · เริ่ม ${first.dayIndex > 1 ? 'ทั้งวัน' : fmtTime(first.q.pickup_at)} ${shortPlace(first.q.pickup?.name, 1)}` : ''}`, 400);
  return {
    type: 'flex',
    altText,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: GREEN, paddingAll: '16px',
        contents: [
          { type: 'text', text: `📋 งานพรุ่งนี้ · ${jobs.length} งาน`, color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: `📅 ${dayLabel}${total ? ` · รวม ${Math.round(total).toLocaleString('th-TH')} ฿` : ''}`, color: '#e2f3ea', size: 'sm', margin: 'sm' },
        ],
      },
      body: { type: 'box', layout: 'vertical', contents: body },
      ...(hasApp ? { footer: { type: 'box', layout: 'vertical', contents: [uriButton('เปิดปฏิทินงาน', `${base}index.html`, 'primary')] } } : {}),
    },
  };
}
