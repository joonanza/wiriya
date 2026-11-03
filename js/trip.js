// ===== ส่วนวางแผนเส้นทาง (แผนที่ + ค้นหาสถานที่ + ตัวเลือก + คำนวณราคา) ใช้ร่วมกันหน้าคนขับและหน้าลูกค้า =====
// ต้องมี element: pickup, dropoff, pickupSuggest, dropoffSuggest, gpsBtn, swapBtn, vehicle, datetime,
//                toll, wait, roundTrip, airport, map, quote
import { calculateFare } from './pricing.js';
import { calculateCharter } from './planning.js';
import { searchPlaces, reverseGeocode, getRoute, isShortMapsLink, searchCategory, PLACE_CATEGORIES, haversineKm } from './geo.js';
import { $, esc, baht, bahtExact, toast, toLocalInput, shortPlace } from './ui.js';

const join2 = (a, b) => [a, b].filter(Boolean).join(', ');

export function createTripPlanner(cfg, { onUpdate = () => {}, showPrice = true, recentPlaces = async () => [] } = {}) {
  const state = { pickup: null, dropoff: null, route: null, fare: null, trip: null };
  const sa = cfg.serviceArea || {};
  const serviceArea = Number.isFinite(Number(sa.lat)) && Number.isFinite(Number(sa.lng)) && sa.lat !== null
    ? { lat: Number(sa.lat), lng: Number(sa.lng), zoom: Number(sa.zoom) || 11 } : { lat: 13.7563, lng: 100.5018, zoom: 11 };

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
    map = L.map('map').setView([serviceArea.lat, serviceArea.lng], serviceArea.zoom || 11);
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
  // แตะช่อง → หมวดหมู่ใกล้ตัว + สถานที่ยอดนิยม + ที่เคยใช้
  // พิมพ์ ≥ 2 ตัว → ค้นจาก Photon (+ คำย่อไทยที่ขยายแล้ว) และ Nominatim เมื่อเจอน้อย · ปุ่ม "ค้นหาละเอียดเพิ่ม"
  const near = () => {
    if (hasMap) { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; }
    return state.pickup || { lat: serviceArea.lat, lng: serviceArea.lng };
  };
  let recentCache = null;
  const getRecent = async () => {
    if (!recentCache) { try { recentCache = (await recentPlaces()) || []; } catch { recentCache = []; } }
    return recentCache;
  };
  const popular = (cfg.popularPlaces || []).filter((p) => p && p.name && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
    .map((p) => ({ lat: Number(p.lat), lng: Number(p.lng), name: p.name, title: p.name, subtitle: p.note || '' }));
  const kmLabel = (d) => (d == null ? '' : d < 1 ? `${Math.round(d * 1000)} m` : `${d < 10 ? d.toFixed(1) : Math.round(d)} km`);
  const titleOf = (it) => it.title || shortPlace(it.name, 1);
  const subOf = (it) => it.subtitle ?? shortPlace(String(it.name || '').split(',').slice(1).join(','), 3);
  const ICON = { recent: '🕘', popular: '⭐', coords: '📍' };
  const matchText = (it, t) => !t || `${it.name || ''} ${it.title || ''}`.toLowerCase().includes(t);

  function setupAutocomplete(which) {
    const input = $(which);
    const list = $(`${which}Suggest`);
    let timer, ctrl, active = -1, seq = 0;
    let groups = [];   // [{ head, items: [...] }]
    let items = [];    // รายการที่เลือกได้ทั้งหมด (เรียงตามที่แสดง)
    let lastQuery = '', lastFull = false, showCats = false;
    const close = () => { list.hidden = true; active = -1; };

    const render = () => {
      items = groups.flatMap((g) => g.items);
      const lis = [];
      if (showCats) {
        const li = document.createElement('li');
        li.className = 'sugg-cats';
        li.innerHTML = PLACE_CATEGORIES.map((c) => `<button type="button" class="chip" data-cat="${c.id}">${c.icon} ${esc(c.label)}</button>`).join('');
        li.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('mousedown', (e) => { e.preventDefault(); showCategory(b.dataset.cat); }));
        lis.push(li);
      }
      let idx = 0;
      for (const g of groups) {
        if (!g.items.length && !g.empty) continue;
        if (g.head) lis.push(Object.assign(document.createElement('li'), { className: 'sugg-head', textContent: g.head }));
        if (!g.items.length && g.empty) lis.push(Object.assign(document.createElement('li'), { className: 'sugg-head', textContent: g.empty }));
        for (const it of g.items) {
          const i = idx++;
          const li = document.createElement('li');
          li.className = `sugg ${i === active ? 'active' : ''}`;
          li.innerHTML = `<span class="sugg-ico" aria-hidden="true">${ICON[it.source] || it.icon || '📌'}</span>
            <span class="sugg-txt"><b>${esc(titleOf(it))}</b>${subOf(it) ? `<span class="muted">${esc(subOf(it))}</span>` : ''}</span>
            ${it.distanceKm != null ? `<span class="sugg-dist muted">${kmLabel(it.distanceKm)}</span>` : ''}`;
          li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });
          lis.push(li);
        }
      }
      if (lastQuery && !lastFull && !showCats) {
        const more = Object.assign(document.createElement('li'), { className: 'sugg-more', textContent: '🔍 ค้นหาละเอียดเพิ่ม (รวมที่อยู่ ซอย ถนน)' });
        more.addEventListener('mousedown', (e) => { e.preventDefault(); doSearch(lastQuery, true); });
        lis.push(more);
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

    const withDist = (arr) => { const n = near(); return arr.map((x) => ({ ...x, distanceKm: x.distanceKm ?? haversineKm(n, x) })); };

    const showStart = async () => {
      lastQuery = ''; showCats = true; active = -1;
      const recent = await getRecent();
      const popKeys = new Set(popular.map((p) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`));
      groups = [
        { head: '⭐ สถานที่ยอดนิยม', items: withDist(popular).map((x) => ({ ...x, source: 'popular' })) },
        { head: '🕘 สถานที่ที่เคยใช้', items: recent.filter((r) => !popKeys.has(`${r.lat.toFixed(3)},${r.lng.toFixed(3)}`)).slice(0, 5).map((r) => ({ ...r, source: 'recent', distanceKm: null })) },
      ];
      render();
    };

    async function showCategory(catId) {
      const cat = PLACE_CATEGORIES.find((c) => c.id === catId);
      const my = ++seq;
      showCats = true; lastQuery = '';
      groups = [{ head: `${cat.icon} ${cat.label}ใกล้แผนที่ (กำลังค้นหา…)`, items: [] }];
      render();
      ctrl?.abort(); ctrl = new AbortController();
      try {
        const found = await searchCategory(catId, { near: near(), signal: ctrl.signal });
        if (my !== seq) return;
        groups = [{ head: `${cat.icon} ${cat.label}ใกล้แผนที่`, items: found.map((x) => ({ ...x, icon: cat.icon })), empty: `ไม่พบ${cat.label}ในบริเวณนี้ ลองเลื่อนแผนที่หรือพิมพ์ชื่อ` }];
        render();
      } catch (err) {
        if (err.name !== 'AbortError') toast(err.message || 'ค้นหาไม่สำเร็จ');
      }
    }

    const quickMatches = async (q) => {
      const t = q.trim().toLowerCase();
      const recent = await getRecent();
      return [
        ...withDist(popular).filter((p) => matchText(p, t)).map((x) => ({ ...x, source: 'popular' })),
        ...recent.filter((r) => matchText(r, t)).slice(0, 3).map((r) => ({ ...r, source: 'recent', distanceKm: null })),
      ];
    };

    async function doSearch(q, full) {
      const my = ++seq;
      ctrl?.abort(); ctrl = new AbortController();
      list.classList.add('loading');
      try {
        const [quick, found] = await Promise.all([quickMatches(q), searchPlaces(q, { signal: ctrl.signal, near: near(), full })]);
        if (my !== seq) return;
        lastQuery = q; lastFull = full; showCats = false; active = -1;
        groups = [
          { head: quick.length ? 'ตรงกับที่บันทึกไว้' : '', items: quick },
          { head: quick.length && found.length ? 'ผลการค้นหา' : '', items: found,
            empty: full ? 'ไม่พบสถานที่ ลองพิมพ์ชื่ออื่น ชื่อถนน หรือแตะบนแผนที่' : '' },
        ];
        if (!quick.length && !found.length && !full) groups = [{ head: 'ยังไม่พบ ลองกด "ค้นหาละเอียดเพิ่ม" ด้านล่าง', items: [] , empty: ' ' }];
        render();
      } catch (err) {
        if (err.name !== 'AbortError') toast(err.message || 'ค้นหาไม่สำเร็จ');
      } finally { list.classList.remove('loading'); }
    }

    input.addEventListener('focus', () => { if (input.value.trim().length < 2 || input.value === state[which]?.name) showStart(); });
    input.addEventListener('input', async () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (isShortMapsLink(q)) {
        groups = []; showCats = false; lastQuery = ''; render();
        toast('ลิงก์ย่อ maps.app.goo.gl อ่านพิกัดไม่ได้ ให้เปิดลิงก์ใน Google Maps แล้วคัดลอกพิกัด (กดค้างที่หมุด) มาวางแทน');
        return;
      }
      if (q.length < 2) { showStart(); return; }
      // ระหว่างรอผล แสดงสถานที่ยอดนิยม/ที่เคยใช้ที่ตรงกันก่อน
      const quick = await quickMatches(q);
      if (input.value.trim() === q) { showCats = false; lastQuery = ''; groups = [{ head: quick.length ? 'ตรงกับที่บันทึกไว้' : '', items: quick }]; render(); }
      timer = setTimeout(() => doSearch(q, false), 400);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!list.hidden && active >= 0) { choose(active); return; }
        const q = input.value.trim();
        if (q.length >= 2) { clearTimeout(timer); doSearch(q, true); }   // Enter = ค้นหาแบบละเอียด
        return;
      }
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); render(); e.preventDefault(); }
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

  // ---------- โหมดงาน: ตามระยะทาง / เหมาวัน ----------
  const modeEl = $('tripMode');
  const val = (id) => ($(id) ? $(id).value : '');
  function readCharter() {
    const mode = modeEl?.value || 'trip';
    if (mode !== 'full' && mode !== 'half') return null;
    const plan = (cfg.charter || {})[mode] || {};
    return {
      type: mode,
      days: Math.max(1, Math.round(Number(val('charterDays')) || 1)),
      estKm: Number(val('charterKm')) || 0,
      overtimeHours: Number(val('charterOt')) || 0,
      overnight: !!$('charterOvernight')?.checked,
      hours: plan.hours || 10,
    };
  }
  function syncModeUi() {
    const charter = !!readCharter();
    if ($('charterBox')) $('charterBox').hidden = !charter;
    for (const id of ['roundTrip', 'wait']) {
      const el = $(id)?.closest('.field, .check');
      if (el) el.hidden = charter;
    }
    if ($('dropoffHint')) $('dropoffHint').hidden = !charter;
  }

  function readOptions() {
    const charter = readCharter();
    return {
      vehicleId: $('vehicle').value,
      roundTrip: charter ? false : $('roundTrip').checked,
      airport: $('airport').checked,
      waitHours: charter ? 0 : Number($('wait').value) || 0,
      tollBaht: Number($('toll').value) || 0,
      ...(charter ? { charter } : {}),
    };
  }

  function readTrip() {
    const r = state.route;
    const opts = readOptions();
    if (opts.charter) {
      // เหมาวัน: ระยะทางรวมที่ใส่เอง ถ้าไม่ใส่ใช้ระยะเส้นทาง × 2 (ไป-กลับ)
      const km = opts.charter.estKm || (r ? r.distanceKm * 2 : 0);
      return { ...opts, distanceKm: km, durationMin: opts.charter.hours * 60 * opts.charter.days, datetime: new Date($('datetime').value) };
    }
    return {
      ...opts,
      distanceKm: r.distanceKm,
      durationMin: r.durationMin * (r.estimated ? 1 : cfg.trafficFactor || 1),
      datetime: new Date($('datetime').value),
    };
  }

  function renderCharterQuote(box) {
    if (!state.pickup) {
      box.innerHTML = '<p class="empty">เลือกจุดรับ (จุดส่งไม่บังคับสำหรับงานเหมา)</p>';
      state.fare = null; state.trip = null; notify(); return;
    }
    const trip = readTrip();
    const ch = trip.charter;
    const f = calculateCharter(cfg.charter, { ...ch, estKm: trip.distanceKm, tollBaht: trip.tollBaht });
    f.vehicle = cfg.vehicles.find((v) => v.id === trip.vehicleId) || cfg.vehicles[0];
    f.timeMultiplier = { multiplier: 1, label: null };
    f.charter = ch;
    state.fare = f; state.trip = trip;
    const label = `เหมา${f.plan.label} ${f.days} วัน`;
    if (!showPrice) {
      box.innerHTML = `<div class="stats num trip-summary"><span>🚐 <b>${esc(label)}</b></span>
        ${trip.distanceKm ? `<span>📏 ประมาณ <b>${Math.round(trip.distanceKm)} km</b></span>` : ''}</div>`;
      notify(); return;
    }
    const rows = f.lines.map((l) => `<tr><td>${esc(l.label)}${l.note ? `<span class="note">${esc(l.note)}</span>` : ''}</td>
      <td class="num">${bahtExact(Math.round(l.amount * 100) / 100)}</td></tr>`).join('');
    box.innerHTML = `
      <div class="total"><span>ราคา${esc(label)}</span><span class="amount num">${baht(f.total)}</span></div>
      <div class="stats num"><span>ระยะทางรวม ~${Math.round(f.km)} km (รวมให้ ${f.includedKm} km)</span><span>${f.plan.hours} ชม./วัน</span></div>
      ${!ch.estKm ? '<div class="notice">ยังไม่ได้ใส่ระยะทางรวม ระบบใช้ระยะจุดรับ↔จุดส่ง × 2 แทน (ถ้าไม่มีจุดส่ง = 0 km)</div>' : ''}
      <details class="breakdown-wrap"><summary>รายละเอียดการคำนวณ</summary><table class="breakdown">${rows}</table></details>`;
    notify();
  }

  const notify = () => onUpdate(state);

  function renderQuote() {
    const box = $('quote');
    syncModeUi();
    if (readCharter()) { renderCharterQuote(box); return; }
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

  for (const id of ['vehicle', 'datetime', 'roundTrip', 'airport', 'wait', 'toll', 'tripMode', 'charterDays', 'charterKm', 'charterOt', 'charterOvernight'].filter((x) => $(x))) {
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
    const ch = options.charter;
    if (modeEl) modeEl.value = ch ? ch.type : 'trip';
    if (ch) {
      if ($('charterDays')) $('charterDays').value = ch.days || 1;
      if ($('charterKm')) $('charterKm').value = ch.estKm || '';
      if ($('charterOt')) $('charterOt').value = ch.overtimeHours || 0;
      if ($('charterOvernight')) $('charterOvernight').checked = !!ch.overnight;
    }
    if (pickup) await setPlace('pickup', pickup, pickup.name, { route: false });
    if (dropoff) await setPlace('dropoff', dropoff, dropoff.name, { route: false });
    await updateRoute();
  }

  return { state, setPlace, load, readOptions, rerender: renderQuote };
}
