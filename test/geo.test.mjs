import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCoordinates, isShortMapsLink, normalizePhoton, normalizeNominatim, mergeResults, collectRecentPlaces,
} from '../js/geo.js';

test('parseCoordinates: plain "lat, lng" and Google Maps URL formats', () => {
  assert.deepEqual(parseCoordinates('13.361143, 100.984673'), { lat: 13.361143, lng: 100.984673 });
  assert.deepEqual(parseCoordinates('13.3611 100.9847'), { lat: 13.3611, lng: 100.9847 });
  assert.deepEqual(parseCoordinates('https://www.google.com/maps/@13.3611,100.9847,17z'), { lat: 13.3611, lng: 100.9847 });
  assert.deepEqual(parseCoordinates('https://maps.google.com/?q=13.3611,100.9847'), { lat: 13.3611, lng: 100.9847 });
  assert.deepEqual(parseCoordinates('https://www.google.com/maps/place/X/@13.30,100.90,15z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d13.3611!4d100.9847'), { lat: 13.3611, lng: 100.9847 }); // ใช้ตำแหน่งหมุด ไม่ใช่กึ่งกลางจอ
  assert.equal(parseCoordinates('เซ็นทรัล ชลบุรี'), null);
  assert.equal(parseCoordinates('ซอย 13'), null);
  assert.equal(parseCoordinates('99.0, 200.0'), null);
});

test('isShortMapsLink detects maps.app.goo.gl', () => {
  assert.equal(isShortMapsLink('https://maps.app.goo.gl/AbCd123'), true);
  assert.equal(isShortMapsLink('https://www.google.com/maps/@13,100,17z'), false);
});

test('normalizePhoton builds title/subtitle', () => {
  const r = normalizePhoton({
    geometry: { coordinates: [100.98, 13.36] },
    properties: { name: 'เซ็นทรัล ชลบุรี', street: 'ถนนสุขุมวิท', district: 'เสม็ด', city: 'เมืองชลบุรี', state: 'ชลบุรี' },
  });
  assert.equal(r.title, 'เซ็นทรัล ชลบุรี');
  assert.equal(r.subtitle, 'ถนนสุขุมวิท, เสม็ด, เมืองชลบุรี, ชลบุรี');
  assert.equal(r.lat, 13.36);
  assert.equal(r.lng, 100.98);
});

test('normalizePhoton without name uses street/house number', () => {
  const r = normalizePhoton({ geometry: { coordinates: [100.9, 13.3] }, properties: { housenumber: '99/1', street: 'ถนนพระยาสัจจา', city: 'ชลบุรี' } });
  assert.equal(r.title, '99/1 ถนนพระยาสัจจา');
});

test('normalizeNominatim uses namedetails and address parts', () => {
  const r = normalizeNominatim({
    lat: '13.73', lon: '100.55', display_name: 'ธันเดอร์โดม, ถนนป๊อปปูล่า 3, เมืองทองธานี, บ้านใหม่, ปากเกร็ด, นนทบุรี, 11120, ประเทศไทย',
    namedetails: { name: 'ธันเดอร์โดม' },
    address: { road: 'ถนนป๊อปปูล่า 3', suburb: 'บ้านใหม่', town: 'ปากเกร็ด', state: 'นนทบุรี' },
  });
  assert.equal(r.title, 'ธันเดอร์โดม');
  assert.equal(r.subtitle, 'ถนนป๊อปปูล่า 3, บ้านใหม่, ปากเกร็ด, นนทบุรี');
});

test('mergeResults dedupes nearby duplicates and ranks by relevance + distance', () => {
  const near = { lat: 13.36, lng: 100.98 }; // ชลบุรี
  const photon = [
    { lat: 13.7466, lng: 100.5393, title: 'เซ็นทรัลเวิลด์', source: 'photon' },       // กรุงเทพ ~60 km
    { lat: 13.3600, lng: 100.9800, title: 'เซ็นทรัล ชลบุรี', source: 'photon' },      // ใกล้มาก
  ];
  const nominatim = [
    { lat: 13.3603, lng: 100.9802, title: 'เซ็นทรัล ชลบุรี', source: 'nominatim' },   // ซ้ำ (~40 m)
    { lat: 12.93, lng: 100.88, title: 'เซ็นทรัล พัทยา', source: 'nominatim' },
  ];
  const r = mergeResults([photon, nominatim], near);
  assert.equal(r.length, 3);
  assert.equal(r[0].title, 'เซ็นทรัล ชลบุรี');
  assert.ok(r[0].distanceKm < 0.1);
  assert.ok(r.every((x) => typeof x.distanceKm === 'number'));
});

test('collectRecentPlaces counts frequency and dedupes ~100 m', () => {
  const A = { name: 'บ้าน', lat: 13.3611, lng: 100.9847 };
  const A2 = { name: 'บ้าน (ซ้ำ)', lat: 13.3612, lng: 100.9846 };
  const B = { name: 'สนามบินสุวรรณภูมิ', lat: 13.69, lng: 100.75 };
  const C = { name: 'กำลังค้นหาที่อยู่…', lat: 13.1, lng: 100.1 };
  const r = collectRecentPlaces([{ pickup: A, dropoff: B }, { pickup: A2, dropoff: C }, { pickup: B, dropoff: A }]);
  assert.equal(r[0].name, 'บ้าน');      // ใช้ 3 ครั้ง
  assert.equal(r[1].name, 'สนามบินสุวรรณภูมิ');
  assert.equal(r.length, 2);            // ตัด "กำลังค้นหา…"
});
