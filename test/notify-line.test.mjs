import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../supabase/functions/notify-line/handler.js';
import { buildRequestMessage, buildResponseMessage, fmtThaiDate } from '../supabase/functions/notify-line/message.js';

const ID = '11111111-2222-4333-8444-555555555555';
const QUOTE = {
  id: ID,
  status: 'request',
  customer_name: 'สมชาย',
  customer_phone: '0812345678',
  customer_line: 'somchai',
  pickup: { name: 'สยามพารากอน, ถนนพระราม 1, ปทุมวัน, กรุงเทพมหานคร, 10330, ประเทศไทย', lat: 13.746, lng: 100.535 },
  dropoff: { name: 'ท่าอากาศยานดอนเมือง, กรุงเทพมหานคร', lat: 13.912, lng: 100.607 },
  pickup_at: '2026-11-03T01:30:00Z',
  distance_km: 24.6,
  duration_min: 38,
  options: { airport: true },
  note: 'กระเป๋า 2 ใบ',
};

function setup({ env = {}, quote = QUOTE, lineStatus = 200, user = { id: 'u1', email: 'Driver@x.com' }, notifiedLastHour = 0, responseQuote = null } = {}) {
  const calls = { fetch: [], claim: [], release: [] };
  const vars = { LINE_CHANNEL_ACCESS_TOKEN: 'tok', LINE_DRIVER_USER_ID: 'Uabc', APP_URL: 'https://joonanza.github.io/wiriya/', ...env };
  const handle = createHandler({
    env: (k) => vars[k],
    now: () => new Date('2026-11-02T10:00:00Z'),
    async claimRequest(id, since) { calls.claim.push({ id, since }); return quote; },
    async releaseClaim(id) { calls.release.push(id); },
    async getUser(jwt) { return jwt === 'good' ? user : jwt === 'other' ? { id: 'u2', email: 'stranger@x.com' } : null; },
    async isDriverEmail(email) { return email === 'driver@x.com'; },
    async countNotifiedSince() { return notifiedLastHour; },
    async claimResponse(id, since) { calls.claimResp = (calls.claimResp || 0) + 1; return responseQuote; },
    async releaseResponse(id) { calls.release.push('resp:' + id); },
    async fetch(url, init) {
      calls.fetch.push({ url, init, body: JSON.parse(init.body) });
      return new Response(lineStatus === 200 ? '{}' : '{"message":"bad"}', { status: lineStatus });
    },
  });
  return { handle, calls };
}
const post = (body, headers = {}) => new Request('https://x.supabase.co/functions/v1/notify-line', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('OPTIONS preflight returns CORS headers', async () => {
  const { handle } = setup();
  const res = await handle(new Request('https://x/f', { method: 'OPTIONS' }));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('rejects invalid id without touching DB or LINE', async () => {
  const { handle, calls } = setup();
  const res = await handle(post({ id: 'not-a-uuid' }));
  assert.equal(res.status, 400);
  assert.equal(calls.claim.length + calls.fetch.length, 0);
});

test('new request: claims within 15 min window and pushes flex to driver', async () => {
  const { handle, calls } = setup();
  const res = await handle(post({ id: ID }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, sent: true });
  assert.equal(calls.claim[0].since, '2026-11-02T09:45:00.000Z');
  const { url, init, body } = calls.fetch[0];
  assert.equal(url, 'https://api.line.me/v2/bot/message/push');
  assert.equal(init.headers.Authorization, 'Bearer tok');
  assert.equal(body.to, 'Uabc');
  assert.equal(body.messages[0].type, 'flex');
});

test('already notified / not a request → skipped, no LINE call', async () => {
  const { handle, calls } = setup({ quote: null });
  const res = await handle(post({ id: ID }));
  assert.deepEqual(await res.json(), { ok: true, skipped: true });
  assert.equal(calls.fetch.length, 0);
});

test('LINE failure releases claim so it can be retried', async () => {
  const { handle, calls } = setup({ lineStatus: 401 });
  const res = await handle(post({ id: ID }));
  assert.equal(res.status, 502);
  assert.deepEqual(calls.release, [ID]);
});

test('missing secrets → 500 with clear message', async () => {
  const { handle } = setup({ env: { LINE_CHANNEL_ACCESS_TOKEN: '' } });
  const res = await handle(post({ id: ID }));
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /LINE_CHANNEL_ACCESS_TOKEN/);
});

test('hourly cap: skips LINE (no claim) when limit reached', async () => {
  const { handle, calls } = setup({ notifiedLastHour: 10 });
  const res = await handle(post({ id: ID }));
  assert.deepEqual(await res.json(), { ok: true, skipped: true, reason: 'hourly-limit' });
  assert.equal(calls.claim.length + calls.fetch.length, 0);
  const { handle: h2, calls: c2 } = setup({ notifiedLastHour: 10, env: { LINE_MAX_PER_HOUR: '20' } });
  await h2(post({ id: ID }));
  assert.equal(c2.fetch.length, 1);
});

test('customer response event: notifies once with confirmation card', async () => {
  const resp = { ...QUOTE, status: 'confirmed', customer_response: 'confirmed', fare_quoted: 450 };
  const { handle, calls } = setup({ responseQuote: resp });
  const res = await handle(post({ event: 'response', id: ID }));
  assert.deepEqual(await res.json(), { ok: true, sent: true });
  assert.equal(calls.claimResp, 1);
  assert.equal(calls.claim.length, 0);
  assert.match(JSON.stringify(calls.fetch[0].body), /ลูกค้ายืนยันการจองแล้ว/);
  const { handle: h2, calls: c2 } = setup({ responseQuote: null });
  assert.deepEqual(await (await h2(post({ event: 'response', id: ID }))).json(), { ok: true, skipped: true });
  assert.equal(c2.fetch.length, 0);
});

test('change-request card includes customer note', () => {
  const m = buildResponseMessage({ ...QUOTE, customer_response: 'change_requested', response_note: 'ขอเลื่อนเป็น 10 โมง' }, 'https://a.b/');
  assert.match(m.altText, /ขอเปลี่ยนแปลง.*ขอเลื่อนเป็น 10 โมง/);
  assert.match(JSON.stringify(m), /แก้ไขใบเสนอราคา/);
});

test('multiple driver IDs use multicast', async () => {
  const { handle, calls } = setup({ env: { LINE_DRIVER_USER_ID: 'U1, U2' } });
  await handle(post({ id: ID }));
  assert.equal(calls.fetch[0].url, 'https://api.line.me/v2/bot/message/multicast');
  assert.deepEqual(calls.fetch[0].body.to, ['U1', 'U2']);
});

test('test message requires a logged-in driver', async () => {
  const { handle, calls } = setup();
  assert.equal((await handle(post({ test: true }))).status, 401);
  assert.equal((await handle(post({ test: true }, { authorization: 'Bearer bad' }))).status, 401);
  assert.equal((await handle(post({ test: true }, { authorization: 'Bearer other' }))).status, 403);
  const ok = await handle(post({ test: true }, { authorization: 'Bearer good' }));
  assert.equal(ok.status, 200);
  assert.equal(calls.fetch.length, 1);
  assert.equal(calls.fetch[0].body.messages[0].type, 'text');
});

test('flex message content: buttons, short places, alt text limit, Bangkok time', () => {
  const m = buildRequestMessage(QUOTE, 'https://joonanza.github.io/wiriya');
  assert.ok(m.altText.length <= 400);
  assert.match(m.altText, /สมชาย/);
  const json = JSON.stringify(m);
  assert.match(json, /quote\.html\?quote=11111111-2222-4333-8444-555555555555/);
  assert.match(json, /tel:0812345678/);
  assert.match(json, /google\.com\/maps\/dir/);
  assert.match(json, /สยามพารากอน, ถนนพระราม 1, ปทุมวัน"/); // ตัดเหลือ 3 ส่วน
  assert.match(json, /สนามบิน/);
  assert.match(fmtThaiDate(QUOTE.pickup_at), /08:30/); // 01:30Z = 08:30 เวลาไทย
  // ทุก text ต้องไม่ว่าง (LINE ปฏิเสธ text ว่าง)
  const texts = [];
  JSON.parse(json, (k, v) => { if (k === 'text') texts.push(v); return v; });
  assert.ok(texts.every((t) => typeof t === 'string' && t.length > 0));
});

test('flex message without phone / coords omits those buttons', () => {
  const m = buildRequestMessage({ ...QUOTE, customer_phone: null, pickup: { name: 'A' }, dropoff: { name: 'B' } }, 'https://a.b/');
  const json = JSON.stringify(m);
  assert.doesNotMatch(json, /tel:/);
  assert.doesNotMatch(json, /google\.com\/maps/);
  assert.match(json, /เสนอราคา/);
});

test('dashboard-paste bundle is up to date and parses as a module', async () => {
  const { readFileSync, writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { buildBundle } = await import('../scripts/bundle-line-function.mjs');
  const fresh = buildBundle();
  const committed = readFileSync(new URL('../supabase/functions/notify-line/dashboard-paste.ts', import.meta.url), 'utf8');
  assert.equal(committed, fresh, 'รัน npm run bundle:line แล้ว commit ใหม่');
  // ตรวจไวยากรณ์: แทน jsr import + Deno ด้วยตัวปลอม แล้ว import เป็น module ใน Node
  const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
  const code = fresh
    .replace("import { createClient } from 'jsr:@supabase/supabase-js@2';", 'const createClient = () => ({ from() {}, auth: {} });')
    .replace(/Deno\.env\.get\(/g, '((k) => "x")(')
    .replace('Deno.serve(handle);', 'export { handle, buildRequestMessage };');
  writeFileSync(join(dir, 'b.mjs'), code);
  const mod = await import(join(dir, 'b.mjs'));
  assert.equal(typeof mod.handle, 'function');
  assert.equal(mod.buildRequestMessage(QUOTE, 'https://a.b/').type, 'flex');
});

// ---------- สรุปงานพรุ่งนี้ ----------
import { buildDailyMessage, bangkokTomorrow, jobsForDay } from '../supabase/functions/notify-line/message.js';
const SECRET = 'x'.repeat(30);
function dailySetup(quotes, { env = {}, now = '2026-11-04T15:00:00Z' } = {}) {
  const calls = { fetch: [], list: [] };
  const vars = { LINE_CHANNEL_ACCESS_TOKEN: 'tok', LINE_DRIVER_USER_ID: 'Uabc', APP_URL: 'https://joonanza.github.io/wiriya/', CRON_SECRET: SECRET, ...env };
  const handle = createHandler({
    env: (k) => vars[k], now: () => new Date(now),
    async listJobsBetween(f, t) { calls.list.push([f, t]); return quotes; },
    async fetch(url, init) { calls.fetch.push({ url, body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); },
  });
  return { handle, calls };
}
const job = (id, iso, extra = {}) => ({ id, status: 'confirmed', customer_name: 'ลูกค้า' + id, customer_phone: '0812345678', pickup: { name: 'บางแสน, ชลบุรี' }, dropoff: { name: 'สุวรรณภูมิ' }, pickup_at: iso, fare_quoted: 1200, options: {}, ...extra });

test('bangkokTomorrow: 22:00 ไทย (15:00Z) → พรุ่งนี้ 00:00–24:00 ไทย', () => {
  const { start, end } = bangkokTomorrow(new Date('2026-11-04T15:00:00Z'));
  assert.equal(start.toISOString(), '2026-11-04T17:00:00.000Z');
  assert.equal(end.toISOString(), '2026-11-05T17:00:00.000Z');
});

test('daily: ไม่มี/ผิด CRON_SECRET → 401 ไม่แตะ DB/LINE; ไม่ได้ตั้ง secret → 500', async () => {
  const { handle, calls } = dailySetup([job('a', '2026-11-05T02:00:00Z')]);
  assert.equal((await handle(post({ event: 'daily' }))).status, 401);
  assert.equal((await handle(post({ event: 'daily' }, { 'x-cron-secret': 'y'.repeat(30) }))).status, 401);
  assert.equal(calls.list.length + calls.fetch.length, 0);
  const s2 = dailySetup([], { env: { CRON_SECRET: '' } });
  assert.equal((await s2.handle(post({ event: 'daily' }, { 'x-cron-secret': '' }))).status, 500);
});

test('daily: ส่งสรุปงานพรุ่งนี้ เรียงตามเวลา รวมทุกสถานะยกเว้นยกเลิก + งานเหมาหลายวันที่คาบเกี่ยว', async () => {
  const quotes = [
    job('late', '2026-11-05T10:00:00Z', { status: 'sent' }),
    job('early', '2026-11-05T00:30:00Z'),                 // 07:30 ไทย
    job('cxl', '2026-11-05T03:00:00Z', { status: 'cancelled' }),
    job('today', '2026-11-04T12:00:00Z'),                 // วันนี้ ไม่นับ
    job('charter', '2026-11-04T01:00:00Z', { options: { charter: { type: 'full', days: 2 } } }), // วันที่ 2/2
    job('after', '2026-11-05T18:00:00Z'),                 // มะรืน (01:00 ไทย) ไม่นับ
  ];
  const { handle, calls } = dailySetup(quotes);
  const res = await handle(post({ event: 'daily' }, { 'x-cron-secret': SECRET }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).jobs, 3);
  const msg = calls.fetch[0].body.messages[0];
  const txt = JSON.stringify(msg);
  assert.ok(txt.indexOf('วันที่ 2/2') < txt.indexOf('07:30') && txt.indexOf('07:30') < txt.indexOf('17:00'));
  assert.ok(txt.includes('รอยืนยัน') && !txt.includes('ลูกค้าcxl') && !txt.includes('ลูกค้าtoday') && !txt.includes('ลูกค้าafter'));
  assert.match(msg.altText, /3 งาน/);
  assert.ok(txt.includes('quote.html?quote=early'));
});

test('daily: พรุ่งนี้ไม่มีงาน → ไม่ส่ง LINE', async () => {
  const { handle, calls } = dailySetup([job('today', '2026-11-04T12:00:00Z')]);
  const res = await handle(post({ event: 'daily' }, { 'x-cron-secret': SECRET }));
  assert.deepEqual(await res.json(), { ok: true, skipped: true, reason: 'no-jobs' });
  assert.equal(calls.fetch.length, 0);
});

test('buildDailyMessage: จำกัดจำนวนงานในข้อความ และขนาดไม่เกินขีด LINE (30KB)', () => {
  const { start, end } = bangkokTomorrow(new Date('2026-11-04T15:00:00Z'));
  const many = Array.from({ length: 30 }, (_, i) => job('j' + i, new Date(start.getTime() + i * 1800e3).toISOString(), { note: 'x'.repeat(300) }));
  const msg = buildDailyMessage(jobsForDay(many, start, end), start, 'https://joonanza.github.io/wiriya/');
  const t = JSON.stringify(msg);
  assert.ok(t.includes('+ อีก 18 งาน'));
  assert.ok(Buffer.byteLength(t) < 30000);
});
