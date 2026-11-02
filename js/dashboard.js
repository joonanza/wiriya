// ===== แดชบอร์ด: ระยะทางสะสม รายได้ ต้นทุน ค่าบำรุง กำไร + บันทึกค่าใช้จ่าย =====
import { requireDriver } from './auth.js';
import { summarize, monthlySeries, periodRange, EXPENSE_CATEGORIES } from './stats.js';
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
  $('actTable').innerHTML = Object.entries(EXPENSE_CATEGORIES)
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
  try {
    const saved = await store.saveExpense({
      date: $('eDate').value,
      category: $('eCat').value,
      amount,
      odometer_km: $('eOdo').value ? Number($('eOdo').value) : null,
      note: $('eNote').value.trim(),
    });
    expenses.unshift(saved);
    expenses.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    $('eAmount').value = ''; $('eOdo').value = ''; $('eNote').value = '';
    toast('บันทึกค่าใช้จ่ายแล้ว');
    render();
  } catch (err) { toast(`บันทึกไม่สำเร็จ: ${err.message}`); }
});

try {
  [quotes, expenses] = await Promise.all([store.listQuotes({ limit: 5000 }), store.listExpenses()]);
} catch (err) { toast(`โหลดข้อมูลไม่สำเร็จ: ${err.message}`); }
render();
