# แจ้งเตือนคำขอจองผ่าน LINE OA

```
ลูกค้ากด "ส่งคำขอจอง" (customer.html)
  → บันทึกคำขอใน Supabase (ฟังก์ชัน submit_booking_request)
  → เว็บเรียก Edge Function "notify-line"
  → function ตรวจว่าเป็นคำขอใหม่จริง ยังไม่เคยแจ้ง และส่งมาไม่เกิน 15 นาที
  → LINE Messaging API ส่งการ์ดเข้า LINE ของคนขับ
     🔔 คำขอจองใหม่ · ชื่อ · เบอร์ · จุดรับ-ส่ง · เวลา   [เสนอราคา] [นำทาง] [โทร]
```

- เด้งใน LINE **แม้ไม่ได้เปิดเว็บแอป**
- กดปุ่ม "เสนอราคา" ในการ์ด แล้วเปิดหน้าเสนอราคาของคำขอนั้นได้ทันที
- ถ้าส่ง LINE ไม่สำเร็จ คำขอยังอยู่ในระบบ (เห็นในหน้าประวัติ และมีป๊อปอัปในแอปเป็นช่องทางสำรอง)
- **ต้องตั้งค่า Supabase ก่อน** (ดู [backend-setup.md](backend-setup.md))

## ค่าใช้จ่าย
- LINE OA แพ็กเกจฟรี: ส่งได้ประมาณ **300 ข้อความ/เดือน** (บางแหล่งระบุ 200 เช็กหน้าราคาทางการของ LINE ประเทศไทยอีกครั้ง)
  - 1 คำขอจอง = 1 ข้อความ
  - เกินโควตาแล้วระบบจะส่งไม่ได้จนถึงเดือนถัดไป (แพ็กเกจฟรีซื้อข้อความเพิ่มไม่ได้) แต่คำขอยังเข้าแอปตามปกติ
- Supabase Edge Functions แพ็กเกจฟรี: 500,000 ครั้ง/เดือน

> LINE Notify ปิดบริการแล้วตั้งแต่ 31 มี.ค. 2025 จึงต้องใช้ LINE OA + Messaging API แทน

---

## ขั้นที่ 1: สร้าง LINE Official Account
1. ไปที่ https://manager.line.biz → เข้าสู่ระบบด้วย LINE → **สร้างบัญชี LINE OA**
2. ตั้งชื่อ เช่น "วิริยะ รถรับส่ง" แล้วเลือกหมวดหมู่ธุรกิจ

## ขั้นที่ 2: เปิด Messaging API
1. ใน LINE OA Manager → **ตั้งค่า (Settings)** → **Messaging API** → **เปิดใช้ Messaging API**
2. เลือกหรือสร้าง **Provider** (ใช้ชื่อตัวเองได้) แล้วกดยืนยัน
3. ระบบจะสร้าง **Channel** ใน LINE Developers ให้

## ขั้นที่ 3: เอาค่าจาก LINE Developers
ไปที่ https://developers.line.biz/console → เลือก Provider → เลือก Channel ของ OA

| ค่า | อยู่ที่ไหน | ใช้ทำอะไร |
|---|---|---|
| **Your user ID** (ขึ้นต้นด้วย `U` ยาว 33 ตัว) | แท็บ **Basic settings** ล่างสุด | ID ของคุณที่ใช้รับแจ้งเตือน |
| **Channel access token (long-lived)** | แท็บ **Messaging API** ล่างสุด → กด **Issue** | กุญแจให้ระบบส่งข้อความ ⚠️ **ความลับ** |

⚠️ **ห้ามส่ง Channel access token ในแชท ห้ามใส่ในโค้ด และห้ามใส่ในหน้าเว็บ** ให้ใส่ใน Supabase Secrets เท่านั้น (ขั้นที่ 5)

## ขั้นที่ 4: แอด OA เป็นเพื่อน
ในแท็บ Messaging API มี QR code ให้ใช้ **LINE ของคุณ (คนขับ) สแกนแล้วแอดเพื่อน**
ถ้าไม่แอดเพื่อน LINE จะไม่ส่งข้อความหาคุณ

ถ้าไม่อยากให้ OA ตอบกลับอัตโนมัติ: LINE OA Manager → ตั้งค่าการตอบกลับ → ปิด "ข้อความตอบกลับอัตโนมัติ"

## ขั้นที่ 5: ตั้ง Secrets ใน Supabase
Supabase Dashboard → **Edge Functions** → **Secrets** (หรือ Project Settings → Edge Functions) → เพิ่ม:

