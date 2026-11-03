// ===== แดชบอร์ด: ระยะทางสะสม รายได้ ต้นทุน ค่าบำรุง กำไร + บันทึกค่าใช้จ่าย =====
import { requireDriver } from './auth.js';
import { summarize, monthlySeries, periodRange, EXPENSE_CATEGORIES, isCompleted, tripDate } from './stats.js';
import { taxComparison, calibrateFromExpenses, estimateOdometer, maintenanceDue } from './planning.js';
import { computeCostPerKm } from './cost.js';
import { $, esc, baht, toast } from './ui.js';

const store = await requireDriver();
const costInputs = await store.getCostInputs();
let quotes = [];
let expenses = [];
let period = 'month';
let lastSeries = null;
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => lastSeries && renderChart(lastSeries), 150); });

const PERIODS = [['month', 'เดือนนี้'], ['lastMonth', 'เดือนก่อน'], ['3m', '3 เดือน'], ['year', 'ปีนี้'], ['all', 'ทั้งหมด']];
const km = (x) => `${Math.round(x).toLocaleString('th-TH')} km`;

$('eCat').innerHTML = Object.entries(EXPENSE_CATEGORIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
const today = new Date();
$('eDate').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

function renderPeriods() {
  $('periods').innerHTML = PERIODS.map(([k, l]) =>
    `<button type="button" class="chip ${k === period ? 'active' : ''}" role="tab" aria-selected="${k === period}" data-p="${k}">${l}</button>`).join('');
  $('periods').querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { period = b.dataset.p; render(); }));
}

function render() {
  renderMaintenance?.();
  renderCalibration?.();
  renderTax?.();
  renderPeriods();
  const s = summarize(quotes, expenses, costInputs, periodRange(period));
  const all = summarize(quotes, expenses, costInputs, periodRange('all'));

  $('kpis').innerHTML = [
    ['รายได้', baht(s.revenue), s.toll ? `รวมค่าทางด่วน ${baht(s.toll)}` : ''],
    ['จำนวนเที่ยว', s.trips.toLocaleString('th-TH'), s.trips ? `เฉลี่ย ${baht(s.avgFare)}/เที่ยว` : ''],
    ['ระยะทาง (มีผู้โดยสาร)', km(s.km), `รวมวิ่งรถเปล่า ~${km(s.totalKm)}`],
    ['รายได้ต่อ km', s.km ? `${s.perKm.toFixed(1)} ฿` : '-', `ชั่วโมงขับ ~${s.hours.toFixed(1)} ชม.`],
    ['กำไรโดยประมาณ', baht(s.estProfit), 'หลังหักต้นทุนรถทั้งหมด'],
    ['ระยะทางสะสมทั้งหมด', km(all.totalKm), `${all.trips} เที่ยว · ${baht(all.revenue)}`],
  ].map(([k, v, sub]) => `<div class="kpi"><div class="k">${k}</div><div class="v num">${v}</div>${sub ? `<div class="k">${esc(sub)}</div>` : ''}</div>`).join('');

  const e = s.est;
  $('costNote').textContent = `คิดจากระยะวิ่งรวม ~${km(s.totalKm)} (รวมรถเปล่า ${Math.round((costInputs.deadheadPct || 0) * 100)}%) × ต้นทุนต่อ km ในหน้าตั้งค่า`;
  $('estTable').innerHTML = [
    ['ค่าไฟ / พลังงาน', e.energy],
    ['ค่าบำรุงรักษา (ควรกันไว้)', e.maintenance],
    ['ค่าเสื่อมราคา', e.depreciation],
    ['ประกัน / ภาษี / อื่น ๆ', e.fixed],
    ['<b>ต้นทุนรวม</b>', e.total],
    ['<b>กำไรโดยประมาณ</b>', s.estProfit],
  ].map(([l, v]) => `<tr><td>${l}</td><td class="${v < 0 ? 'neg' : ''}">${baht(v)}</td></tr>`).join('');
  $('actTable').innerHTML = Object.entries(EXPENSE_CATEGORIES).filter(([k]) => k !== 'odometer')
    .map(([k, l]) => `<tr><td>${l}</td><td>${baht(s.actualByCat[k])}</td></tr>`).join('')
    + `<tr><td><b>รวมจ่ายจริง</b></td><td>${baht(s.actualTotal)}</td></tr>`
    + `<tr><td><b>เงินเหลือ (รายได้ − ทางด่วน − จ่ายจริง)</b></td><td class="${s.cashProfit < 0 ? 'neg' : ''}">${baht(s.cashProfit)}</td></tr>`;

  lastSeries = monthlySeries(quotes, 6);
  renderChart(lastSeries);
  renderExpenses();
}

