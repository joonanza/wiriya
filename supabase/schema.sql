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
alter table public.quotes add column if not exists line_notified_at timestamptz; -- แจ้ง LINE OA แล้วเมื่อไร (กันส่งซ้ำ)
alter table public.quotes add column if not exists consent_at timestamptz;       -- ลูกค้ายินยอมให้เก็บข้อมูล (PDPA)
-- ลิงก์ยืนยันการจอง (confirm.html?t=...)
alter table public.quotes add column if not exists confirm_token text;            -- token สุ่ม ≥ 24 ตัว (สร้างตอนคนขับส่งใบเสนอราคา)
alter table public.quotes add column if not exists customer_response text
  check (customer_response in ('confirmed', 'change_requested'));
alter table public.quotes add column if not exists response_note text;
alter table public.quotes add column if not exists responded_at timestamptz;
alter table public.quotes add column if not exists response_notified_at timestamptz; -- แจ้ง LINE เรื่องคำตอบแล้ว
create unique index if not exists quotes_confirm_token_idx on public.quotes (confirm_token) where confirm_token is not null;
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
-- รายชื่อคนขับที่มีสิทธิ์ (ล็อกด้วยอีเมล)
--   ต่อให้มีคนสมัครบัญชีเองได้ ก็จะไม่เห็น/แก้ข้อมูลใด ๆ ถ้าอีเมลไม่อยู่ในตารางนี้
--   เพิ่มคนขับ: insert into public.drivers (email) values ('อีเมล');
-- =====================================================================
create table if not exists public.drivers (
  email       text primary key check (email = lower(email)),
  created_at  timestamptz not null default now()
);
alter table public.drivers enable row level security;   -- ไม่มี policy = เว็บอ่าน/แก้ตารางนี้ไม่ได้
insert into public.drivers (email) values ('wiriya.ii1998@gmail.com') on conflict do nothing;

create or replace function public.is_driver() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.drivers where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke all on function public.is_driver() from public;
grant execute on function public.is_driver() to authenticated;

-- =====================================================================
-- Row Level Security
--   คนขับ = ผู้ใช้ที่ล็อกอินแล้ว และอีเมลอยู่ใน public.drivers → อ่าน/เขียนได้ทั้งหมด
--   ลูกค้า (anon) → อ่านได้แค่เรทราคา และส่งคำขอจองผ่านฟังก์ชันด้านล่างเท่านั้น
--   แนะนำให้ปิด "Allow new users to sign up" ด้วย (Authentication → Sign In / Providers)
-- =====================================================================
alter table public.customers enable row level security;
alter table public.quotes    enable row level security;
alter table public.settings  enable row level security;
alter table public.expenses  enable row level security;

drop policy if exists driver_all_expenses on public.expenses;
create policy driver_all_expenses on public.expenses
  for all to authenticated using (public.is_driver()) with check (public.is_driver());

drop policy if exists driver_all_customers on public.customers;
create policy driver_all_customers on public.customers
  for all to authenticated using (public.is_driver()) with check (public.is_driver());

drop policy if exists driver_all_quotes on public.quotes;
create policy driver_all_quotes on public.quotes
  for all to authenticated using (public.is_driver()) with check (public.is_driver());

drop policy if exists driver_all_settings on public.settings;
create policy driver_all_settings on public.settings
  for all to authenticated using (public.is_driver()) with check (public.is_driver());

drop policy if exists public_read_fare on public.settings;
create policy public_read_fare on public.settings
  for select to anon using (key = 'fare_config');

-- =====================================================================
-- ลูกค้าส่งคำขอจองจากหน้า customer.html
-- SECURITY DEFINER: ลูกค้าไม่ได้สิทธิ์เขียนตารางตรง ๆ ทำได้เฉพาะผ่านฟังก์ชันนี้
-- ไม่แก้ชื่อ/ข้อมูลลูกค้าเดิม (กันคนอื่นใช้เบอร์เราไปเปลี่ยนชื่อ)
-- =====================================================================
-- ตรวจว่าเป็นจุด {name, lat, lng} ในประเทศไทยจริง (กันบอตส่งข้อมูลมั่ว)
create or replace function public.valid_th_place(p jsonb) returns boolean
language plpgsql immutable as $$
declare lat numeric; lng numeric;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  begin
    lat := (p->>'lat')::numeric; lng := (p->>'lng')::numeric;
  exception when others then return false;
  end;
  return lat between 5 and 21 and lng between 97 and 106
     and length(coalesce(p->>'name', '')) between 1 and 500;
