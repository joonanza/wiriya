// ===== ส่วนวางแผนเส้นทาง (แผนที่ + ค้นหาสถานที่ + ตัวเลือก + คำนวณราคา) ใช้ร่วมกันหน้าคนขับและหน้าลูกค้า =====
// ต้องมี element: pickup, dropoff, pickupSuggest, dropoffSuggest, gpsBtn, swapBtn, vehicle, datetime,
//                toll, wait, roundTrip, airport, map, quote
import { calculateFare } from './pricing.js';
import { searchPlaces, reverseGeocode, getRoute, isShortMapsLink } from './geo.js';
import { $, esc, baht, bahtExact, toast, toLocalInput, shortPlace } from './ui.js';

const join2 = (a, b) => [a, b].filter(Boolean).join(', ');

export function createTripPlanner(cfg, { onUpdate = () => {}, showPrice = true, recentPlaces = async () => [] } = {}) {
  const state = { pickup: null, dropoff: null, route: null, fare: null, trip: null };

  // ---------- ตัวเลือก ----------
  for (const v of cfg.vehicles) {
    const o = document.createElement('option');
    o.value = v.id; o.textContent = v.name;
    $('vehicle').append(o);
  }
  if (cfg.vehicles.length < 2) $('vehicle').closest('.field').hidden = true;
  $('datetime').value = toLocalInput(new Date(Date.now() + 30 * 60000));

  // ---------- แผนที่ ----------
  const hasMap = typeof window.L !== 'undefined';
  let map, routeLine;
  const markers = {};
  if (hasMap) {
    map = L.map('map').setView([13.7563, 100.5018], 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    map.on('click', (e) => setPlace(!state.pickup ? 'pickup' : 'dropoff', { lat: e.latlng.lat, lng: e.latlng.lng }, null));
  } else {
    $('map').innerHTML = '<p class="empty" style="padding:16px">โหลดแผนที่ไม่ได้ ยังค้นหาสถานที่จากช่องค้นหาได้</p>';
  }

  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const markerIcon = (kind) => L.divIcon({
    className: '',
    html: `<div style="width:18px;height:18px;border-radius:50%;background:${cssVar(kind === 'pickup' ? '--accent' : '--danger')};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [18, 18], iconAnchor: [9, 9],
  });

  function placeMarker(which) {
    if (!hasMap) return;
    markers[which]?.remove(); delete markers[which];
    const p = state[which];
    if (!p) return;
    markers[which] = L.marker([p.lat, p.lng], { draggable: true, icon: markerIcon(which) }).addTo(map);
    markers[which].on('dragend', (ev) => {
      const ll = ev.target.getLatLng();
      setPlace(which, { lat: ll.lat, lng: ll.lng }, null);
    });
  }

  async function setPlace(which, latlng, name, { route = true } = {}) {
    state[which] = { lat: latlng.lat, lng: latlng.lng, name: name || 'กำลังค้นหาที่อยู่…' };
    $(which).value = state[which].name;
    placeMarker(which);
    const routeP = route ? updateRoute() : Promise.resolve();
    if (!name) {
      const resolved = await reverseGeocode(latlng.lat, latlng.lng);
      if (state[which] && state[which].lat === latlng.lat) {
        state[which].name = resolved; $(which).value = resolved; notify();
      }
    }
    await routeP;
  }

  // ---------- ค้นหาสถานที่ ----------
  // แตะช่อง → แสดงสถานที่ที่เคยใช้ · พิมพ์ ≥ 2 ตัว → ค้นจาก Photon + Nominatim (เรียงตามความใกล้) · วางลิงก์/พิกัด Google Maps ได้
  const near = () => {
    if (hasMap) { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; }
    return state.pickup || { lat: 13.7563, lng: 100.5018 };
  };
  let recentCache = null;
  const getRecent = async () => {
    if (!recentCache) { try { recentCache = (await recentPlaces()) || []; } catch { recentCache = []; } }
    return recentCache;
  };
  const kmLabel = (d) => (d == null ? '' : d < 1 ? `${Math.round(d * 1000)} m` : `${d < 10 ? d.toFixed(1) : Math.round(d)} km`);
  const titleOf = (it) => it.title || shortPlace(it.name, 1);
  const subOf = (it) => it.subtitle ?? shortPlace(String(it.name || '').split(',').slice(1).join(','), 3);

  function setupAutocomplete(which) {
    const input = $(which);
    const list = $(`${which}Suggest`);
    let timer, ctrl, items = [], active = -1, seq = 0;
    const close = () => { list.hidden = true; active = -1; };
    const render = (header) => {
      const lis = items.map((it, i) => {
        const li = document.createElement('li');
        li.className = `sugg ${i === active ? 'active' : ''}`;
        const icon = it.source === 'recent' ? '🕘' : it.source === 'coords' ? '📍' : '📌';
        li.innerHTML = `<span class="sugg-ico" aria-hidden="true">${icon}</span>
          <span class="sugg-txt"><b>${esc(titleOf(it))}</b>${subOf(it) ? `<span class="muted">${esc(subOf(it))}</span>` : ''}</span>
          ${it.distanceKm != null ? `<span class="sugg-dist muted">${kmLabel(it.distanceKm)}</span>` : ''}`;
        li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });
        return li;
      });
      if (header) {
        const h = document.createElement('li');
        h.className = 'sugg-head'; h.textContent = header;
        lis.unshift(h);
      }
      list.replaceChildren(...lis);
      list.hidden = lis.length === 0;
    };
    const choose = (i) => {
      const it = items[i]; if (!it) return;
      close();
      setPlace(which, it, it.source === 'coords' ? null : (it.name || join2(titleOf(it), subOf(it))));
      if (hasMap) map.setView([it.lat, it.lng], Math.max(map.getZoom(), 14));
    };
    const showRecent = async (q = '') => {
      const recent = await getRecent();
      const t = q.trim().toLowerCase();
      items = recent.filter((r) => !t || String(r.name || '').toLowerCase().includes(t)).slice(0, t ? 3 : 6)
        .map((r) => ({ ...r, source: 'recent', distanceKm: null }));
      active = -1;
      render(items.length && !t ? 'สถานที่ที่เคยใช้' : null);
    };
    input.addEventListener('focus', () => { if (input.value.trim().length < 2 || input.value === state[which]?.name) showRecent(''); });
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (isShortMapsLink(q)) {
        items = []; render();
        toast('ลิงก์ย่อ maps.app.goo.gl อ่านพิกัดไม่ได้ ให้เปิดลิงก์ใน Google Maps แล้วคัดลอกพิกัด (กดค้างที่หมุด) มาวางแทน');
        return;
      }
      if (q.length < 2) { showRecent(''); return; }
      // แสดงสถานที่ที่เคยใช้ที่ตรงกันก่อน ระหว่างรอผลค้นหา
      showRecent(q);
      timer = setTimeout(() => doSearch(q, false), 400);
    });
    async function doSearch(q, full) {
      const my = ++seq;
      ctrl?.abort(); ctrl = new AbortController();
      list.classList.add('loading');
      try {
        const found = await searchPlaces(q, { signal: ctrl.signal, near: near(), full });
        if (my !== seq) return;
        const recent = items.filter((x) => x.source === 'recent');
        items = [...recent, ...found].slice(0, 9);
        active = -1;
        render();
        if (!items.length) {
          list.replaceChildren(Object.assign(document.createElement('li'), {
            className: 'sugg-head',
            textContent: full ? 'ไม่พบสถานที่ ลองพิมพ์ชื่ออื่น ชื่อถนน หรือแตะบนแผนที่' : 'ยังไม่พบ กด Enter / ค้นหา เพื่อค้นแบบละเอียด',
          }));
          list.hidden = false;
        }
      } catch (err) {
        if (err.name !== 'AbortError') toast(err.message || 'ค้นหาไม่สำเร็จ');
      } finally { list.classList.remove('loading'); }
    }
    input.addEventListener('keydown', (e) => {
      const hasResults = items.some((x) => x.source !== 'recent');
      if (e.key === 'Enter' && !hasResults && input.value.trim().length >= 2) {
        e.preventDefault(); clearTimeout(timer); doSearch(input.value.trim(), true); return;
      }
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); render(); e.preventDefault(); }
      else if (e.key === 'Enter') { choose(active < 0 ? 0 : active); e.preventDefault(); }
      else if (e.key === 'Escape') close();
    });
    input.addEventListener('blur', () => setTimeout(close, 150));
  }
  setupAutocomplete('pickup');
  setupAutocomplete('dropoff');

  $('gpsBtn').addEventListener('click', () => {
    if (!navigator.geolocation) { toast('อุปกรณ์นี้ไม่รองรับ GPS'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setPlace('pickup', p, null);
        if (hasMap) map.setView([p.lat, p.lng], 15);
      },
      () => toast('อ่านตำแหน่งไม่ได้ กรุณาอนุญาตการเข้าถึงตำแหน่ง'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });

  $('swapBtn').addEventListener('click', () => {
    [state.pickup, state.dropoff] = [state.dropoff, state.pickup];
    $('pickup').value = state.pickup?.name || '';
    $('dropoff').value = state.dropoff?.name || '';
    placeMarker('pickup'); placeMarker('dropoff');
    updateRoute();
  });

  // ---------- เส้นทาง + ราคา ----------
  let routeSeq = 0;
  async function updateRoute() {
    if (!state.pickup || !state.dropoff) { state.route = null; renderQuote(); return; }
    const seq = ++routeSeq;
    $('quote').innerHTML = '<p class="empty">กำลังคำนวณเส้นทาง…</p>';
    const r = await getRoute(state.pickup, state.dropoff);
    if (seq !== routeSeq) return;
    state.route = r;
    if (hasMap) {
      routeLine?.remove();
      routeLine = L.polyline(r.coords, { color: cssVar('--accent'), weight: 5, opacity: 0.85, dashArray: r.estimated ? '8 8' : null }).addTo(map);
      map.fitBounds(routeLine.getBounds(), { padding: [40, 40] });
    }
    renderQuote();
  }

  function readOptions() {
    return {
      vehicleId: $('vehicle').value,
      roundTrip: $('roundTrip').checked,
      airport: $('airport').checked,
      waitHours: Number($('wait').value) || 0,
      tollBaht: Number($('toll').value) || 0,
    };
  }

  function readTrip() {
    const r = state.route;
    return {
      ...readOptions(),
      distanceKm: r.distanceKm,
      durationMin: r.durationMin * (r.estimated ? 1 : cfg.trafficFactor || 1),
      datetime: new Date($('datetime').value),
    };
  }

  const notify = () => onUpdate(state);

  function renderQuote() {
    const box = $('quote');
    if (!state.route) {
      box.innerHTML = '<p class="empty">เลือกจุดรับและจุดส่งเพื่อดูราคา</p>';
      state.fare = null; state.trip = null; notify(); return;
    }
    const trip = readTrip();
    const f = calculateFare(cfg, trip);
    state.fare = f; state.trip = trip;
    const rows = f.lines.map((l) => `
      <tr><td>${esc(l.label)}${l.note ? `<span class="note">${esc(l.note)}</span>` : ''}</td>
      <td class="num">${bahtExact(Math.round(l.amount * 100) / 100)}</td></tr>`).join('');
    if (!showPrice) {
      box.innerHTML = `
        <div class="stats num trip-summary">
          <span>📏 ระยะทาง <b>${f.km.toFixed(1)} km</b></span>
          <span>⏱️ เวลาประมาณ <b>${Math.round(f.min)} นาที</b></span>
        </div>
        ${f.chargeStops ? `<div class="notice">ทริปไกล อาจต้องแวะชาร์จรถ ${f.chargeStops} ครั้ง (ประมาณ +${f.chargeMinutes} นาที)</div>` : ''}
`;
      notify();
      return;
    }
    box.innerHTML = `
      <div class="total"><span>ราคาที่คำนวณ</span><span class="amount num">${baht(f.total)}</span></div>
      <div class="stats num">
        <span>ระยะทาง ${f.km.toFixed(1)} km</span>
        <span>เวลาประมาณ ${Math.round(f.min)} นาที</span>
        ${f.timeMultiplier.label ? `<span>${esc(f.timeMultiplier.label)} ×${f.timeMultiplier.multiplier}</span>` : ''}
      </div>
      ${f.chargeStops ? `<div class="notice">ระยะทางเกินระยะวิ่งต่อชาร์จ ต้องแวะชาร์จ ${f.chargeStops} ครั้ง (ประมาณ +${f.chargeMinutes} นาที)</div>` : ''}
      <details class="breakdown-wrap"><summary>รายละเอียดการคำนวณ</summary><table class="breakdown">${rows}</table></details>
      ${state.route.estimated ? '<div class="notice">เชื่อมต่อระบบเส้นทางไม่ได้ จึงใช้ระยะประมาณจากเส้นตรง × 1.35 ราคาอาจคลาดเคลื่อน</div>' : ''}`;
    notify();
  }

  for (const id of ['vehicle', 'datetime', 'roundTrip', 'airport', 'wait', 'toll']) {
    $(id).addEventListener('input', renderQuote);
    $(id).addEventListener('change', renderQuote);
  }

  /** โหลดทริปจาก quote ที่บันทึกไว้ */
  async function load({ pickup, dropoff, pickup_at, options = {} }) {
    if (pickup_at) { const d = new Date(pickup_at); if (!Number.isNaN(d.getTime())) $('datetime').value = toLocalInput(d); }
    if (options.vehicleId && cfg.vehicles.some((v) => v.id === options.vehicleId)) $('vehicle').value = options.vehicleId;
    $('roundTrip').checked = !!options.roundTrip;
    $('airport').checked = !!options.airport;
    $('wait').value = options.waitHours || 0;
    $('toll').value = options.tollBaht || 0;
    if (pickup) await setPlace('pickup', pickup, pickup.name, { route: false });
    if (dropoff) await setPlace('dropoff', dropoff, dropoff.name, { route: false });
    await updateRoute();
  }

  return { state, setPlace, load, readOptions, rerender: renderQuote };
}
