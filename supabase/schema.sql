-- =====================================================================
-- Wiriya: ฐานข้อมูลระบบเสนอราคารถรับส่ง (Supabase / PostgreSQL)
-- วิธีใช้: Supabase Dashboard → SQL Editor → New query → วางทั้งไฟล์ → Run
-- รันซ้ำได้ (idempotent)
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- ลูกค้า ----------
create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default '',
  phone       text unique,                 -- 0XXXXXXXXX
  line_id     text,
  note        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists customers_line_idx on public.customers (lower(line_id));

-- ---------- ใบเสนอราคา / งาน ----------
create table if not exists public.quotes (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid references public.customers(id) on delete set null,
  customer_name   text,
  customer_phone  text,
  customer_line   text,
  pickup          jsonb,                   -- {name, lat, lng}
  dropoff         jsonb,
  pickup_at       timestamptz,
  distance_km     numeric(8,2),
  duration_min    numeric(8,1),
  options         jsonb not null default '{}'::jsonb,
  fare_calc       numeric(10,2),           -- ราคาที่ระบบคำนวณ
  fare_quoted     numeric(10,2),           -- ราคาที่คนขับเสนอจริง
  status          text not null default 'draft'
                  check (status in ('request','draft','sent','confirmed','done','cancelled')),
  source          text not null default 'driver' check (source in ('driver','customer')),
  channel         text,                    -- sms | line | whatsapp | copy
  note            text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists quotes_created_idx  on public.quotes (created_at desc);
create index if not exists quotes_customer_idx on public.quotes (customer_id);
create index if not exists quotes_status_idx   on public.quotes (status);

-- ---------- ค่าตั้งค่า (เรทราคา, ต้นทุนรถ) ----------
create table if not exists public.settings (
  key         text primary key,            -- 'fare_config' | 'cost_inputs'
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ---------- ค่าใช้จ่ายจริง (ชาร์จไฟ, บำรุงรักษา, ยาง, ประกัน ฯลฯ) ----------
create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  date         date not null default current_date,
  category     text not null default 'other'
               check (category in ('charge','maintenance','tires','insurance','toll','other')),
  amount       numeric(10,2) not null check (amount >= 0),
  odometer_km  numeric(9,1),
  note         text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists expenses_date_idx on public.expenses (date desc);

-- ---------- updated_at อัตโนมัติ ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists customers_touch on public.customers;
create trigger customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();
drop trigger if exists quotes_touch on public.quotes;
create trigger quotes_touch before update on public.quotes
  for each row execute function public.touch_updated_at();
drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

-- =====================================================================
-- Row Level Security
--   คนขับ = ผู้ใช้ที่ล็อกอินแล้ว (authenticated) → อ่าน/เขียนได้ทั้งหมด
--   ลูกค้า (anon) → อ่านได้แค่เรทราคา และส่งคำขอจองผ่านฟังก์ชันด้านล่างเท่านั้น
--   ⚠️ ต้องปิด "Allow new users to sign up" ใน Authentication → Providers → Email
-- =====================================================================
alter table public.customers enable row level security;
alter table public.quotes    enable row level security;
alter table public.settings  enable row level security;
alter table public.expenses  enable row level security;

drop policy if exists driver_all_expenses on public.expenses;
create policy driver_all_expenses on public.expenses
  for all to authenticated using (true) with check (true);

drop policy if exists driver_all_customers on public.customers;
create policy driver_all_customers on public.customers
  for all to authenticated using (true) with check (true);

drop policy if exists driver_all_quotes on public.quotes;
create policy driver_all_quotes on public.quotes
  for all to authenticated using (true) with check (true);

drop policy if exists driver_all_settings on public.settings;
create policy driver_all_settings on public.settings
  for all to authenticated using (true) with check (true);

drop policy if exists public_read_fare on public.settings;
create policy public_read_fare on public.settings
  for select to anon using (key = 'fare_config');

-- =====================================================================
-- ลูกค้าส่งคำขอจองจากหน้า customer.html
-- SECURITY DEFINER: ลูกค้าไม่ได้สิทธิ์เขียนตารางตรง ๆ ทำได้เฉพาะผ่านฟังก์ชันนี้
-- ไม่แก้ชื่อ/ข้อมูลลูกค้าเดิม (กันคนอื่นใช้เบอร์เราไปเปลี่ยนชื่อ)
-- =====================================================================
create or replace function public.submit_booking_request(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_name  text := left(coalesce(trim(p->>'customer_name'), ''), 100);
  v_phone text := left(regexp_replace(coalesce(p->>'customer_phone', ''), '\D', '', 'g'), 15);
  v_line  text := left(coalesce(trim(p->>'customer_line'), ''), 50);
  v_note  text := left(coalesce(p->>'note', ''), 1000);
  v_cid   uuid;
  v_qid   uuid;
begin
  if v_phone like '66%' and length(v_phone) = 11 then v_phone := '0' || substr(v_phone, 3); end if;
  if v_phone = '' and v_line = '' then
    raise exception 'ต้องระบุเบอร์โทรหรือ LINE ID';
  end if;
  if (select count(*) from public.quotes where status = 'request' and created_at > now() - interval '10 minutes') > 30 then
    raise exception 'มีคำขอจำนวนมากเกินไป กรุณาลองใหม่ภายหลัง';
  end if;

  if v_phone <> '' then
    insert into public.customers (name, phone, line_id)
    values (v_name, v_phone, nullif(v_line, ''))
    on conflict (phone) do update set phone = excluded.phone   -- ไม่แก้ข้อมูลเดิม แค่คืน id
    returning id into v_cid;
  end if;

  insert into public.quotes (
    customer_id, customer_name, customer_phone, customer_line,
    pickup, dropoff, pickup_at, distance_km, duration_min, options,
    fare_calc, fare_quoted, status, source, note)
  values (
    v_cid, v_name, nullif(v_phone, ''), nullif(v_line, ''),
    p->'pickup', p->'dropoff', nullif(p->>'pickup_at', '')::timestamptz,
    nullif(p->>'distance_km', '')::numeric, nullif(p->>'duration_min', '')::numeric,
    coalesce(p->'options', '{}'::jsonb),
    nullif(p->>'fare_calc', '')::numeric, nullif(p->>'fare_calc', '')::numeric,
    'request', 'customer', v_note)
  returning id into v_qid;

  return v_qid;
end $$;

revoke all on function public.submit_booking_request(jsonb) from public;
grant execute on function public.submit_booking_request(jsonb) to anon, authenticated;

-- =====================================================================
-- Realtime: แจ้งเตือนคนขับทันทีเมื่อมีคำขอใหม่ (เด้งในแอปขณะเปิดอยู่)
-- =====================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'quotes'
  ) then
    alter publication supabase_realtime add table public.quotes;
  end if;
end $$;