end $$;

create or replace function public.submit_booking_request(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_name  text := left(coalesce(trim(p->>'customer_name'), ''), 100);
  v_phone text := left(regexp_replace(coalesce(p->>'customer_phone', ''), '\D', '', 'g'), 15);
  v_line  text := left(coalesce(trim(p->>'customer_line'), ''), 50);
  v_note  text := left(coalesce(p->>'note', ''), 1000);
  v_pickup_at timestamptz;
  v_cid   uuid;
  v_qid   uuid;
begin
  if v_phone like '66%' and length(v_phone) = 11 then v_phone := '0' || substr(v_phone, 3); end if;

  -- ---- ตรวจข้อมูล ----
  if coalesce(p->>'consent', '') <> 'true' then
    raise exception 'กรุณายินยอมให้เก็บข้อมูลเพื่อใช้ติดต่อและให้บริการ';
  end if;
  if v_name = '' then raise exception 'กรุณาใส่ชื่อ'; end if;
  if v_phone = '' and v_line = '' then raise exception 'ต้องระบุเบอร์โทรหรือ LINE ID'; end if;
  if v_phone <> '' and v_phone !~ '^0[0-9]{8,9}$' then raise exception 'เบอร์โทรไม่ถูกต้อง'; end if;
  if not public.valid_th_place(p->'pickup') or not public.valid_th_place(p->'dropoff') then
    raise exception 'ตำแหน่งรับ-ส่งไม่ถูกต้อง';
  end if;
  begin
    v_pickup_at := nullif(p->>'pickup_at', '')::timestamptz;
  exception when others then raise exception 'วัน-เวลาไม่ถูกต้อง';
  end;
  if v_pickup_at is not null and (v_pickup_at < now() - interval '1 day' or v_pickup_at > now() + interval '1 year') then
    raise exception 'วัน-เวลาไม่ถูกต้อง';
  end if;

  -- ---- จำกัดจำนวน (กันสแปม / กันโควตา LINE หมด) ----
  if (select count(*) from public.quotes where status = 'request' and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'มีคำขอจำนวนมากเกินไป กรุณาลองใหม่ภายหลัง';
  end if;
  if (select count(*) from public.quotes
        where status = 'request' and created_at > now() - interval '30 minutes'
          and ((v_phone <> '' and customer_phone = v_phone) or (v_line <> '' and lower(customer_line) = lower(v_line)))) >= 3 then
    raise exception 'ส่งคำขอบ่อยเกินไป กรุณารอคนขับติดต่อกลับ หรือโทรหาโดยตรง';
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
    fare_calc, fare_quoted, status, source, note, consent_at)
  values (
    v_cid, v_name, nullif(v_phone, ''), nullif(v_line, ''),
    jsonb_build_object('name', left(p->'pickup'->>'name', 500), 'lat', (p->'pickup'->>'lat')::numeric, 'lng', (p->'pickup'->>'lng')::numeric),
    jsonb_build_object('name', left(p->'dropoff'->>'name', 500), 'lat', (p->'dropoff'->>'lat')::numeric, 'lng', (p->'dropoff'->>'lng')::numeric),
    v_pickup_at,
    least(greatest(coalesce(nullif(p->>'distance_km', '')::numeric, 0), 0), 2000),
    least(greatest(coalesce(nullif(p->>'duration_min', '')::numeric, 0), 0), 3000),
    coalesce(p->'options', '{}'::jsonb),
    nullif(p->>'fare_calc', '')::numeric, nullif(p->>'fare_calc', '')::numeric,
    'request', 'customer', v_note, now())
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

-- =====================================================================
-- PDPA: ลบข้อมูลที่ไม่จำเป็นแล้ว (กดจากหน้าตั้งค่า → "ลบข้อมูลเก่า")
--   ลบใบเสนอราคา/คำขอที่ไม่ได้เป็นงานจริง (คำขอใหม่, ร่าง, ส่งแล้ว, ยกเลิก) ที่เก่ากว่า p_days วัน
--   และลบลูกค้าที่ไม่มีประวัติเหลืออยู่และไม่ได้อัปเดตนานกว่า p_days วัน
--   งานที่ยืนยัน/เสร็จสิ้นเก็บไว้เป็นหลักฐานรายได้
-- =====================================================================
create or replace function public.purge_old_data(p_days int default 365) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q_count int; c_count int;
begin
  if not public.is_driver() then raise exception 'ไม่มีสิทธิ์'; end if;
  if p_days < 30 then raise exception 'ต้องเก็บข้อมูลอย่างน้อย 30 วัน'; end if;
  delete from public.quotes
   where status in ('request', 'draft', 'sent', 'cancelled')
     and updated_at < now() - make_interval(days => p_days);
  get diagnostics q_count = row_count;
  delete from public.customers c
   where c.updated_at < now() - make_interval(days => p_days)
     and not exists (select 1 from public.quotes q where q.customer_id = c.id);
  get diagnostics c_count = row_count;
  return jsonb_build_object('quotes', q_count, 'customers', c_count);
end $$;
revoke all on function public.purge_old_data(int) from public;
grant execute on function public.purge_old_data(int) to authenticated;

-- =====================================================================
-- ลิงก์ยืนยันการจอง: ลูกค้าเปิด confirm.html?t=<token> (ไม่ต้องล็อกอิน)
--   เห็นเฉพาะข้อมูลของใบนั้น · เบอร์โทรถูกปิดบางส่วน · หมดอายุเมื่อเลยเวลารับหรือเกิน 30 วัน
-- =====================================================================
create or replace function public.quote_link_expired(q public.quotes) returns boolean
language sql stable as $$
  select (q.pickup_at is not null and q.pickup_at < now())
      or q.updated_at < now() - interval '30 days'
      or q.status in ('done', 'cancelled', 'draft', 'request');
$$;

create or replace function public.get_quote_by_token(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q public.quotes;
begin
  if p_token is null or length(p_token) < 24 then return null; end if;
  select * into q from public.quotes where confirm_token = p_token;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', q.id,
    'status', q.status,
    'customer_name', q.customer_name,
    'customer_phone_masked', case when q.customer_phone is null then null
                                  else left(q.customer_phone, 3) || '-xxx-' || right(q.customer_phone, 4) end,
    'pickup_name', q.pickup->>'name',
    'dropoff_name', q.dropoff->>'name',
    'pickup', case when q.pickup ? 'lat' then jsonb_build_object('lat', q.pickup->'lat', 'lng', q.pickup->'lng') end,
    'dropoff', case when q.dropoff ? 'lat' then jsonb_build_object('lat', q.dropoff->'lat', 'lng', q.dropoff->'lng') end,
    'pickup_at', q.pickup_at,
    'distance_km', q.distance_km,
    'duration_min', q.duration_min,
    'options', q.options,
    'fare_quoted', q.fare_quoted,
    'note', q.note,
    'customer_response', q.customer_response,
    'responded_at', q.responded_at,
    'expired', public.quote_link_expired(q)
  );
end $$;
revoke all on function public.get_quote_by_token(text) from public;
grant execute on function public.get_quote_by_token(text) to anon, authenticated;

create or replace function public.respond_to_quote(p_token text, p_action text, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare q public.quotes;
begin
  if p_token is null or length(p_token) < 24 then raise exception 'ลิงก์ไม่ถูกต้อง'; end if;
  if p_action not in ('confirm', 'change') then raise exception 'คำสั่งไม่ถูกต้อง'; end if;
  select * into q from public.quotes where confirm_token = p_token for update;
  if not found then raise exception 'ลิงก์ไม่ถูกต้อง'; end if;
  if q.status = 'confirmed' and p_action = 'confirm' then
    return jsonb_build_object('id', q.id, 'already', true);
  end if;
  if public.quote_link_expired(q) and not (q.status = 'confirmed' and p_action = 'change') then
    raise exception 'ลิงก์หมดอายุแล้ว กรุณาติดต่อคนขับ';
  end if;
  if q.responded_at is not null and q.responded_at > now() - interval '1 minute' then
    raise exception 'เพิ่งส่งคำตอบไป กรุณารอสักครู่';
  end if;
  if p_action = 'confirm' then
    update public.quotes set status = 'confirmed', customer_response = 'confirmed', response_note = null,
           responded_at = now(), response_notified_at = null
     where id = q.id;
  else
    update public.quotes set customer_response = 'change_requested', response_note = left(coalesce(p_note, ''), 500),
           responded_at = now(), response_notified_at = null
     where id = q.id;
  end if;
  return jsonb_build_object('id', q.id, 'already', false);
end $$;
revoke all on function public.respond_to_quote(text, text, text) from public;
grant execute on function public.respond_to_quote(text, text, text) to anon, authenticated;
