// @ts-nocheck
// ⚠️ ไฟล์นี้สร้างอัตโนมัติจาก message.js + handler.js + index.ts (npm run bundle:line) ห้ามแก้ตรงนี้
// วางทั้งไฟล์นี้ใน Supabase Dashboard → Edge Functions → notify-line → index.ts

// ===== Supabase Edge Function: notify-line =====
// ส่ง LINE (ผ่าน LINE Official Account / Messaging API) หาคนขับเมื่อลูกค้าส่งคำขอจอง
//
// Secrets ที่ต้องตั้ง (Dashboard → Edge Functions → Secrets):
//   LINE_CHANNEL_ACCESS_TOKEN  channel access token (long-lived) ของ Messaging API channel
//   LINE_DRIVER_USER_ID        User ID ของคนขับ (ขึ้นต้นด้วย U...) ใส่หลายคนคั่นด้วย , ได้
//   APP_URL                    เช่น https://joonanza.github.io/wiriya/
//   ALLOWED_ORIGIN (ไม่บังคับ)   เช่น https://joonanza.github.io
//   LINE_MAX_PER_HOUR (ไม่บังคับ) เพดานแจ้งเตือนต่อชั่วโมง ค่าเริ่มต้น 10
//   CRON_SECRET                รหัสลับสุ่ม ≥ 24 ตัว สำหรับสรุปงานพรุ่งนี้ 22:00 (ต้องตรงกับใน Vault: supabase/daily-summary.sql)
// SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY มีให้อัตโนมัติใน Edge Function
import { createClient } from 'jsr:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

