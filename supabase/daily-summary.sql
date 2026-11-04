-- ===== สรุปงานพรุ่งนี้ทาง LINE ทุกวัน 22:00 น. (เวลาไทย) =====
-- รันใน Supabase Dashboard → SQL Editor (รันซ้ำได้)
--
-- ⚠️ ก่อนรันไฟล์นี้ ต้องทำ 2 อย่าง (ห้ามใส่รหัสลับลงในไฟล์นี้หรือใน git):
--   1) Edge Functions → Secrets → เพิ่ม CRON_SECRET = รหัสสุ่มยาว ≥ 24 ตัว
--      (สร้างได้จาก SQL Editor: select encode(gen_random_bytes(24), 'hex');)
--   2) SQL Editor รันบรรทัดนี้ครั้งเดียว โดยใส่รหัสเดียวกันแทน <CRON_SECRET>:
--        select vault.create_secret('<CRON_SECRET>', 'wiriya_cron_secret');
--      (ถ้าจะเปลี่ยนรหัสภายหลัง: select vault.update_secret(id, '<ใหม่>') from vault.secrets where name = 'wiriya_cron_secret';)

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ฟังก์ชันเรียก Edge Function (อ่านรหัสลับจาก Vault ตอนรัน ไม่เก็บไว้ในตาราง cron)
create or replace function public.wiriya_send_daily_summary()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'wiriya_cron_secret';
  if v_secret is null then
    raise exception 'ยังไม่ได้ตั้ง wiriya_cron_secret ใน Vault';
  end if;
  return net.http_post(
    url := 'https://vvetegfuvijnxibmvqkn.supabase.co/functions/v1/notify-line',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- anon key (สาธารณะ อยู่ในหน้าเว็บอยู่แล้ว) ใช้ผ่านด่าน verify JWT ของ Edge Function
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2ZXRlZ2Z1dmlqbnhpYm12cWtuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2MDkzODEsImV4cCI6MjEwOTE4NTM4MX0.r8ELuIhqwV6c0VxkflxyqBT4R7EQ6nr11JkIDT2eN_M',
      'x-cron-secret', v_secret
    ),
    body := '{"event":"daily"}'::jsonb,
    timeout_milliseconds := 10000
  );
end;
$$;
-- ห้ามคนนอก (anon / authenticated) เรียกฟังก์ชันนี้ผ่าน API
revoke all on function public.wiriya_send_daily_summary() from public, anon, authenticated;

-- ตั้งเวลา: pg_cron ใช้เวลา UTC → 15:00 UTC = 22:00 น. เวลาไทย
select cron.unschedule('wiriya-daily-summary') where exists (select 1 from cron.job where jobname = 'wiriya-daily-summary');
select cron.schedule('wiriya-daily-summary', '0 15 * * *', $$select public.wiriya_send_daily_summary();$$);

-- ทดสอบส่งทันที (ถ้าพรุ่งนี้ไม่มีงานจะไม่มีข้อความ):  select public.wiriya_send_daily_summary();
-- ดูผลการเรียกล่าสุด:                                 select status_code, content from net._http_response order by created desc limit 5;
-- ดูประวัติ cron:                                      select * from cron.job_run_details order by start_time desc limit 5;
-- ยกเลิก:                                             select cron.unschedule('wiriya-daily-summary');
