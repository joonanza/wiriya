// ===== Geocoding (Nominatim) + Routing (OSRM) — ฟรี ไม่ต้องใช้ API key =====
// หมายเหตุ: server สาธารณะของทั้งคู่จำกัดการใช้งาน (~1 req/s) เหมาะกับ prototype
// ใช้งานจริงให้เปลี่ยนเป็น Google Routes API / Longdo Map หรือ self-host OSRM

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OSRM = 'https://router.project-osrm.org';

export async function searchPlaces(query, { signal } = {}) {
  const url = `${NOMINATIM}/search?format=jsonv2&countrycodes=th&accept-language=th&limit=6&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`ค้นหาสถานที่ไม่สำเร็จ (${res.status})`);
  const data = await res.json();
  return data.map((d) => ({ lat: Number(d.lat), lng: Number(d.lon), name: d.display_name }));
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
 * ถ้า OSRM ใช้ไม่ได้ จะประมาณจากระยะเส้นตรง × 1.35 (road factor) ที่ 35 km/h
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
    return { distanceKm: km, durationMin: (km / 35) * 60, coords: [[a.lat, a.lng], [b.lat, b.lng]], estimated: true };
  }
}
