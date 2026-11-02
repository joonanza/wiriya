import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// localStorage จำลองสำหรับ Node
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { createLocalStore, customerStats, createErrorStore } = await import('../js/store.js');
const { normalizePhone } = await import('../js/ui.js');

let store;
beforeEach(() => { mem.clear(); store = createLocalStore(); });

test('normalizePhone handles dashes and +66', () => {
  assert.equal(normalizePhone('081-234-5678'), '0812345678');
  assert.equal(normalizePhone('+66 81 234 5678'), '0812345678');
  assert.equal(normalizePhone(''), '');
});

test('upsertCustomer dedupes by phone and keeps existing fields', async () => {
  const a = await store.upsertCustomer({ name: 'สมชาย', phone: '081-234-5678', line_id: 'somchai' });
  const b = await store.upsertCustomer({ name: 'สมชาย ใจดี', phone: '0812345678', line_id: '' });
  assert.equal(a.id, b.id);
  assert.equal(b.name, 'สมชาย ใจดี');
  assert.equal(b.line_id, 'somchai'); // ค่าว่างไม่ลบของเดิม
  assert.equal((await store.listCustomers()).length, 1);
});

test('upsertCustomer dedupes by LINE ID when no phone', async () => {
  const a = await store.upsertCustomer({ name: 'A', line_id: 'Journey' });
  const b = await store.upsertCustomer({ name: 'A2', line_id: 'journey' });
  assert.equal(a.id, b.id);
});

test('searchCustomers matches name, phone digits and LINE', async () => {
  await store.upsertCustomer({ name: 'สมชาย', phone: '0812345678' });
  await store.upsertCustomer({ name: 'มานี', phone: '0899999999', line_id: 'manee_k' });
  assert.equal((await store.searchCustomers('สม')).length, 1);
  assert.equal((await store.searchCustomers('089')).length, 1);
  assert.equal((await store.searchCustomers('manee')).length, 1);
});

test('quotes: save, update status, filter, stats, delete customer unlinks', async () => {
  const c = await store.upsertCustomer({ name: 'สมชาย', phone: '0812345678' });
  const q1 = await store.saveQuote({ customer_id: c.id, fare_quoted: 300, status: 'sent' });
  await store.saveQuote({ customer_id: c.id, fare_quoted: 500, status: 'done' });
  await store.saveQuote({ customer_id: null, fare_quoted: 100, status: 'request', source: 'customer' });
  await store.updateQuoteStatus(q1.id, 'confirmed');
  assert.equal((await store.getQuote(q1.id)).status, 'confirmed');
  assert.equal(await store.countRequests(), 1);
  assert.equal((await store.listQuotes({ customerId: c.id })).length, 2);
  const st = customerStats(await store.listQuotes()).get(c.id);
  assert.deepEqual([st.trips, st.total, st.quotes], [2, 800, 2]);
  await store.deleteCustomer(c.id);
  assert.equal((await store.getQuote(q1.id)).customer_id, null);
});

test('local mode cannot submit customer requests', async () => {
  assert.equal(store.canSubmitRequest, false);
  await assert.rejects(store.submitRequest({}));
});

test('error store: never silently writes locally; fare config falls back to last cached', async () => {
  localStorage.setItem('wiriya.fareConfigCache.v1', JSON.stringify({ baseFare: 55, business: { name: 'ทดสอบ' } }));
  const s = createErrorStore('Failed to fetch');
  assert.equal(s.mode, 'error');
  assert.equal(s.canSubmitRequest, false);
  await assert.rejects(s.saveQuote({ fare_quoted: 1 }), /เชื่อมต่อฐานข้อมูลไม่ได้/);
  await assert.rejects(s.listQuotes(), /เชื่อมต่อฐานข้อมูลไม่ได้/);
  await assert.rejects(s.upsertCustomer({ name: 'x', phone: '0811111111' }), /เชื่อมต่อฐานข้อมูลไม่ได้/);
  assert.equal(localStorage.getItem('wiriya.quotes.v1'), null);
  assert.equal((await s.getFareConfig()).baseFare, 55);
  // ต้อง await ได้ (ไม่ถูกมองเป็น thenable)
  const awaited = await Promise.race([Promise.resolve(s), new Promise((r) => setTimeout(() => r('HANG'), 500))]);
  assert.equal(awaited.mode, 'error');
});
