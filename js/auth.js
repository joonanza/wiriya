// ===== หน้าของคนขับ: ตรวจล็อกอิน (เฉพาะโหมด Supabase) + แถบสถานะ + ปุ่มออกจากระบบ =====
import { getStore } from './store.js';
import { $, esc, toast } from './ui.js';

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
  if (session) return store;

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
