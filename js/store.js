// ===== Data layer: ใช้ API เดียวกันทั้งโหมดเก็บในเครื่อง (localStorage) และ Supabase =====
//
// customer: { id, name, phone, line_id, note, created_at, updated_at }
// quote:    { id, customer_id, customer_name, customer_phone, customer_line,
//             pickup:{name,lat,lng}, dropoff:{name,lat,lng}, pickup_at(ISO),
//             distance_km, duration_min, options:{vehicleId,roundTrip,airport,waitHours,tollBaht},
//             fare_calc, fare_quoted, status, source:'driver'|'customer', channel, note, created_at, updated_at }

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './backend-config.js';
import {
  loadFareConfig, saveFareConfig as saveFareLocal, loadCostInputs, saveCostInputs as saveCostLocal,
  DEFAULT_FARE_CONFIG,
} from './config.js';
import { DEFAULT_COST_INPUTS } from './cost.js';
import { normalizePhone } from './ui.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const clone = (o) => JSON.parse(JSON.stringify(o));
const nowIso = () => new Date().toISOString();
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));

const matchText = (c, q) => {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const digits = s.replace(/\D/g, '');
  return (c.name || '').toLowerCase().includes(s)
    || (c.line_id || '').toLowerCase().includes(s)
    || (digits.length >= 2 && (c.phone || '').includes(digits));
};

/** สรุปสถิติลูกค้าจากรายการ quote */
export function customerStats(quotes) {
  const map = new Map();
  for (const q of quotes) {
    if (!q.customer_id) continue;
    const s = map.get(q.customer_id) || { trips: 0, total: 0, last: null, quotes: 0 };
    s.quotes += 1;
    if (q.status === 'confirmed' || q.status === 'done') { s.trips += 1; s.total += Number(q.fare_quoted) || 0; }
    if (!s.last || q.created_at > s.last) s.last = q.created_at;
    map.set(q.customer_id, s);
  }
  return map;
}

// ---------------------------------------------------------------- Local
const K_CUST = 'wiriya.customers.v1';
const K_QUOTE = 'wiriya.quotes.v1';
const MAX_LOCAL_QUOTES = 500;