const handle = createHandler({
  env: (name) => Deno.env.get(name),
  fetch: (...args) => fetch(...args),
  async claimRequest(id, sinceIso) {
    const { data, error } = await admin.from('quotes')
      .update({ line_notified_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'request')
      .is('line_notified_at', null)
      .gte('created_at', sinceIso)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },
  async releaseClaim(id) {
    await admin.from('quotes').update({ line_notified_at: null }).eq('id', id);
  },
  async claimResponse(id, sinceIso) {
    const { data, error } = await admin.from('quotes')
      .update({ response_notified_at: new Date().toISOString() })
      .eq('id', id)
      .not('customer_response', 'is', null)
      .is('response_notified_at', null)
      .gte('responded_at', sinceIso)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },
  async releaseResponse(id) {
    await admin.from('quotes').update({ response_notified_at: null }).eq('id', id);
  },
  async countNotifiedSince(iso) {
    const { count } = await admin.from('quotes').select('id', { count: 'exact', head: true }).gte('line_notified_at', iso);
    return count || 0;
  },
  async listJobsBetween(fromIso, toIso) {
    const { data, error } = await admin.from('quotes')
      .select('id,status,customer_name,customer_phone,pickup,dropoff,pickup_at,fare_quoted,options')
      .gte('pickup_at', fromIso).lt('pickup_at', toIso)
      .neq('status', 'cancelled')
      .order('pickup_at', { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return data || [];
  },
  async isDriverEmail(email) {
    const { data } = await admin.from('drivers').select('email').eq('email', email).maybeSingle();
    return !!data;
  },
  async getUser(jwt) {
    const { data, error } = await admin.auth.getUser(jwt);
    return error ? null : data.user;
  },
});

Deno.serve(handle);

// ---------------- message.js ----------------
// ===== สร้างข้อความ LINE (Flex Message) สำหรับแจ้งคนขับเมื่อมีคำขอจองใหม่ =====
// ไฟล์นี้เป็น JavaScript ล้วน ใช้ได้ทั้งใน Supabase Edge Function (Deno) และ unit test (Node)

const GREEN = '#0f7a4f';
const cut = (s, n) => {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const shortPlace = (name, parts = 3) =>
  cut(String(name || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, parts).join(', ') || '-', 120);

function fmtThaiDate(iso) {
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
function buildRequestMessage(q, appUrl) {
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
function buildTestMessage(appUrl) {
  const base = String(appUrl || '').replace(/\/?$/, '/');
  return {
    type: 'text',
    text: `✅ ทดสอบการแจ้งเตือนสำเร็จ\nเมื่อลูกค้าส่งคำขอจอง คุณจะได้รับข้อความแบบนี้ทาง LINE${base.startsWith('https://') ? `\n\nเปิดแอป: ${base}` : ''}`,
  };
}

/** ข้อความแจ้งคนขับเมื่อลูกค้ากดยืนยัน / ขอเปลี่ยนแปลงจากลิงก์ในใบเสนอราคา */
function buildResponseMessage(q, appUrl) {
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
function bangkokTomorrow(now) {
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
function jobsForDay(quotes, start, end) {
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
function buildDailyMessage(jobs, day, appUrl) {
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

// ---------------- handler.js ----------------
// ===== ตัวจัดการคำขอของ Edge Function notify-line (JavaScript ล้วน, test ได้ใน Node) =====
//
// POST { id }        → ลูกค้าเพิ่งส่งคำขอ: ส่ง LINE หาคนขับ (เฉพาะคำขอใหม่ที่ยังไม่เคยแจ้ง ภายใน 15 นาที)
// POST { test:true } → คนขับกดทดสอบจากหน้าตั้งค่า (ต้องล็อกอิน)
// POST { event:'response', id } → ลูกค้าเพิ่งกดยืนยัน/ขอเปลี่ยนแปลงจากลิงก์ (แจ้งครั้งเดียว ภายใน 15 นาที)
// POST { event:'daily' } + header x-cron-secret → สรุปงานพรุ่งนี้ (pg_cron เรียกทุก 22:00 น.) ไม่มีงาน = ไม่ส่ง
//
// deps = {
//   env(name)                      → ค่า secret/env
//   claimRequest(id, sinceIso)     → quote | null   (ทำเครื่องหมาย line_notified_at แบบ atomic)
//   releaseClaim(id)               → void           (ส่งไม่สำเร็จ → ปลดเครื่องหมายให้ลองใหม่ได้)
//   getUser(jwt)                   → user | null
//   isDriverEmail(email)           → boolean        (อยู่ในตาราง drivers)
//   countNotifiedSince(iso)        → number         (จำนวนที่แจ้ง LINE ไปแล้วตั้งแต่เวลานั้น)
//   claimResponse(id, sinceIso)    → quote | null   (ทำเครื่องหมาย response_notified_at แบบ atomic)
//   releaseResponse(id)            → void
//   fetch                          → fetch API
//   listJobsBetween(fromIso, toIso) → quote[]       (งานที่ pickup_at อยู่ในช่วง สำหรับสรุปรายวัน)
//   now()                          → Date
// }

// เทียบรหัสลับแบบเวลาคงที่ (กันเดารหัสจากเวลาตอบกลับ)
function safeEqual(a, b) {
  const x = String(a || ''); const y = String(b || '');
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLAIM_WINDOW_MS = 15 * 60 * 1000;

function createHandler(deps) {
  const now = deps.now || (() => new Date());

  const cors = () => ({
    'Access-Control-Allow-Origin': deps.env('ALLOWED_ORIGIN') || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  const json = (status, body) => new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(), 'Content-Type': 'application/json; charset=utf-8' },
  });

  async function pushToDriver(message) {
    const token = deps.env('LINE_CHANNEL_ACCESS_TOKEN');
    const to = String(deps.env('LINE_DRIVER_USER_ID') || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!token || !to.length) return { ok: false, status: 500, error: 'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN / LINE_DRIVER_USER_ID' };
    const multi = to.length > 1;
    const res = await deps.fetch(`https://api.line.me/v2/bot/message/${multi ? 'multicast' : 'push'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: multi ? to : to[0], messages: [message] }),
    });
    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => '');
    return { ok: false, status: 502, error: `LINE API ${res.status}: ${text.slice(0, 300)}` };
  }

  return async function handle(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

    let body;
    try { body = await req.json(); } catch { return json(400, { error: 'invalid json' }); }
    const appUrl = deps.env('APP_URL') || '';

    // ---- ทดสอบจากหน้าตั้งค่า (คนขับต้องล็อกอิน) ----
    if (body && body.test === true) {
      const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      const user = jwt ? await deps.getUser(jwt).catch(() => null) : null;
      if (!user) return json(401, { error: 'ต้องล็อกอินเป็นคนขับก่อน' });
      if (deps.isDriverEmail && !(await deps.isDriverEmail(String(user.email || '').toLowerCase()).catch(() => false))) {
        return json(403, { error: 'บัญชีนี้ไม่อยู่ในรายชื่อคนขับ' });
      }
      const r = await pushToDriver(buildTestMessage(appUrl));
      return r.ok ? json(200, { ok: true, sent: true }) : json(r.status, { error: r.error });
    }

    // ---- สรุปงานพรุ่งนี้ (ตั้งเวลาจาก pg_cron) ----
    if (body && body.event === 'daily') {
      const secret = deps.env('CRON_SECRET');
      if (!secret || secret.length < 24) return json(500, { error: 'ยังไม่ได้ตั้ง CRON_SECRET (อย่างน้อย 24 ตัวอักษร)' });
      if (!safeEqual(req.headers.get('x-cron-secret'), secret)) return json(401, { error: 'unauthorized' });
      if (!deps.listJobsBetween) return json(500, { error: 'listJobsBetween not configured' });
      const { start, end } = bangkokTomorrow(now());
      // ดึงย้อนหลัง 14 วันด้วย เพื่อจับงานเหมาหลายวันที่เริ่มก่อนหน้าแต่ยังคาบถึงพรุ่งนี้
      const from = new Date(start.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const quotes = await deps.listJobsBetween(from, end.toISOString());
      const jobs = jobsForDay(quotes, start, end);
      if (!jobs.length) return json(200, { ok: true, skipped: true, reason: 'no-jobs' });
      const r = await pushToDriver(buildDailyMessage(jobs, start, appUrl));
      return r.ok ? json(200, { ok: true, sent: true, jobs: jobs.length }) : json(r.status, { error: r.error });
    }

    // ---- คำขอจองใหม่ ----
    const id = body && body.id;
    if (typeof id !== 'string' || !UUID_RE.test(id)) return json(400, { error: 'invalid id' });

    // เพดานต่อชั่วโมง: ต่อให้มีสแปมหลุดมา ก็ไม่เผาโควตา LINE จนหมด (คำขอยังเข้าแอปตามปกติ)
    const maxPerHour = Number(deps.env('LINE_MAX_PER_HOUR')) || 10;
    if (deps.countNotifiedSince) {
      const hourAgo = new Date(now().getTime() - 60 * 60 * 1000).toISOString();
      const n = await deps.countNotifiedSince(hourAgo).catch(() => 0);
      if (n >= maxPerHour) return json(200, { ok: true, skipped: true, reason: 'hourly-limit' });
    }

    const since = new Date(now().getTime() - CLAIM_WINDOW_MS).toISOString();

    // ---- ลูกค้าตอบใบเสนอราคา ----
    if (body.event === 'response') {
      if (!deps.claimResponse) return json(200, { ok: true, skipped: true });
      const q = await deps.claimResponse(id, since);
      if (!q) return json(200, { ok: true, skipped: true });
      const rr = await pushToDriver(buildResponseMessage(q, appUrl));
      if (!rr.ok) {
        await deps.releaseResponse?.(id).catch(() => {});
        return json(rr.status, { error: rr.error });
      }
      return json(200, { ok: true, sent: true });
    }

    const quote = await deps.claimRequest(id, since);
    if (!quote) return json(200, { ok: true, skipped: true }); // ไม่ใช่คำขอใหม่ / แจ้งไปแล้ว / เก่าเกิน

    const r = await pushToDriver(buildRequestMessage(quote, appUrl));
    if (!r.ok) {
      await deps.releaseClaim(id).catch(() => {});
      return json(r.status, { error: r.error });
    }
    return json(200, { ok: true, sent: true });
  };
}
