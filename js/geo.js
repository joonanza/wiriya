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
export function mergeResults(lists, near, limit = 8) {
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

async function photonSearch(q, near, signal) {
  const bias = near ? `&lat=${near.lat}&lon=${near.lng}&location_bias_scale=0.3` : '';
  const res = await fetch(`${PHOTON}/api/?q=${encodeURIComponent(q)}&limit=8&bbox=${TH_BBOX}${bias}`, { signal });
  if (!res.ok) throw new Error(`photon ${res.status}`);
  const data = await res.json();
  return (data.features || []).map(normalizePhoton).filter((r) => inThailand(r.lat, r.lng));
}

async function nominatimSearch(q, near, signal) {
  const vb = near ? `&viewbox=${near.lng - 0.6},${near.lat + 0.6},${near.lng + 0.6},${near.lat - 0.6}&bounded=0` : '';
  const url = `${NOMINATIM}/search?format=jsonv2&countrycodes=th&accept-language=th&limit=6&addressdetails=1&namedetails=1${vb}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  return (await res.json()).map(normalizeNominatim);
}

/**
 * ค้นหาสถานที่จาก 2 แหล่งพร้อมกัน (Photon: พิมพ์บางส่วนก็เจอ, Nominatim: ที่อยู่ไทยละเอียด)
 * @param {{signal?:AbortSignal, near?:{lat:number,lng:number}}} opts
 */
export async function searchPlaces(query, { signal, near } = {}) {
  const coords = parseCoordinates(query);
  if (coords) return [{ ...coords, title: `พิกัด ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`, subtitle: 'จากลิงก์/พิกัดที่วาง', name: '', source: 'coords' }];
  const [ph, no] = await Promise.allSettled([photonSearch(query, near, signal), nominatimSearch(query, near, signal)]);
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  if (ph.status === 'rejected' && no.status === 'rejected') throw new Error('ค้นหาสถานที่ไม่สำเร็จ ลองใหม่อีกครั้ง หรือแตะบนแผนที่');
  return mergeResults([ph.value || [], no.value || []], near);
}

export async function reverseGeocode(lat, lng) {
  try {
    const url = `${NOMINATIM}/reverse?format=jsonv2&accept-language=th&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error();
    const d = await res.json();
    return d.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
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
