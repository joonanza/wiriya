// ===== Geocoding (Photon + Nominatim) + Routing (OSRM) — ฟรี ไม่ต้องใช้ API key =====
// หมายเหตุ: server สาธารณะของทั้งคู่จำกัดการใช้งาน (~1 req/s) เหมาะกับ prototype
// ใช้งานจริงให้เปลี่ยนเป็น Google Routes API / Longdo Map หรือ self-host OSRM

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const PHOTON = 'https://photon.komoot.io';
const OSRM = 'https://router.project-osrm.org';
const TH_BBOX = '97.3,5.6,105.7,20.5'; // กรอบประเทศไทย (minLon,minLat,maxLon,maxLat)

// ---------------------------------------------------------------- ค้นหาสถานที่
// result: { lat, lng, name (ชื่อเต็ม), title (ชื่อหลัก), subtitle (พื้นที่), source }

const inThailand = (lat, lng) => lat > 5 && lat < 21 && lng > 97 && lng < 106;
const okCoord = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/**
 * อ่านพิกัดจากข้อความ / ลิงก์ Google Maps
 * รองรับ: "13.3611, 100.9847" · ".../@13.36,100.98,17z" · "?q=13.36,100.98" · "!3d13.36!4d100.98" · "ll=13.36,100.98"
 */
export function parseCoordinates(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const pats = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,                    // data=!3dLAT!4dLNG (ตำแหน่งหมุดจริง)
    /[?&](?:q|query|ll|destination|center)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,                          // /@LAT,LNG,zoom
    /^\s*(-?\d{1,2}\.\d{3,})\s*[, ]\s*(-?\d{1,3}\.\d{3,})\s*$/,      // "LAT, LNG"
  ];
  for (const re of pats) {
    const m = t.match(re);
    if (m) {
      const lat = Number(m[1]), lng = Number(m[2]);
      if (okCoord(lat, lng)) return { lat, lng };
    }
  }
  return null;
}

