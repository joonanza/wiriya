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

// ---------------- handler.js ----------------
// ===== ตัวจัดการคำขอของ Edge Function notify-line (JavaScript ล้วน, test ได้ใน Node) =====
//
// POST { id }        → ลูกค้าเพิ่งส่งคำขอ: ส่ง LINE หาคนขับ (เฉพาะคำขอใหม่ที่ยังไม่เคยแจ้ง ภายใน 15 นาที)
// POST { test:true } → คนขับกดทดสอบจากหน้าตั้งค่า (ต้องล็อกอิน)
// POST { event:'response', id } → ลูกค้าเพิ่งกดยืนยัน/ขอเปลี่ยนแปลงจากลิงก์ (แจ้งครั้งเดียว ภายใน 15 นาที)
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
//   now()                          → Date
// }

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
