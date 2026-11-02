// ===== ตัวจัดการคำขอของ Edge Function notify-line (JavaScript ล้วน, test ได้ใน Node) =====
//
// POST { id }        → ลูกค้าเพิ่งส่งคำขอ: ส่ง LINE หาคนขับ (เฉพาะคำขอใหม่ที่ยังไม่เคยแจ้ง ภายใน 15 นาที)
// POST { test:true } → คนขับกดทดสอบจากหน้าตั้งค่า (ต้องล็อกอิน)
//
// deps = {
//   env(name)                      → ค่า secret/env
//   claimRequest(id, sinceIso)     → quote | null   (ทำเครื่องหมาย line_notified_at แบบ atomic)
//   releaseClaim(id)               → void           (ส่งไม่สำเร็จ → ปลดเครื่องหมายให้ลองใหม่ได้)
//   getUser(jwt)                   → user | null
//   isDriverEmail(email)           → boolean        (อยู่ในตาราง drivers)
//   countNotifiedSince(iso)        → number         (จำนวนที่แจ้ง LINE ไปแล้วตั้งแต่เวลานั้น)
//   fetch                          → fetch API
//   now()                          → Date
// }
import { buildRequestMessage, buildTestMessage } from './message.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLAIM_WINDOW_MS = 15 * 60 * 1000;

export function createHandler(deps) {
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