/** ลิงก์ย่อของ Google Maps (เปิดในเบราว์เซอร์ถึงจะรู้พิกัด) */
export const isShortMapsLink = (text) => /^(https?:\/\/)?(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(String(text || '').trim());

const join = (...parts) => [...new Set(parts.filter(Boolean).map((x) => String(x).trim()).filter(Boolean))].join(', ');

export function normalizePhoton(f) {
  const p = f.properties || {};
  const [lng, lat] = f.geometry?.coordinates || [];
  const street = join(p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street);
  const title = p.name || street || p.district || p.city || p.county || '';
  const subtitle = join(p.name ? street : '', p.district, p.locality, p.city, p.county, p.state);
  return { lat: Number(lat), lng: Number(lng), title, subtitle, name: join(title, subtitle), source: 'photon' };
}

export function normalizeNominatim(d) {
  const a = d.address || {};
  const named = d.namedetails?.name || d.name || '';
  const first = String(d.display_name || '').split(',')[0].trim();
  const title = named || first;
  const subtitle = join(a.road, a.suburb || a.quarter || a.neighbourhood, a.city_district || a.town || a.village || a.municipality, a.city || a.county, a.state || a.province);
  return { lat: Number(d.lat), lng: Number(d.lon), title, subtitle: subtitle.replace(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},?\\s*`), ''), name: d.display_name || join(title, subtitle), source: 'nominatim' };
}

/** รวมผลหลายแหล่ง ตัดซ้ำ (ห่างกัน < 80 m หรือชื่อเดียวกันในระยะ 1 km) แล้วเรียงตามความใกล้ */
export function mergeResults(lists, near, limit = 12) {
  const out = [];
  for (const r of lists.flat()) {
    if (!okCoord(r.lat, r.lng) || !r.title) continue;
    const dup = out.some((x) => {
      const d = haversineKm(x, r);
      return d < 0.08 || (d < 1 && x.title === r.title);
    });
    if (!dup) out.push(r);
  }
  if (near) {
    // เรียงแบบนิ่ม: ลำดับความเกี่ยวข้องเดิม + ระยะทาง (ไม่ดันของไกลแต่ตรงชื่อตกไปท้ายสุด)
    out.forEach((r, i) => { r._score = i + Math.log2(1 + haversineKm(near, r) / 5); });
    out.sort((a, b) => a._score - b._score);
    out.forEach((r) => { r.distanceKm = haversineKm(near, r); delete r._score; });
  }
  return out.slice(0, limit);
}

// ---- คำย่อภาษาไทยที่คนพิมพ์บ่อย → คำเต็มที่ใช้ในแผนที่ ----
const TH_ABBR = [
  [/(^|\s)รพ\.?\s*/g, '$1โรงพยาบาล '],
  [/(^|\s)รร\.?\s*/g, '$1โรงเรียน '],
  [/(^|\s)ม\.\s*(?=\d)/g, '$1หมู่ '],            // ม.3 = หมู่ 3
  [/(^|\s)ม\.\s*/g, '$1มหาวิทยาลัย '],
  [/(^|\s)มหาลัย\s*/g, '$1มหาวิทยาลัย '],
  [/(^|\s)บขส\.?\s*/g, '$1สถานีขนส่ง '],
  [/(^|\s)ขนส่ง\s*/g, '$1สถานีขนส่ง '],
  [/(^|\s)รถไฟ\s*/g, '$1สถานีรถไฟ '],
  [/(^|\s)ซ\.\s*/g, '$1ซอย '],
  [/(^|\s)ถ\.\s*/g, '$1ถนน '],
  [/(^|\s)อ\.\s*/g, '$1อำเภอ '],
  [/(^|\s)จ\.\s*/g, '$1จังหวัด '],
  [/(^|\s)ต\.\s*/g, '$1ตำบล '],
  [/(^|\s)นิคม\s*/g, '$1นิคมอุตสาหกรรม '],
  [/(^|\s)ปั๊ม\s*/g, '$1สถานีบริการน้ำมัน '],
  [/(^|\s)เซเว่น\s*/g, '$1เซเว่น อีเลฟเว่น '],
  [/(^|\s)บิ๊กซี\s*/g, '$1บิ๊กซี '],
  [/สนามบิน\s*/g, 'ท่าอากาศยาน '],
];
/** ขยายคำย่อ เช่น "รพ.ชลบุรี" → "โรงพยาบาล ชลบุรี" (ถ้าไม่มีคำย่อจะได้ค่าเดิม) */
export function expandThaiQuery(q) {
  let s = ` ${String(q || '').trim()} `;
  for (const [re, rep] of TH_ABBR) s = s.replace(re, rep);
  s = s.replace(/\s+/g, ' ').trim();
  // "โรงพยาบาลโรงพยาบาล" ซ้ำจากคำที่พิมพ์เต็มอยู่แล้ว
  s = s.replace(/(โรงพยาบาล|มหาวิทยาลัย|สถานีขนส่ง|ท่าอากาศยาน)\s+\1/g, '$1');
  return s;
}

async function photonSearch(q, near, signal, { limit = 15, osmTag = '' } = {}) {
  const bias = near ? `&lat=${near.lat}&lon=${near.lng}&location_bias_scale=0.3` : '';
  const tag = osmTag ? `&osm_tag=${encodeURIComponent(osmTag)}` : '';
  const res = await fetch(`${PHOTON}/api/?q=${encodeURIComponent(q)}&limit=${limit}&bbox=${TH_BBOX}${bias}${tag}`, { signal });
  if (!res.ok) throw new Error(`photon ${res.status}`);
  const data = await res.json();
  return (data.features || []).map(normalizePhoton).filter((r) => inThailand(r.lat, r.lng));
}

// ---- ปฏิบัติตามกฎการใช้งาน Nominatim: ไม่เกิน 1 ครั้ง/วินาที, ไม่ใช้ทำ autocomplete หลัก ----
// https://operations.osmfoundation.org/policies/nominatim/
const NOMINATIM_GAP_MS = 1100;
let nominatimChain = Promise.resolve();
let lastNominatimAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** คิวเรียก Nominatim ทีละครั้ง เว้นระยะ ≥ 1.1 วินาที */
function nominatimFetch(url, opts) {
  const run = async () => {
    const wait = lastNominatimAt + NOMINATIM_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    if (opts?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    lastNominatimAt = Date.now();
    return fetch(url, { ...opts, headers: { Accept: 'application/json', ...(opts?.headers || {}) } });
  };
  const p = nominatimChain.then(run, run);
  nominatimChain = p.catch(() => {});
  return p;
}

async function nominatimSearch(q, near, signal) {
  const vb = near ? `&viewbox=${near.lng - 0.6},${near.lat + 0.6},${near.lng + 0.6},${near.lat - 0.6}&bounded=0` : '';
  const url = `${NOMINATIM}/search?format=jsonv2&countrycodes=th&accept-language=th&limit=6&addressdetails=1&namedetails=1${vb}&q=${encodeURIComponent(q)}`;
  const res = await nominatimFetch(url, { signal });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  return (await res.json()).map(normalizeNominatim);
}

// ---- จำผลค้นหา 10 นาที (พิมพ์ซ้ำ / ลบแล้วพิมพ์ใหม่ ไม่ต้องยิงซ้ำ) ----
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();
const cacheKey = (kind, q, near, full) => `${kind}|${q.trim().toLowerCase()}|${near ? `${near.lat.toFixed(1)},${near.lng.toFixed(1)}` : ''}|${full ? 1 : 0}`;
function cacheGet(k) {
  const e = cache.get(k);
  if (e && Date.now() - e.t < CACHE_MS) return e.v;
  cache.delete(k);
  return undefined;
}
function cacheSet(k, v) {
  cache.set(k, { t: Date.now(), v });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
}
export function _clearGeoCache() { cache.clear(); lastNominatimAt = 0; }

const MIN_PHOTON_RESULTS = 3;

/**
 * ค้นหาสถานที่
 * - ระหว่างพิมพ์: ใช้ Photon เป็นหลัก (ออกแบบมาเพื่อ autocomplete)
 * - เรียก Nominatim เสริมเฉพาะเมื่อ Photon เจอน้อยกว่า 3 รายการ/ล้มเหลว หรือเมื่อกด Enter (full)
 * @param {{signal?:AbortSignal, near?:{lat:number,lng:number}, full?:boolean}} opts
 */
export async function searchPlaces(query, { signal, near, full = false } = {}) {
  const coords = parseCoordinates(query);
  if (coords) return [{ ...coords, title: `พิกัด ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`, subtitle: 'จากลิงก์/พิกัดที่วาง', name: '', source: 'coords' }];
  const key = cacheKey('search', query, near, full);
  const hit = cacheGet(key);
  if (hit) return hit;

  // ค้นทั้งคำที่พิมพ์ และคำที่ขยายคำย่อแล้ว (ถ้าต่างกัน) พร้อมกัน
  const expanded = expandThaiQuery(query);
  const variants = [query, ...(expanded !== query.trim() ? [expanded] : [])];
  let photon = [];
  let photonFailed = false;
  const settled = await Promise.allSettled(variants.map((v) => photonSearch(v, near, signal)));
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  for (const r of settled) if (r.status === 'fulfilled') photon.push(...r.value);
  if (settled.every((r) => r.status === 'rejected')) photonFailed = true;
  // คำที่ขยายแล้วมักตรงกว่า → เอาผลชุดนั้นขึ้นก่อน
  if (variants.length > 1 && settled[1].status === 'fulfilled') photon = [...settled[1].value, ...(settled[0].value || [])];
  let nomi = [];
  let nomiFailed = false;
  if (full || photonFailed || photon.length < MIN_PHOTON_RESULTS) {
    try { nomi = await nominatimSearch(expanded || query, near, signal); } catch (e) {
      if (e.name === 'AbortError') throw e;
      nomiFailed = true;
    }
  }
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  if (photonFailed && (nomiFailed || !nomi.length) && !photon.length) {
    if (nomiFailed) throw new Error('ค้นหาสถานที่ไม่สำเร็จ ลองใหม่อีกครั้ง หรือแตะบนแผนที่');
  }
  const out = mergeResults([photon, nomi], near);
  cacheSet(key, out);
  return out;
}

/** ชื่อที่อยู่จากพิกัด: Photon ก่อน (ไม่จำกัดเข้ม) แล้วค่อย Nominatim */
export async function reverseGeocode(lat, lng) {
  const fallback = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const key = cacheKey('rev', `${lat.toFixed(4)},${lng.toFixed(4)}`, null, false);
  const hit = cacheGet(key);
  if (hit) return hit;
  let name = null;
  try {
    const res = await fetch(`${PHOTON}/reverse?lat=${lat}&lon=${lng}&limit=1`);
    if (res.ok) {
      const f = (await res.json()).features?.[0];
      if (f) name = normalizePhoton(f).name || null;
    }
  } catch { /* ลอง Nominatim ต่อ */ }
  if (!name) {
    try {
      const res = await nominatimFetch(`${NOMINATIM}/reverse?format=jsonv2&accept-language=th&lat=${lat}&lon=${lng}`);
      if (res.ok) name = (await res.json()).display_name || null;
    } catch { /* ใช้พิกัดแทน */ }
  }
  const out = name || fallback;
  if (name) cacheSet(key, out);
  return out;
}

/** ระยะทางเส้นตรงบนผิวโลก (km) */
export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * @returns {Promise<{distanceKm:number, durationMin:number, coords:[number,number][], estimated:boolean}>}
 * ถ้า OSRM ใช้ไม่ได้ จะประมาณจากระยะเส้นตรง × 1.35 (road factor) ที่ 25/40/70 km/h ตามระยะ
 */
export async function getRoute(a, b) {
  try {
    const url = `${OSRM}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const data = await res.json();
    const r = data.routes?.[0];
    if (!r) throw new Error('no route');
    return {
      distanceKm: r.distance / 1000,
      durationMin: r.duration / 60,
      coords: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      estimated: false,
    };
  } catch {
    const km = haversineKm(a, b) * 1.35;
    // ความเร็วเฉลี่ยประมาณตามระยะ: ในเมือง → ชานเมือง → ทางหลวง
    const kmh = km < 15 ? 25 : km < 60 ? 40 : 70;
    return { distanceKm: km, durationMin: (km / kmh) * 60, coords: [[a.lat, a.lng], [b.lat, b.lng]], estimated: true };
  }
}

/** สถานที่ที่เคยใช้: นับความถี่จากรายการเดินทาง (ตัดซ้ำในระยะ ~100 m) เรียงจากใช้บ่อย → ล่าสุด */
export function collectRecentPlaces(trips, limit = 12) {
  const map = new Map();
  trips.forEach((t, idx) => {
    for (const p of [t.pickup, t.dropoff]) {
      if (!p || !okCoord(Number(p.lat), Number(p.lng)) || !p.name || /^กำลังค้นหา/.test(p.name)) continue;
      const k = `${Number(p.lat).toFixed(3)},${Number(p.lng).toFixed(3)}`;
      const e = map.get(k) || { lat: Number(p.lat), lng: Number(p.lng), name: p.name, count: 0, order: idx };
      e.count += 1;
      e.order = Math.min(e.order, idx);
      map.set(k, e);
    }
  });
  return [...map.values()].sort((a, b) => b.count - a.count || a.order - b.order).slice(0, limit)
    .map(({ lat, lng, name }) => ({ lat, lng, name }));
}

// ---------------------------------------------------------------- หมวดหมู่ใกล้ตัว
export const PLACE_CATEGORIES = [
  { id: 'airport', icon: '✈️', label: 'สนามบิน', q: 'ท่าอากาศยาน', tag: 'aeroway:aerodrome' },
  { id: 'hospital', icon: '🏥', label: 'โรงพยาบาล', q: 'โรงพยาบาล', tag: 'amenity:hospital' },
  { id: 'mall', icon: '🛍️', label: 'ห้าง', q: 'ห้างสรรพสินค้า', tag: 'shop:mall' },
  { id: 'bus', icon: '🚌', label: 'ขนส่ง', q: 'สถานีขนส่ง', tag: 'amenity:bus_station' },
  { id: 'train', icon: '🚆', label: 'สถานีรถไฟ', q: 'สถานีรถไฟ', tag: 'railway:station' },
  { id: 'hotel', icon: '🏨', label: 'โรงแรม', q: 'โรงแรม', tag: 'tourism:hotel' },
  { id: 'university', icon: '🎓', label: 'มหาวิทยาลัย', q: 'มหาวิทยาลัย', tag: 'amenity:university' },
];

/** สถานที่ตามหมวด เรียงจากใกล้ไปไกล (Photon กรองด้วย osm_tag + ให้น้ำหนักตำแหน่ง) */
export async function searchCategory(catId, { near, signal, limit = 15 } = {}) {
  const cat = PLACE_CATEGORIES.find((c) => c.id === catId);
  if (!cat) return [];
  const key = cacheKey('cat', catId, near, false);
  const hit = cacheGet(key);
  if (hit) return hit;
  const found = await photonSearch(cat.q, near, signal, { limit, osmTag: cat.tag });
  const out = mergeResults([found], null, limit);
  if (near) {
    out.forEach((r) => { r.distanceKm = haversineKm(near, r); });
    out.sort((a, b) => a.distanceKm - b.distanceKm);
  }
  cacheSet(key, out);
  return out;
}