// ---------- กราฟแท่ง (series เดียว: รายได้) ----------
function renderChart(series) {
  const W = Math.max(280, Math.round($('chart').clientWidth || 640)), H = 220, padL = 44, padB = 28, padT = 12, padR = 8;
  const max = Math.max(1, ...series.map((d) => d.revenue));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const iw = W - padL - padR, ih = H - padT - padB;
  const bw = Math.min(48, iw / series.length - 16);
  const x = (i) => padL + (iw / series.length) * (i + 0.5);
  const y = (v) => padT + ih - (v / top) * ih;
  const grid = [];
  for (let v = 0; v <= top + 1e-9; v += step) {
    grid.push(`<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`
      + `<text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end" class="axis">${v >= 1000 ? (v / 1000).toLocaleString('th-TH') + 'k' : v}</text>`);
  }
  const bars = series.map((d, i) => {
    const h = Math.max(0, ih - (y(d.revenue) - padT));
    const r = Math.min(4, h / 2, bw / 2);
    const x0 = x(i) - bw / 2, y0 = y(d.revenue), yb = padT + ih;
    const path = h > 0
      ? `M${x0},${yb} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + bw - r} Q${x0 + bw},${y0} ${x0 + bw},${y0 + r} V${yb} Z`
      : '';
    return `<g class="bar" data-i="${i}" tabindex="0" aria-label="${esc(d.label)} รายได้ ${baht(d.revenue)}">
      <rect x="${x(i) - (iw / series.length) / 2}" y="${padT}" width="${iw / series.length}" height="${ih}" fill="transparent"/>
      ${path ? `<path d="${path}" class="bar-fill"/>` : ''}
      <text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="axis">${esc(d.label)}</text>
    </g>`;
  }).join('');
  $('chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟรายได้รายเดือน">${grid.join('')}<line x1="${padL}" x2="${W - padR}" y1="${padT + ih}" y2="${padT + ih}" class="baseline"/>${bars}</svg>`;

  const tip = $('chartTip');
  const show = (g, ev) => {
    const d = series[Number(g.dataset.i)];
    tip.innerHTML = `<b>${esc(d.label)}</b><br>รายได้ ${baht(d.revenue)}<br>${d.trips} เที่ยว · ${km(d.km)}`;
    tip.hidden = false;
    const rect = g.getBoundingClientRect();
    const px = ev?.clientX ?? rect.left + rect.width / 2;
    tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, px - tip.offsetWidth / 2))}px`;
    tip.style.top = `${Math.max(8, rect.top + 4)}px`;
    $('chart').querySelectorAll('.bar').forEach((b) => b.classList.toggle('dim', b !== g));
  };
  const hide = () => { tip.hidden = true; $('chart').querySelectorAll('.bar').forEach((b) => b.classList.remove('dim')); };
  $('chart').querySelectorAll('.bar').forEach((g) => {
    g.addEventListener('pointerenter', (ev) => show(g, ev));
    g.addEventListener('pointerleave', hide);
    g.addEventListener('focus', () => show(g));
    g.addEventListener('blur', hide);
  });

  $('chartTable').innerHTML = '<tr><td class="muted">เดือน</td><td class="muted">รายได้</td><td class="muted">เที่ยว</td><td class="muted">ระยะทาง</td></tr>'
    + series.map((d) => `<tr><td>${esc(d.label)}</td><td>${baht(d.revenue)}</td><td>${d.trips}</td><td>${km(d.km)}</td></tr>`).join('');
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

// ---------- ค่าใช้จ่าย ----------
function renderExpenses() {
  const r = periodRange(period);
  const rows = expenses.filter((x) => { const d = new Date(`${x.date}T00:00:00`); return d >= r.from && d < r.to; });
  $('expList').innerHTML = rows.length ? rows.slice(0, 100).map((x) => `
    <div class="exp-item" data-id="${esc(x.id)}">
      <div><b>${esc(EXPENSE_CATEGORIES[x.category] || x.category)}</b> <span class="muted">${esc(new Date(`${x.date}T00:00:00`).toLocaleDateString('th-TH', { dateStyle: 'medium' }))}${x.odometer_km ? ` · ไมล์ ${Number(x.odometer_km).toLocaleString('th-TH')}` : ''}</span>
        ${x.note ? `<div class="muted">${esc(x.note)}</div>` : ''}</div>
      <div class="exp-amt num">${baht(x.amount)} <button type="button" class="link-btn danger-text" data-del>ลบ</button></div>
    </div>`).join('') : '<p class="empty">ยังไม่มีค่าใช้จ่ายในช่วงนี้</p>';
  $('expList').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.closest('[data-id]').dataset.id;
    if (!confirm('ลบรายการนี้?')) return;
    try { await store.deleteExpense(id); expenses = expenses.filter((x) => x.id !== id); render(); toast('ลบแล้ว'); }
    catch (err) { toast(`ลบไม่สำเร็จ: ${err.message}`); }
  }));
}

$('expForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const amount = Number($('eAmount').value);
  if (!(amount >= 0)) { toast('ใส่จำนวนเงิน'); return; }
  if ($('eCat').value === 'odometer' && !$('eOdo').value) { toast('ใส่เลขไมล์'); $('eOdo').focus(); return; }
  try {
    const saved = await store.saveExpense({
      date: $('eDate').value,
      category: $('eCat').value,
      amount,
      odometer_km: $('eOdo').value ? Number($('eOdo').value) : null,
      note: $('eNote').value.trim(),
      kwh: $('eCat').value === 'charge' && $('eKwh').value ? Number($('eKwh').value) : null,
      item: ['maintenance', 'tires'].includes($('eCat').value) && $('eItem').value ? $('eItem').value : null,
    });
    expenses.unshift(saved);
    expenses.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    $('eAmount').value = ''; $('eOdo').value = ''; $('eNote').value = ''; $('eKwh').value = ''; $('eItem').value = '';
    toast('บันทึกค่าใช้จ่ายแล้ว');
    render();
  } catch (err) { toast(`บันทึกไม่สำเร็จ: ${err.message}`); }
});

// ---------- ฟอร์มค่าใช้จ่าย: ช่องเพิ่มตามประเภท ----------
$('eItem').innerHTML = '<option value="">— ไม่ระบุ —</option>'
  + (costInputs.maintenance || []).filter((m) => m.name).map((m) => `<option value="${esc(m.name)}">${esc(m.name)} (ทุก ${Number(m.intervalKm || 0).toLocaleString('th-TH')} km)</option>`).join('');
function syncExpenseForm() {
  const c = $('eCat').value;
  $('eKwhField').hidden = c !== 'charge';
  $('eItemField').hidden = !['maintenance', 'tires'].includes(c);
  if (c === 'odometer') { $('eAmount').value = '0'; }
}
$('eCat').addEventListener('change', syncExpenseForm);
syncExpenseForm();

// ---------- 🔧 บำรุงรักษาตามเลขไมล์ ----------
function renderMaintenance() {
  const odo = estimateOdometer(expenses, quotes, costInputs.deadheadPct || 0);
  if (!odo) {
    $('odoInfo').innerHTML = 'ยังไม่มีเลขไมล์ → บันทึกค่าใช้จ่ายประเภท <b>"บันทึกเลขไมล์"</b> ด้านล่างครั้งแรก แล้วระบบจะประมาณเลขไมล์ต่อจากงานที่วิ่ง';
    $('maintList').innerHTML = '';
    return;
  }
  $('odoInfo').innerHTML = `เลขไมล์ประมาณ <b class="num">${odo.estimated.toLocaleString('th-TH')} km</b>
    <span class="small">(บันทึกล่าสุด ${odo.reading.toLocaleString('th-TH')} km เมื่อ ${esc(new Date(`${odo.readingDate}T00:00:00`).toLocaleDateString('th-TH', { dateStyle: 'medium' }))} + วิ่งงานหลังจากนั้น ~${odo.addedKm.toLocaleString('th-TH')} km)</span>`;
  const due = maintenanceDue(costInputs.maintenance, expenses, odo.estimated);
  const icon = { overdue: '🔴', soon: '🟠', ok: '🟢' };
  $('maintList').innerHTML = due.map((d) => `
    <div class="day-job maint-${d.status}">
      <span class="day-time">${icon[d.status]}</span>
      <span class="day-txt"><b>${esc(d.name)}</b>
        <span class="muted">${d.status === 'overdue' ? `เลยกำหนด ${Math.abs(d.remaining).toLocaleString('th-TH')} km` : `อีก ${d.remaining.toLocaleString('th-TH')} km`}
          (ที่ ${d.dueAt.toLocaleString('th-TH')} km)${d.noHistory ? ' · ยังไม่มีประวัติ นับรอบจากเลขไมล์' : ` · ทำล่าสุด ${d.lastKm.toLocaleString('th-TH')} km`}</span></span>
      <span class="muted small">ทุก ${d.intervalKm.toLocaleString('th-TH')} km</span>
    </div>`).join('') || '<p class="empty">ยังไม่มีรายการบำรุงรักษาในหน้าตั้งค่า</p>';
}

// ---------- 🧪 ต้นทุนจริง vs โมเดล ----------
function renderCalibration() {
  const r = calibrateFromExpenses(expenses, costInputs);
  if (!r.ok) {
    $('calib').innerHTML = `<p class="empty">${esc(r.reason)}</p><p class="muted small">เคล็ดลับ: ทุกครั้งที่ชาร์จ ให้ใส่เลขไมล์และ kWh ด้วย จะได้ตัวเลขแม่นที่สุด</p>`;
    return;
  }
  const model = computeCostPerKm(costInputs);
  const kwhModel = Number(costInputs.kwhPer100km) || 0;
  const kwhActual = r.kwhPer100km ?? r.kwhPer100kmEstimated;
  const row = (label, actual, modelV, unit, digits = 2) => {
    const diff = modelV ? ((actual - modelV) / modelV) * 100 : 0;
    return `<tr><td>${label}</td><td class="num">${actual.toFixed(digits)} ${unit}</td><td class="num">${modelV.toFixed(digits)} ${unit}</td>
      <td class="num ${Math.abs(diff) > 15 ? 'neg' : ''}">${diff >= 0 ? '+' : ''}${diff.toFixed(0)}%</td></tr>`;
  };
  $('calib').innerHTML = `
    <p class="muted small">ช่วงเลขไมล์ ${esc(r.from)} → ${esc(r.to)} · วิ่ง ${Math.round(r.km).toLocaleString('th-TH')} km · ค่าชาร์จ ${baht(r.chargeBaht)} · ค่าบำรุง ${baht(r.maintBaht)}</p>
    <div class="scroll-x"><table class="breakdown num">
      <tr><td class="muted">รายการ</td><td class="muted">จริง</td><td class="muted">โมเดล</td><td class="muted">ต่าง</td></tr>
      ${row('ค่าไฟ / พลังงาน', r.energyPerKm, model.energy, '฿/km')}
      ${kwhActual ? row(`อัตราใช้ไฟ${r.kwhPer100km ? '' : ' (ประมาณจากเงิน)'}`, kwhActual, kwhModel, 'kWh/100km', 1) : ''}
      ${r.bahtPerKwh ? row('ราคาไฟเฉลี่ย', r.bahtPerKwh, (costInputs.homeSharePct * costInputs.homeRate + (1 - costInputs.homeSharePct) * costInputs.dcRate) || 0, '฿/kWh') : ''}
      ${row('ค่าบำรุงรักษา (ช่วงนี้)', r.maintenancePerKm, model.maintenance, '฿/km')}
    </table></div>
    <p class="muted small">ค่าบำรุงช่วงสั้น ๆ ผันผวนมาก (เช่น เพิ่งเปลี่ยนยาง) ใช้ดูแนวโน้มเท่านั้น · ค่าไฟใช้ปรับโมเดลได้</p>
    ${kwhActual ? `<div class="actions"><button type="button" class="primary" id="applyCalib" style="white-space:normal;text-align:center">ใช้อัตราใช้ไฟจริง ${kwhActual.toFixed(1)} kWh/100km${r.bahtPerKwh ? ` และราคาไฟ ${r.bahtPerKwh.toFixed(2)} ฿/kWh` : ''} ในโมเดลต้นทุน</button></div>` : ''}`;
  $('applyCalib')?.addEventListener('click', async () => {
    if (!confirm('อัปเดตโมเดลต้นทุนด้วยค่าจริง? (ไปกด "นำเรทแนะนำไปใช้" ในหน้าตั้งค่าอีกครั้ง ถ้าต้องการปรับราคาตาม)')) return;
    const next = { ...costInputs, kwhPer100km: Math.round(kwhActual * 10) / 10 };
    if (r.bahtPerKwh) { next.homeRate = Math.round(r.bahtPerKwh * 100) / 100; next.dcRate = next.homeRate; }
    try { await store.saveCostInputs(next); Object.assign(costInputs, next); toast('อัปเดตโมเดลต้นทุนแล้ว'); render(); }
    catch (e) { toast(`บันทึกไม่สำเร็จ: ${e.message}`); }
  });
}

// ---------- 🧾 สรุปภาษีประจำปี ----------
const thisYear = new Date().getFullYear();
$('taxYear').innerHTML = [thisYear, thisYear - 1, thisYear - 2].map((y) => `<option value="${y}">ปีภาษี ${y + 543}</option>`).join('');
function renderTax() {
  const y = Number($('taxYear').value);
  const inYear = (d) => d.getFullYear() === y;
  const trips = quotes.filter((q) => isCompleted(q) && inYear(tripDate(q)));
  const income = trips.reduce((s, q) => s + (Number(q.fare_quoted) || 0), 0);
  const exp = expenses.filter((e) => e.category !== 'odometer' && inYear(new Date(`${e.date}T00:00:00`)));
  const actual = exp.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  // ค่าเสื่อมราคารถ (ตามจริงหักได้ ต้องมีหลักฐานการซื้อ): ราคารถ ÷ 5 ปี
  const depr = (Number(costInputs.carPrice) || 0) / 5;
  const t = taxComparison({ income, actualExpenses: actual + depr, otherNetIncome: Number($('taxOther').value) || 0, allowances: Number($('taxAllow').value) || 0 });
  const col = (r, label) => `<td class="num">${baht(r.expense)}<span class="note">${label}</span></td><td class="num">${baht(r.net)}</td><td class="num"><b>${baht(r.tax)}</b>${r.method === 2 ? '<span class="note">วิธีที่ 2 (0.5%)</span>' : ''}</td><td class="num">${baht(r.extraTax)}</td>`;
  $('tax').innerHTML = `
    <div class="kpis"><div class="kpi"><div class="k">รายได้ขับรถปี ${y + 543}</div><div class="v num">${baht(income)}</div><div class="k">${trips.length} เที่ยว</div></div>
      <div class="kpi"><div class="k">ค่าใช้จ่ายจริงที่บันทึก</div><div class="v num">${baht(actual)}</div><div class="k">+ ค่าเสื่อมรถ ~${baht(depr)}/ปี</div></div>
      <div class="kpi"><div class="k">วิธีที่ประหยัดกว่า</div><div class="v">${t.best === 'flat' ? 'หักเหมา 60%' : 'หักตามจริง'}</div><div class="k">ประหยัด ~${baht(Math.abs(t.flat.tax - t.actual.tax))}</div></div></div>
    <div class="scroll-x"><table class="breakdown">
      <tr><td class="muted">วิธีหัก</td><td class="muted">ค่าใช้จ่ายที่หัก</td><td class="muted">เงินได้สุทธิ</td><td class="muted">ภาษีทั้งหมด</td><td class="muted">ส่วนที่เพิ่มจากงานขับรถ</td></tr>
      <tr class="${t.best === 'flat' ? 'best' : ''}"><td>หักเหมา 60%</td>${col(t.flat, 'ไม่ต้องใช้ใบเสร็จ')}</tr>
      <tr class="${t.best === 'actual' ? 'best' : ''}"><td>หักตามจริง</td>${col(t.actual, 'ต้องมีหลักฐานทุกรายการ')}</tr>
    </table></div>
    ${t.vatWarning ? '<div class="notice">⚠️ รายได้เกิน 1.8 ล้านบาท/ปี ต้องจดทะเบียนภาษีมูลค่าเพิ่ม (VAT)</div>' : ''}
    <p class="muted small">⚠️ เป็นการประมาณการเพื่อวางแผนเท่านั้น: เงินได้ 40(8) หักค่าใช้จ่ายเหมาได้ 60% หรือหักตามจริงถ้ามีหลักฐาน · ใช้ขั้นภาษีบุคคลธรรมดาปัจจุบัน · คิดวิธีที่ 2 (0.5% เมื่อเงินได้ 40(2)–(8) ≥ 120,000 และภาษีเกิน 5,000) ·
      ไม่รวมภาษีครึ่งปี (ภ.ง.ด.94) และเงินได้ประเภทอื่น · ควรตรวจสอบกับกรมสรรพากรหรือผู้เชี่ยวชาญก่อนยื่นจริง</p>`;
}
for (const id of ['taxYear', 'taxOther', 'taxAllow']) $(id).addEventListener('input', renderTax);

try {
  [quotes, expenses] = await Promise.all([store.listQuotes({ limit: 5000 }), store.listExpenses()]);
} catch (err) { toast(`โหลดข้อมูลไม่สำเร็จ: ${err.message}`); }
render();