| Name | Value |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | token จากขั้นที่ 3 |
| `LINE_DRIVER_USER_ID` | User ID จากขั้นที่ 3 (ถ้ามีคนขับหลายคน คั่นด้วย `,`) |
| `APP_URL` | `https://joonanza.github.io/wiriya/` |
| `ALLOWED_ORIGIN` | `https://joonanza.github.io` (ไม่บังคับ แต่แนะนำ) |

## ขั้นที่ 6: Deploy Edge Function

### วิธี A: ผ่าน Dashboard (ไม่ต้องติดตั้งอะไร)
1. Supabase Dashboard → **Edge Functions** → **Deploy a new function** → **Via Editor**
2. ตั้งชื่อ function: `notify-line`
3. ลบโค้ดตัวอย่าง แล้ว**วางเนื้อหาทั้งไฟล์ `supabase/functions/notify-line/dashboard-paste.ts`** (เปิดได้จาก GitHub ของโปรเจกต์)
4. กด **Deploy**
5. หลัง deploy เสร็จ เข้าไปที่ function → **Details / Settings** → **ปิด "Enforce JWT verification" (Verify JWT)**
   - ต้องปิด เพราะหน้าลูกค้าไม่ได้ล็อกอิน (function ตรวจสิทธิ์และกันสแปมเองอยู่แล้ว)

### วิธี B: ผ่าน Supabase CLI
```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase functions deploy notify-line --no-verify-jwt
```

## ขั้นที่ 7: ทดสอบ
1. เปิดแอป → **ตั้งค่า** → กด **"ส่งข้อความทดสอบเข้า LINE"** แล้วควรได้ข้อความ ✅ ใน LINE
2. เปิด `customer.html` จากมือถืออีกเครื่อง → เลือกเส้นทาง → ใส่ชื่อและเบอร์ → **ส่งคำขอจอง** แล้วควรได้การ์ดคำขอใหม่ใน LINE

### ถ้าไม่ได้รับข้อความ
| อาการ | สาเหตุที่พบบ่อย |
|---|---|
| ปุ่มทดสอบขึ้น `LINE API 401` | token ผิดหรือหมดอายุ → Issue ใหม่แล้วอัปเดต Secret |
| ขึ้น `LINE API 400` / ไม่มีข้อความ | User ID ผิด หรือยังไม่ได้แอด OA เป็นเพื่อน |
| ขึ้น `LINE API 429` | ใช้โควตาข้อความเดือนนี้หมดแล้ว |
| ขึ้น `ยังไม่ได้ตั้งค่า LINE_...` | ยังไม่ได้ใส่ Secrets หรือพิมพ์ชื่อผิด |
| ขึ้น `401` / ไม่มีอะไรเกิดขึ้นตอนลูกค้าส่ง | ยังไม่ได้ปิด Verify JWT (ขั้นที่ 6 ข้อ 5) |
| ขึ้น `Failed to send a request` | ยังไม่ได้ deploy function หรือตั้งชื่อไม่ตรง `notify-line` |

ดู log ได้ที่ Supabase Dashboard → Edge Functions → notify-line → **Logs**

## กันโควตา LINE หมด
- function ส่งแจ้งเตือนไม่เกิน **10 ครั้ง/ชั่วโมง** (ปรับได้ด้วย Secret `LINE_MAX_PER_HOUR`) คำขอที่เกินยังเข้าแอปตามปกติ แค่ไม่ส่ง LINE
- ถ้าแก้ไฟล์ใน `supabase/functions/notify-line/` ต้อง deploy ใหม่ (วาง `dashboard-paste.ts` ใหม่ทั้งไฟล์)

## ความปลอดภัย
- Channel access token อยู่ใน Supabase Secrets เท่านั้น ไม่อยู่ในโค้ดหรือหน้าเว็บ
- function ส่ง LINE เฉพาะคำขอที่มีสถานะ "คำขอใหม่" ยังไม่เคยแจ้ง และสร้างภายใน 15 นาที
  คนนอกเรียกซ้ำหรือยิง id มั่ว ๆ ก็ไม่ทำให้ส่งข้อความเพิ่ม
- ปุ่มทดสอบใช้ได้เฉพาะคนขับที่ล็อกอินแล้ว
- การสร้างคำขอถูกจำกัดที่ 30 ครั้ง / 10 นาที (ใน `submit_booking_request`)
