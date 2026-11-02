import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { searchPlaces, reverseGeocode, _clearGeoCache } from '../js/geo.js';

const near = { lat: 13.36, lng: 100.98 };
const feat = (name, lng, lat) => ({ geometry: { coordinates: [lng, lat] }, properties: { name, city: 'ชลบุรี' } });
let calls;
function mockFetch({ photon = [], nominatim = [], photonFail = false } = {}) {
  calls = [];
  globalThis.fetch = async (url) => {
    calls.push({ url: String(url), t: Date.now() });
    if (String(url).includes('photon')) {
      if (photonFail) return new Response('err', { status: 503 });
      if (String(url).includes('/reverse')) return Response.json({ features: photon });
      return Response.json({ features: photon });
    }
    if (String(url).includes('/reverse')) return Response.json({ display_name: 'จาก nominatim' });
    return Response.json(nominatim);
  };
}
const count = (s) => calls.filter((c) => c.url.includes(s)).length;
beforeEach(() => _clearGeoCache());

test('Photon ≥ 3 results → Nominatim is NOT called (usage policy)', async () => {
  mockFetch({ photon: [feat('A', 100.98, 13.36), feat('B', 100.99, 13.37), feat('C', 101.0, 13.38)] });
  const r = await searchPlaces('เซ็นทรัล', { near });
  assert.equal(r.length, 3);
  assert.equal(count('photon'), 1);
  assert.equal(count('nominatim'), 0);
});

test('Photon < 3 results → Nominatim used as fallback', async () => {
  mockFetch({ photon: [feat('A', 100.98, 13.36)], nominatim: [{ lat: '13.2', lon: '100.9', display_name: 'X, ชลบุรี', namedetails: { name: 'X' } }] });
  const r = await searchPlaces('ซอยเล็ก', { near });
  assert.equal(count('nominatim'), 1);
  assert.equal(r.length, 2);
});

test('Photon down → Nominatim; full search (Enter) always queries both', async () => {
  mockFetch({ photonFail: true, nominatim: [{ lat: '13.2', lon: '100.9', display_name: 'X', namedetails: { name: 'X' } }] });
  assert.equal((await searchPlaces('x', { near })).length, 1);
  _clearGeoCache();
  mockFetch({ photon: [feat('A', 100.98, 13.36), feat('B', 100.99, 13.37), feat('C', 101.0, 13.38)], nominatim: [] });
  await searchPlaces('y', { near, full: true });
  assert.equal(count('nominatim'), 1);
});

test('repeated query is served from cache (no network)', async () => {
  mockFetch({ photon: [feat('A', 100.98, 13.36), feat('B', 100.99, 13.37), feat('C', 101.0, 13.38)] });
  await searchPlaces('บิ๊กซี', { near });
  await searchPlaces('บิ๊กซี ', { near });
  assert.equal(calls.length, 1);
});

test('Nominatim calls are spaced ≥ 1 second apart', async () => {
  mockFetch({ photon: [], nominatim: [] });
  await Promise.all([searchPlaces('aa', { near }), searchPlaces('bb', { near })]);
  const t = calls.filter((c) => c.url.includes('nominatim')).map((c) => c.t);
  assert.equal(t.length, 2);
  assert.ok(t[1] - t[0] >= 1000, `gap=${t[1] - t[0]}ms`);
});

test('reverseGeocode prefers Photon and caches', async () => {
  mockFetch({ photon: [feat('บ้านนาป่า', 101.0, 13.39)] });
  assert.match(await reverseGeocode(13.39, 101.0), /บ้านนาป่า/);
  await reverseGeocode(13.39, 101.0);
  assert.equal(count('nominatim'), 0);
  assert.equal(calls.length, 1);
});