function readArr(key) {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function writeArr(key, arr) {
  try { localStorage.setItem(key, JSON.stringify(arr)); return true; } catch { return false; }
}

function createLocalStore() {
  const findCustomer = (list, c) => list.find((x) =>
    (c.id && x.id === c.id)
    || (c.phone && x.phone && x.phone === c.phone)
    || (!c.phone && c.line_id && x.line_id && x.line_id.toLowerCase() === c.line_id.toLowerCase()));

  return {
    mode: 'local',
    async getSession() { return { local: true }; },
    async signIn() { return { local: true }; },
    async signOut() {},

    async getFareConfig() { return loadFareConfig(); },
    async saveFareConfig(cfg) { if (!saveFareLocal(cfg)) throw new Error('บันทึกไม่สำเร็จ (เบราว์เซอร์บล็อก storage)'); },
    async getCostInputs() { return loadCostInputs(); },
    async saveCostInputs(c) { saveCostLocal(c); },

    async listCustomers() {
      return readArr(K_CUST).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    },
    async searchCustomers(q, limit = 8) {
      return (await this.listCustomers()).filter((c) => matchText(c, q)).slice(0, limit);
    },
    async getCustomer(id) { return readArr(K_CUST).find((c) => c.id === id) || null; },
    async upsertCustomer(input) {
      const c = { ...input, phone: normalizePhone(input.phone) || null, line_id: (input.line_id || '').trim() || null };
      const list = readArr(K_CUST);
      const existing = findCustomer(list, c);
      let saved;
      if (existing) {
        Object.assign(existing, {
          name: c.name || existing.name,
          phone: c.phone ?? existing.phone,
          line_id: c.line_id ?? existing.line_id,
          note: c.note ?? existing.note,
          updated_at: nowIso(),
        });
        saved = existing;
      } else {
        saved = { id: uuid(), name: c.name || '', phone: c.phone, line_id: c.line_id, note: c.note || '', created_at: nowIso(), updated_at: nowIso() };
        list.push(saved);
      }
      writeArr(K_CUST, list);
      return clone(saved);
    },
    async deleteCustomer(id) {
      writeArr(K_CUST, readArr(K_CUST).filter((c) => c.id !== id));
      writeArr(K_QUOTE, readArr(K_QUOTE).map((q) => (q.customer_id === id ? { ...q, customer_id: null } : q)));
    },

    async listQuotes({ status, customerId, limit = 200 } = {}) {
      return readArr(K_QUOTE)
        .filter((q) => (!status || q.status === status) && (!customerId || q.customer_id === customerId))
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
        .slice(0, limit);
    },
    async getQuote(id) { return readArr(K_QUOTE).find((q) => q.id === id) || null; },
    async saveQuote(input) {
      const list = readArr(K_QUOTE);
      const i = input.id ? list.findIndex((q) => q.id === input.id) : -1;
      let saved;
      if (i >= 0) { saved = { ...list[i], ...input, updated_at: nowIso() }; list[i] = saved; }
      else {
        saved = { ...input, id: input.id || uuid(), created_at: nowIso(), updated_at: nowIso() };
        list.push(saved);
        list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        list.length = Math.min(list.length, MAX_LOCAL_QUOTES);
      }
      writeArr(K_QUOTE, list);
      return clone(saved);
    },
    async updateQuoteStatus(id, status) { return this.saveQuote({ id, status }); },
    async deleteQuote(id) { writeArr(K_QUOTE, readArr(K_QUOTE).filter((q) => q.id !== id)); },
    async countRequests() { return readArr(K_QUOTE).filter((q) => q.status === 'request').length; },

    /** หน้าลูกค้า: โหมดเครื่องเดียวส่งคำขอข้ามเครื่องไม่ได้ */
    canSubmitRequest: false,
    async submitRequest() { throw new Error('ยังไม่ได้เชื่อมต่อฐานข้อมูล'); },
  };
}

// ---------------------------------------------------------------- Supabase
async function createSupabaseStore() {
  const { createClient } = await import(SUPABASE_JS);
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

  async function getSetting(key) {
    const { data, error } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.value ?? null;
  }
  const setSetting = async (key, value) => must(await sb.from('settings').upsert({ key, value }));

  return {
    mode: 'supabase',
    client: sb,
    async getSession() { const { data } = await sb.auth.getSession(); return data.session; },
    async signIn(email, password) {
      return must(await sb.auth.signInWithPassword({ email, password }));
    },
    async signOut() { await sb.auth.signOut(); },

    async getFareConfig() {
      const v = await getSetting('fare_config').catch(() => null);
      return v ? { ...clone(DEFAULT_FARE_CONFIG), ...v } : clone(DEFAULT_FARE_CONFIG);
    },
    async saveFareConfig(cfg) { await setSetting('fare_config', cfg); },
    async getCostInputs() {
      const v = await getSetting('cost_inputs').catch(() => null);
      return v ? { ...clone(DEFAULT_COST_INPUTS), ...v } : clone(DEFAULT_COST_INPUTS);
    },
    async saveCostInputs(c) { await setSetting('cost_inputs', c); },

    async listCustomers() {
      return must(await sb.from('customers').select('*').order('updated_at', { ascending: false }).limit(1000));
    },
    async searchCustomers(q, limit = 8) {
      const s = q.trim();
      if (!s) return must(await sb.from('customers').select('*').order('updated_at', { ascending: false }).limit(limit));
      const digits = s.replace(/\D/g, '');
      const safe = s.replace(/[%,()]/g, ' ');
      const ors = [`name.ilike.%${safe}%`, `line_id.ilike.%${safe}%`];
      if (digits.length >= 2) ors.push(`phone.ilike.%${digits}%`);
      return must(await sb.from('customers').select('*').or(ors.join(',')).limit(limit));
    },
    async getCustomer(id) { return must(await sb.from('customers').select('*').eq('id', id).maybeSingle()); },
    async upsertCustomer(input) {
      const c = {
        name: input.name || '',
        phone: normalizePhone(input.phone) || null,
        line_id: (input.line_id || '').trim() || null,
        ...(input.note !== undefined ? { note: input.note } : {}),
      };
      let id = input.id;
      if (!id && c.phone) id = (await sb.from('customers').select('id').eq('phone', c.phone).maybeSingle()).data?.id;
      if (!id && !c.phone && c.line_id) id = (await sb.from('customers').select('id').ilike('line_id', c.line_id).limit(1).maybeSingle()).data?.id;
      if (id) {
        const patch = Object.fromEntries(Object.entries(c).filter(([k, v]) => v !== null && v !== '' || k === 'note'));
        return must(await sb.from('customers').update(patch).eq('id', id).select().single());
      }
      return must(await sb.from('customers').insert(c).select().single());
    },
    async deleteCustomer(id) { must(await sb.from('customers').delete().eq('id', id)); },

    async listQuotes({ status, customerId, limit = 200 } = {}) {
      let q = sb.from('quotes').select('*').order('created_at', { ascending: false }).limit(limit);
      if (status) q = q.eq('status', status);
      if (customerId) q = q.eq('customer_id', customerId);
      return must(await q);
    },
    async getQuote(id) { return must(await sb.from('quotes').select('*').eq('id', id).maybeSingle()); },
    async saveQuote(input) {
      const { id, created_at, updated_at, ...rest } = input;
      if (id) return must(await sb.from('quotes').update(rest).eq('id', id).select().single());
      return must(await sb.from('quotes').insert(rest).select().single());
    },
    async updateQuoteStatus(id, status) { return this.saveQuote({ id, status }); },
    async deleteQuote(id) { must(await sb.from('quotes').delete().eq('id', id)); },
    async countRequests() {
      const { count } = await sb.from('quotes').select('id', { count: 'exact', head: true }).eq('status', 'request');
      return count || 0;
    },

    canSubmitRequest: true,
    async submitRequest(payload) { return must(await sb.rpc('submit_booking_request', { p: payload })); },
  };
}

// ---------------------------------------------------------------- entry
export const backendConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let storePromise;
export function getStore() {
  if (!storePromise) {
    storePromise = backendConfigured
      ? createSupabaseStore().catch((err) => {
        console.error('เชื่อมต่อ Supabase ไม่ได้ ใช้โหมดในเครื่องแทน', err);
        const s = createLocalStore();
        s.connectionError = err.message;
        return s;
      })
      : Promise.resolve(createLocalStore());
  }
  return storePromise;
}

export { createLocalStore };
