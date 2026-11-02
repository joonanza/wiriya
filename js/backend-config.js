// ===== ตั้งค่าการเชื่อมต่อฐานข้อมูล Supabase =====
// เว้นว่างไว้ = โหมดเก็บข้อมูลในเครื่อง (localStorage) ใช้ได้ทันทีแต่ข้อมูลอยู่แค่ในเบราว์เซอร์นั้น
//
// วิธีเชื่อม Supabase (ดู docs/backend-setup.md):
//   1. สร้างโปรเจกต์ที่ supabase.com → รันไฟล์ supabase/schema.sql ใน SQL Editor
//   2. Project Settings → API → คัดลอก "Project URL" และ "anon public key" มาใส่ด้านล่าง
//   3. Authentication → Users → Add user (อีเมล + รหัสผ่านของคนขับ) และปิด "Allow new users to sign up"
//
// anon key เปิดเผยได้ (ออกแบบมาให้อยู่ฝั่งเว็บ) ความปลอดภัยมาจาก Row Level Security ใน schema.sql
// ห้ามใส่ service_role key ในไฟล์นี้เด็ดขาด

export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
