import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../supabase/functions/notify-line/handler.js';
import { buildRequestMessage, fmtThaiDate } from '../supabase/functions/notify-line/message.js';

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

function setup({ env = {}, quote = QUOTE, lineStatus = 200, user = { id: 'u1', email: 'Driver@x.com' }, notifiedLastHour = 0 } = {}) {
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
