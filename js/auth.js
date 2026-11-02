// ===== หน้าของคนขับ: ตรวจล็อกอิน (เฉพาะโหมด Supabase) + แถบสถานะ + ปุ่มออกจากระบบ =====
import { getStore } from './store.js';
import { $, esc, toast, shortPlace } from './ui.js';

/**
 * เรียกตอนเริ่มทุกหน้าของคนขับ คืนค่า store เมื่อพร้อมใช้งาน
 * ถ้ายังไม่ล็อกอิน (โหมด Supabase) จะแสดงฟอร์มล็อกอินแทนเนื้อหา และ promise นี้จะไม่ resolve จนกว่าจะล็อกอิน
 */
export async function requireDriver() {
  const store = await getStore();
  renderModeBanner(store);
  updateRequestBadge(store);
  if (store.mode !== 'supabase') return store;

  const session = await store.getSession();
  addLogout(store);
  if (session) { startRequestNotifier(store); return store; }

  const main = document.querySelector('main');
  main.hidden = true;
  const box = document.createElement('main');
  box.innerHTML = `
    <div class="card login-card">
      <h2>เข้าสู่ระบบคนขับ</h2>
      <form id="loginForm">
        <div class="field"><label for="loginEmail">อีเมล</label><input id="loginEmail" type="email" autocomplete="username" required></div>
        <div class="field"><label for="loginPw">รหัสผ่าน</label><input id="loginPw" type="password" autocomplete="current-password" required></div>
        <button class="primary" type="submit" style="width:100%">เข้าสู่ระบบ</button>
        <p class="muted" id="loginErr" role="alert"></p>
      </form>
    </div>`;
  main.after(box);
  return new Promise(() => {
    $('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('loginErr').textContent = '';
      try {
        await store.signIn($('loginEmail').value.trim(), $('loginPw').value);
        location.reload();
      } catch (err) {
        $('loginErr').textContent = `เข้าสู่ระบบไม่สำเร็จ: ${err.message}`;
      }
    });
  });
}

function renderModeBanner(store) {
  if (store.mode === 'supabase') return;
  const b = document.createElement('div');
  b.className = 'mode-banner';
  b.innerHTML = store.connectionError
    ? `⚠️ เชื่อมต่อฐานข้อมูลไม่ได้ (${esc(store.connectionError)}) ตอนนี้ใช้ข้อมูลในเครื่องนี้แทน`
    : '💾 โหมดเก็บข้อมูลในเครื่อง: ข้อมูลลูกค้าและประวัติอยู่ในเบราว์เซอร์นี้เท่านั้น (ยังไม่ได้เชื่อมฐานข้อมูล)';
  document.querySelector('header.top')?.after(b);
}

function addLogout(store) {
  const nav = document.querySelector('header.top nav');
  if (!nav || $('logoutBtn')) return;
  const a = document.createElement('a');
  a.href = '#'; a.id = 'logoutBtn'; a.textContent = 'ออกจากระบบ';
  a.addEventListener('click', async (e) => {
    e.preventDefault();
    await store.signOut();
    toast('ออกจากระบบแล้ว');
    location.reload();
  });
  nav.append(a);
}

async function updateRequestBadge(store) {
  try {
    const session = store.mode === 'supabase' ? await store.getSession() : true;
    if (!session) return;
    const n = await store.countRequests();
    const link = document.querySelector('header.top nav a[href="history.html"]');
    if (link && n > 0) link.insertAdjacentHTML('beforeend', ` <span class="nav-badge">${n}</span>`);
  } catch { /* ไม่ใช่เรื่องสำคัญ */ }
}

// ===== แจ้งเตือนคำขอใหม่จากลูกค้า (real-time + ตรวจซ้ำทุก 60 วินาทีเผื่อ realtime หลุด) =====
const seen = new Set();
function startRequestNotifier(store) {
  const notify = (q) => {
    if (!q || seen.has(q.id)) return;
    seen.add(q.id);
    showRequestPopup(q);
  };
  store.subscribeRequests(notify);
  let lastCount = null;
  setInterval(async () => {
    try {
      const n = await store.countRequests();
      if (lastCount !== null && n > lastCount) {
        const [latest] = await store.listQuotes({ status: 'request', limit: 1 });
        notify(latest);
      }
      lastCount = n;
    } catch { /* offline */ }
  }, 60000);
  store.countRequests().then((n) => { lastCount = n; }).catch(() => {});
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18].forEach((t) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.15);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.16);
    });
  } catch { /* เบราว์เซอร์ไม่อนุญาตเสียง */ }
}

export function showRequestPopup(q) {
  beep();
  navigator.vibrate?.([200, 100, 200]);
  const title = `🔔 คำขอใหม่จาก ${q.customer_name || 'ลูกค้า'}`;
  const body = `${shortPlace(q.pickup?.name, 1)} → ${shortPlace(q.dropoff?.name, 1)}`;
  const url = `quote.html?quote=${encodeURIComponent(q.id)}`;
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try { const n = new Notification(title, { body, tag: q.id }); n.onclick = () => { window.focus(); location.href = url; }; } catch { /* ignore */ }
  }
  let box = $('reqPopup');
  if (!box) {
    box = document.createElement('div');
    box.id = 'reqPopup'; box.className = 'req-popup'; box.setAttribute('role', 'alert');
    document.body.append(box);
  }
  box.innerHTML = `
    <div><b>${esc(title)}</b><div class="muted">${esc(body)}</div></div>
    <div class="req-popup-actions">
      <a class="btn primary" href="${url}">เสนอราคา</a>
      <button type="button" class="icon" aria-label="ปิด">✕</button>
    </div>`;
  box.hidden = false;
  box.querySelector('button').onclick = () => { box.hidden = true; };
  const link = document.querySelector('header.top nav a[href="history.html"]');
  if (link) {
    const b = link.querySelector('.nav-badge');
    if (b) b.textContent = String(Number(b.textContent || 0) + 1);
    else link.insertAdjacentHTML('beforeend', ' <span class="nav-badge">1</span>');
  }
  if (!document.title.startsWith('🔔')) document.title = `🔔 ${document.title}`;
}

/** ขอสิทธิ์แจ้งเตือนของเบราว์เซอร์ (ต้องกดจากปุ่ม) */
export async function enableNotifications() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.requestPermission();
}
