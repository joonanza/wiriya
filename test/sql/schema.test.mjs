// ทดสอบ supabase/schema.sql บน Postgres จริง (PGlite) — รัน: npm run test:sql
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
  .replace('create extension if not exists pgcrypto;', '-- (pgcrypto: gen_random_uuid มีใน PG13+ อยู่แล้ว)');
const db = new PGlite();
// จำลองสภาพแวดล้อม Supabase: roles, auth.jwt(), publication
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create publication supabase_realtime;
  grant usage on schema public to anon, authenticated;
`);
await db.exec(schema);
await db.exec(schema); // รันซ้ำได้ (idempotent)
await db.exec(`grant select, insert, update, delete on all tables in schema public to anon, authenticated;`);
console.log('✅ schema.sql รันได้ 2 รอบ (idempotent)');

const P = (o = {}) => JSON.stringify({
  customer_name: 'สมชาย', customer_phone: '081-234-5678', consent: true,
  pickup: { name: 'บ้าน', lat: 13.39, lng: 101.0 }, dropoff: { name: 'สนามบิน', lat: 13.69, lng: 100.75, evil: 'x' },
  pickup_at: new Date(Date.now() + 3600e3).toISOString(), distance_km: 50, duration_min: 60, options: { roundTrip: false }, fare_calc: 500, ...o,
});
const asAnon = async (sql, params) => {
  await db.exec(`set role anon; set request.jwt.claims = '';`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role;'); }
};
const asUser = async (email, sql, params) => {
  await db.exec(`set role authenticated; set request.jwt.claims = '${JSON.stringify({ email, role: 'authenticated' })}';`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role;'); }
};
const rejects = async (fn, re, label) => {
  try { await fn(); assert.fail(`${label}: ควร error`); } catch (e) { assert.match(e.message, re, label); console.log(`✅ ${label} → "${e.message}"`); }
};

// 1) ส่งคำขอสำเร็จ + เก็บ consent + ตัด field แปลกปลอม
const r = await asAnon('select public.submit_booking_request($1::jsonb) as id', [P()]);
const q = (await db.query('select * from quotes where id = $1', [r.rows[0].id])).rows[0];
assert.ok(q.consent_at); assert.equal(q.customer_phone, '0812345678'); assert.equal(q.dropoff.evil, undefined);
console.log('✅ anon ส่งคำขอได้, บันทึก consent_at, ตัด field แปลกปลอมใน dropoff');

// 2) ตรวจข้อมูล
await rejects(() => asAnon('select public.submit_booking_request($1::jsonb)', [P({ consent: false })]), /ยินยอม/, 'ไม่ติ๊กยินยอม');
await rejects(() => asAnon('select public.submit_booking_request($1::jsonb)', [P({ pickup: { name: 'x', lat: 51.5, lng: -0.1 } })]), /ตำแหน่ง/, 'พิกัดนอกประเทศไทย');
await rejects(() => asAnon('select public.submit_booking_request($1::jsonb)', [P({ customer_phone: '12345' })]), /เบอร์/, 'เบอร์ผิดรูปแบบ');
await rejects(() => asAnon('select public.submit_booking_request($1::jsonb)', [P({ customer_name: '' })]), /ชื่อ/, 'ไม่มีชื่อ');
await rejects(() => asAnon('select public.submit_booking_request($1::jsonb)', [P({ pickup_at: 'not-a-date' })]), /วัน-เวลา/, 'วันที่ผิด');

// 3) จำกัดเบอร์เดียวกัน 3 ครั้ง / 30 นาที
await asAnon('select public.submit_booking_request($1::jsonb)', [P()]);
await asAnon('select public.submit_booking_request($1::jsonb)', [P()]);
await rejects(() => asAnon('select public.submit_booking_request($1::jsonb)', [P()]), /บ่อยเกินไป/, 'คำขอครั้งที่ 4 จากเบอร์เดิม');
await asAnon('select public.submit_booking_request($1::jsonb)', [P({ customer_phone: '0899999999' })]);
console.log('✅ เบอร์อื่นยังส่งได้');

// 4) RLS: anon / คนแปลกหน้า / คนขับ
assert.equal((await asAnon('select count(*)::int n from customers')).rows[0].n, 0);
assert.equal((await asUser('stranger@x.com', 'select count(*)::int n from quotes')).rows[0].n, 0);
assert.ok((await asUser('wiriya.ii1998@gmail.com', 'select count(*)::int n from quotes')).rows[0].n >= 4);
assert.equal((await asUser('WIRIYA.ii1998@gmail.com', 'select public.is_driver() d')).rows[0].d, true);
console.log('✅ RLS: anon และบัญชีแปลกหน้าเห็น 0 แถว, คนขับเห็นข้อมูล (อีเมลไม่สนตัวพิมพ์เล็ก/ใหญ่)');
await rejects(() => asUser('stranger@x.com', "insert into expenses (amount) values (1)"), /row-level security/, 'คนแปลกหน้าเขียนข้อมูล');

// 5) purge_old_data
await rejects(() => asUser('stranger@x.com', 'select public.purge_old_data(365)'), /ไม่มีสิทธิ์/, 'คนแปลกหน้าสั่งลบข้อมูล');
await rejects(() => asUser('wiriya.ii1998@gmail.com', 'select public.purge_old_data(7)'), /30 วัน/, 'เก็บน้อยกว่า 30 วัน');
await db.exec(`alter table quotes disable trigger quotes_touch;
  update quotes set updated_at = now() - interval '400 days' where customer_phone = '0899999999';
  insert into quotes (status, customer_name, updated_at) values ('done', 'งานเก่า', now() - interval '400 days');
  alter table quotes enable trigger quotes_touch;`);
const purged = (await asUser('wiriya.ii1998@gmail.com', 'select public.purge_old_data(365) r')).rows[0].r;
assert.equal(purged.quotes, 1);
assert.equal((await db.query("select count(*)::int n from quotes where customer_name = 'งานเก่า'")).rows[0].n, 1);
console.log('✅ purge_old_data: ลบคำขอเก่า', JSON.stringify(purged), 'และเก็บงานที่เสร็จแล้วไว้');
// 6) ลิงก์ยืนยันการจอง
const TOKEN = 'tok_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4';
const future = new Date(Date.now() + 86400e3).toISOString();
await asUser('wiriya.ii1998@gmail.com', `insert into quotes (status, customer_name, customer_phone, pickup, dropoff, pickup_at, fare_quoted, confirm_token)
  values ('sent', 'มานี', '0899999999', '{"name":"บ้าน","lat":13.39,"lng":101}', '{"name":"สนามบิน","lat":13.69,"lng":100.75}', $1, 450, $2)`, [future, TOKEN]);
assert.equal((await asAnon('select public.get_quote_by_token($1) r', ['short'])).rows[0].r, null);
assert.equal((await asAnon('select public.get_quote_by_token($1) r', ['x'.repeat(30)])).rows[0].r, null);
const view = (await asAnon('select public.get_quote_by_token($1) r', [TOKEN])).rows[0].r;
assert.equal(view.fare_quoted, 450); assert.equal(view.customer_phone_masked, '089-xxx-9999'); assert.equal(view.expired, false);
assert.equal(view.confirm_token, undefined); assert.equal(view.customer_phone, undefined);
console.log('✅ get_quote_by_token: token ผิดได้ null, token ถูกเห็นเฉพาะข้อมูลจำเป็น (เบอร์ถูกปิดบางส่วน ไม่คืน token)');
await rejects(() => asAnon('select public.respond_to_quote($1, $2)', ['y'.repeat(30), 'confirm']), /ไม่ถูกต้อง/, 'ยืนยันด้วย token มั่ว');
await rejects(() => asAnon('select public.respond_to_quote($1, $2)', [TOKEN, 'delete']), /คำสั่ง/, 'คำสั่งอื่นนอกจาก confirm/change');
const ok = (await asAnon('select public.respond_to_quote($1, $2) r', [TOKEN, 'confirm'])).rows[0].r;
let row = (await db.query('select * from quotes where confirm_token = $1', [TOKEN])).rows[0];
assert.equal(row.status, 'confirmed'); assert.equal(row.customer_response, 'confirmed'); assert.ok(row.responded_at); assert.equal(ok.already, false);
assert.equal((await asAnon('select public.respond_to_quote($1, $2) r', [TOKEN, 'confirm'])).rows[0].r.already, true);
console.log('✅ ลูกค้ากดยืนยัน → สถานะเป็น "ยืนยันแล้ว", กดซ้ำได้ผล already=true');
await rejects(() => asAnon('select public.respond_to_quote($1, $2, $3)', [TOKEN, 'change', 'ขอเลื่อนเวลา']), /รอสักครู่/, 'ส่งคำตอบรัวภายใน 1 นาที');
await db.exec(`update quotes set responded_at = now() - interval '5 minutes' where confirm_token = '${TOKEN}'`);
await asAnon('select public.respond_to_quote($1, $2, $3)', [TOKEN, 'change', 'ขอเลื่อนเป็น 10 โมง']);
row = (await db.query('select * from quotes where confirm_token = $1', [TOKEN])).rows[0];
assert.equal(row.customer_response, 'change_requested'); assert.equal(row.response_note, 'ขอเลื่อนเป็น 10 โมง');
console.log('✅ ลูกค้าขอเปลี่ยนแปลงหลังยืนยันได้ (เก็บข้อความไว้ให้คนขับ)');
await db.exec(`update quotes set status = 'sent', customer_response = null, responded_at = null, pickup_at = now() - interval '1 hour' where confirm_token = '${TOKEN}'`);
assert.equal((await asAnon('select public.get_quote_by_token($1) r', [TOKEN])).rows[0].r.expired, true);
await rejects(() => asAnon('select public.respond_to_quote($1, $2)', [TOKEN, 'confirm']), /หมดอายุ/, 'ยืนยันหลังเลยเวลารับ');
assert.equal((await asAnon("select count(*)::int n from quotes where confirm_token is not null")).rows[0].n, 0);
console.log('✅ anon อ่านตาราง quotes ตรง ๆ ไม่ได้ (ต้องผ่านฟังก์ชันเท่านั้น)');

console.log('\nผ่านทั้งหมด');
