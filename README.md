# Wiriya: เว็บแอปคำนวณค่าเดินทางและรับจองตรง (Prototype)

รถที่ใช้: **Omoda C5 EV 2026** (ระบบรองรับรถน้ำมันด้วย เลือกได้ในหน้า Admin)

ลูกค้าใส่จุดรับ-ส่ง → ดูราคาประเมินพร้อมรายละเอียด → ส่งคำขอจองทาง LINE หรือโทรหาคนขับโดยตรง ไม่ผ่านแพลตฟอร์ม จึงไม่โดนหักค่าคอมมิชชัน

## เริ่มใช้งาน

```bash
npm start      # http://localhost:8080 (ไม่ต้องติดตั้ง dependency, Node ≥ 18)
npm test       # unit test ของ pricing engine และ cost model
```

ทำเป็นไฟล์ static ทั้งหมด จึงเปิดผ่าน static host ใดก็ได้ เช่น GitHub Pages, Netlify, Vercel

### Deploy ด้วย GitHub Pages
มี workflow อยู่ที่ `.github/workflows/pages.yml` ระบบจะรันเทสต์แล้ว deploy ให้อัตโนมัติทุกครั้งที่ push
ตั้งค่าครั้งแรกครั้งเดียว: **Settings → Pages → Build and deployment → Source: GitHub Actions**
จากนั้นเปิดได้ที่ `https://joonanza.github.io/wiriya/`

| หน้า | ใคร | หน้าที่ |
|---|---|---|
| `index.html` | คนขับ | **หน้าแรก**: คำขอใหม่, รายได้วันนี้/เดือนนี้, งานที่จะถึง, รอลูกค้ายืนยัน, ลิงก์ให้ลูกค้าจอง, เปิดการแจ้งเตือน |
| `quote.html` | คนขับ | **เสนอราคา**: ค้นหาลูกค้าเก่า → เส้นทาง → ราคา + กำไร → ส่งทาง SMS / LINE / WhatsApp / คัดลอก (ข้อความมีลิงก์ Google Maps) |
| `history.html` | คนขับ | **ประวัติ**: คำขอจากลูกค้าและใบเสนอราคา, เปลี่ยนสถานะ, กรองตามลูกค้า |
| `customers.html` | คนขับ | **ฐานข้อมูลลูกค้า** |
| `dashboard.html` | คนขับ | **แดชบอร์ด**: รายได้, เที่ยว, ระยะทางสะสม, ฿/km, ต้นทุนประมาณ (ไฟ/บำรุง/ค่าเสื่อม/ประกัน), กราฟรายเดือน, **บันทึกค่าใช้จ่ายจริง** |
| `admin.html` | คนขับ | ต้นทุนรถ, เรทราคา, เปิด/ปิดการแสดงราคาในหน้าลูกค้า |
| `customer.html` | ลูกค้า | เลือกเส้นทาง → **ส่งคำขอจองเข้าแอปคนขับ** (เด้งแจ้งเตือน + บันทึกประวัติ), จดจำข้อมูลลูกค้า, ไม่แสดงราคา (ตั้งค่าได้) |

### ฐานข้อมูล
- ยังไม่ได้ตั้งค่า → **โหมดเก็บข้อมูลในเครื่อง** (localStorage) ใช้ได้ทันที แต่ข้อมูลอยู่แค่ในเบราว์เซอร์นั้น
- ใส่ key ใน `js/backend-config.js` → **Supabase** (PostgreSQL + ล็อกอินคนขับ + Row Level Security)
- วิธีตั้งค่า: [docs/backend-setup.md](docs/backend-setup.md) · schema: [supabase/schema.sql](supabase/schema.sql)

## โครงสร้างโค้ด

