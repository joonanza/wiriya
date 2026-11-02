// @ts-nocheck
// ===== Supabase Edge Function: notify-line =====
// ส่ง LINE (ผ่าน LINE Official Account / Messaging API) หาคนขับเมื่อลูกค้าส่งคำขอจอง
//
// Secrets ที่ต้องตั้ง (Dashboard → Edge Functions → Secrets):
//   LINE_CHANNEL_ACCESS_TOKEN  channel access token (long-lived) ของ Messaging API channel
//   LINE_DRIVER_USER_ID        User ID ของคนขับ (ขึ้นต้นด้วย U...) ใส่หลายคนคั่นด้วย , ได้
//   APP_URL                    เช่น https://joonanza.github.io/wiriya/
//   ALLOWED_ORIGIN (ไม่บังคับ)   เช่น https://joonanza.github.io
// SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY มีให้อัตโนมัติใน Edge Function
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createHandler } from './handler.js';

const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

const handle = createHandler({
  env: (name) => Deno.env.get(name),
  fetch: (...args) => fetch(...args),
  async claimRequest(id, sinceIso) {
    const { data, error } = await admin.from('quotes')
      .update({ line_notified_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'request')
      .is('line_notified_at', null)
      .gte('created_at', sinceIso)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },
  async releaseClaim(id) {
    await admin.from('quotes').update({ line_notified_at: null }).eq('id', id);
  },
  async isDriverEmail(email) {
    const { data } = await admin.from('drivers').select('email').eq('email', email).maybeSingle();
    return !!data;
  },
  async getUser(jwt) {
    const { data, error } = await admin.auth.getUser(jwt);
    return error ? null : data.user;
  },
});

Deno.serve(handle);
