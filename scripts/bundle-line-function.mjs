// รวม notify-line เป็นไฟล์เดียว สำหรับวางใน Supabase Dashboard (Edge Functions → Editor) โดยไม่ต้องใช้ CLI
// ใช้: npm run bundle:line   → supabase/functions/notify-line/dashboard-paste.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../supabase/functions/notify-line/', import.meta.url));
const strip = (src) => src
  .replace(/^import .*?;\s*$/gm, '')
  .replace(/^export (function|async function|const)/gm, '$1');

export function buildBundle() {
  const message = strip(readFileSync(dir + 'message.js', 'utf8'));
  const handler = strip(readFileSync(dir + 'handler.js', 'utf8'));
  const index = readFileSync(dir + 'index.ts', 'utf8')
    .replace(/^\/\/ @ts-nocheck\s*$/m, '')
    .replace(/^import \{ createHandler \} from '\.\/handler\.js';\s*$/m, '');
  return [
    '// @ts-nocheck',
    '// ⚠️ ไฟล์นี้สร้างอัตโนมัติจาก message.js + handler.js + index.ts (npm run bundle:line) ห้ามแก้ตรงนี้',
    '// วางทั้งไฟล์นี้ใน Supabase Dashboard → Edge Functions → notify-line → index.ts',
    '',
    index.trim(),
    '',
    '// ---------------- message.js ----------------',
    message.trim(),
    '',
    '// ---------------- handler.js ----------------',
    handler.trim(),
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(dir + 'dashboard-paste.ts', buildBundle());
  console.log('เขียน supabase/functions/notify-line/dashboard-paste.ts แล้ว');
}