```
js/store.js        data layer: API เดียวกันทั้งโหมด localStorage และ Supabase
js/auth.js         ตรวจล็อกอินหน้าคนขับ + แถบสถานะ + ป้ายจำนวนคำขอใหม่
js/trip.js         แผนที่ + ค้นหาสถานที่ + ตัวเลือก + คำนวณราคา (ใช้ร่วมหน้าคนขับ/ลูกค้า)
js/home.js         หน้าแรก
js/driver.js       หน้าเสนอราคา (quote.html)
js/dashboard.js    แดชบอร์ด + ค่าใช้จ่าย
js/stats.js        คำนวณสถิติ (pure function)
js/history.js      หน้าประวัติ
js/customers.js    หน้าลูกค้า
js/customer.js     หน้าลูกค้า (ฝั่งลูกค้า)
js/admin.js        หน้าตั้งค่า
js/pricing.js      pricing engine (pure function)
js/cost.js         cost model: ต้นทุน/km → เรทแนะนำ
js/config.js       ค่าเริ่มต้นเรทราคา
js/geo.js          Nominatim + OSRM + fallback
js/ui.js           helper: เบอร์โทร, ลิงก์ SMS/WhatsApp/LINE, สถานะ ฯลฯ
supabase/schema.sql
```

## สูตรราคา

$$
Fare = \Big\lceil \max\big(F_{min},\ (F_{base} + \textstyle\sum r_{d,i} d_i + r_t t)\cdot k_{veh}\cdot k_{time} + C_{return} + C_{wait} + C_{airport} [+ C_{charge}]\big) \Big\rceil_{10฿} + C_{toll}
$$

EV: ถ้าทริปยาวเกินระยะวิ่งต่อชาร์จ (ค่าเริ่มต้น 280 km) ระบบจะแจ้งจำนวนครั้งที่ต้องแวะชาร์จ โดยค่าเริ่มต้นไม่คิดเงินเวลาชาร์จ เปิดให้คิดได้ในหน้า Admin

รายละเอียดและตัวเลขดูที่ [docs/fare-structure.md](docs/fare-structure.md)

## ข้อจำกัดของ Prototype (ต้องแก้ก่อนใช้จริง)

- ยังไม่ได้เชื่อม Supabase: ข้อมูลและเรทราคาอยู่ในเครื่องที่ใช้เท่านั้น และหน้าคนขับไม่มีรหัสผ่าน
- ราคาที่แสดงในหน้าลูกค้าคำนวณฝั่งเบราว์เซอร์ จึงเป็นแค่ "ราคาประเมิน" คนขับเป็นคนยืนยันราคาจริงเสมอ
- **Nominatim / OSRM สาธารณะ** จำกัดการใช้งาน (~1 req/s) และ OSRM ไม่มีข้อมูลจราจร (ใช้ `trafficFactor` เผื่อแทน)
  → ใช้งานจริงควรเปลี่ยนเป็น Google Routes API หรือ Longdo Map แค่แก้ไฟล์ `js/geo.js` ไฟล์เดียว
- ถ้าเชื่อมต่อ OSRM ไม่ได้ ระบบจะประมาณระยะทางจากเส้นตรง × 1.35 (ความเร็ว 25/40/70 km/h ตามระยะ) และแสดงคำเตือน

## Roadmap

1. ~~หน้าคำนวณราคา + ส่งจองทาง LINE~~ ✅
2. ~~โหมดคนขับเสนอราคา + ฐานข้อมูลลูกค้า/ประวัติ + Supabase backend~~ ✅ (รอสร้างโปรเจกต์ Supabase)
3. PromptPay QR (dynamic) + แจ้งเตือนผ่าน LINE Messaging API + LIFF
4. ปฏิทินงานล่วงหน้า, รายงานรายได้/ต้นทุน, ประวัติลูกค้า

> ⚠️ ก่อนรับงานจริง ให้ตรวจสอบเรื่องทะเบียนรถรับจ้าง ใบขับขี่สาธารณะ ประกันภัยเชิงพาณิชย์ และ PDPA
