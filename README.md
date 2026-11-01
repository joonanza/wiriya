# Wiriya: เว็บแอปคำนวณค่าเดินทางและรับจองตรง (Prototype)

รถที่ใช้: **Omoda C5 EV 2026** (ระบบรองรับรถน้ำมันด้วย เลือกได้ในหน้า Admin)

ลูกค้าใส่จุดรับ-ส่ง → ดูราคาประเมินพร้อมรายละเอียด → ส่งคำขอจองทาง LINE หรือโทรหาคนขับโดยตรง ไม่ผ่านแพลตฟอร์ม จึงไม่โดนหักค่าคอมมิชชัน

## เริ่มใช้งาน

```bash
npm start      # http://localhost:8080 (ไม่ต้องติดตั้ง dependency, Node ≥ 18)
npm test       # unit test ของ pricing engine และ cost model
```

ทำเป็นไฟล์ static ทั้งหมด จึงเปิดผ่าน static host ใดก็ได้ เช่น GitHub Pages, Netlify, Vercel

| หน้า | หน้าที่ |
|---|---|
| `index.html` | หน้าลูกค้า: ค้นหาสถานที่, คลิก/ลากหมุดบนแผนที่, GPS, เลือกรถ/เวลา/ไป-กลับ/สนามบิน/ค่ารอ/ทางด่วน → ราคาพร้อม breakdown → ส่งจองทาง LINE / คัดลอก / โทร |
| `admin.html` | 1) **ต้นทุนรถ** → ต้นทุน ฿/km และเรทแนะนำ 2) **ตั้งค่าราคา** ทั้งหมด 3) **ทดลองทริปและกำไร** |

## โครงสร้างโค้ด

```
js/pricing.js   pricing engine (pure function, test ได้ใน Node)
js/cost.js      cost model: ต้นทุน/km → เรทแนะนำ
js/config.js    ค่าเริ่มต้น + เก็บ/โหลดจาก localStorage
js/geo.js       Nominatim (ค้นหาสถานที่) + OSRM (เส้นทาง) + fallback ระยะเส้นตรง
js/app.js       หน้าลูกค้า (Leaflet map)
js/admin.js     หน้า Admin
docs/fare-structure.md   ที่มาของเรทราคาพร้อมตัวเลข
```

## สูตรราคา

$$
Fare = \Big\lceil \max\big(F_{min},\ (F_{base} + \textstyle\sum r_{d,i} d_i + r_t t)\cdot k_{veh}\cdot k_{time} + C_{return} + C_{wait} + C_{airport} [+ C_{charge}]\big) \Big\rceil_{10฿} + C_{toll}
$$

EV: ถ้าทริปยาวเกินระยะวิ่งต่อชาร์จ (ค่าเริ่มต้น 280 km) ระบบจะแจ้งจำนวนครั้งที่ต้องแวะชาร์จ โดยค่าเริ่มต้นไม่คิดเงินเวลาชาร์จ เปิดให้คิดได้ในหน้า Admin

รายละเอียดและตัวเลขดูที่ [docs/fare-structure.md](docs/fare-structure.md)

## ข้อจำกัดของ Prototype (ต้องแก้ก่อนใช้จริง)

- **เรทราคาเก็บใน localStorage** ของเบราว์เซอร์ที่ตั้งค่าเท่านั้น ลูกค้าบนเครื่องอื่นจะเห็นค่าเริ่มต้น
  → ต้องย้าย config และการคำนวณราคาไปไว้ที่ backend (เช่น Supabase + Edge Function) เพื่อไม่ให้ client แก้ราคาได้
- **หน้า Admin ไม่มีรหัสผ่าน**
- **Nominatim / OSRM สาธารณะ** จำกัดการใช้งาน (~1 req/s) และ OSRM ไม่มีข้อมูลจราจร (ใช้ `trafficFactor` เผื่อแทน)
  → ใช้งานจริงควรเปลี่ยนเป็น Google Routes API หรือ Longdo Map แค่แก้ไฟล์ `js/geo.js` ไฟล์เดียว
- ถ้าเชื่อมต่อ OSRM ไม่ได้ ระบบจะประมาณระยะทางจากเส้นตรง × 1.35 (ความเร็ว 25/40/70 km/h ตามระยะ) และแสดงคำเตือน

## Roadmap

1. ~~หน้าคำนวณราคา + ส่งจองทาง LINE~~ ✅
2. Backend: เก็บ booking, ลูกค้า และ fare config, พร้อม Admin login
3. PromptPay QR (dynamic) + แจ้งเตือนผ่าน LINE Messaging API + LIFF
4. ปฏิทินงานล่วงหน้า, รายงานรายได้/ต้นทุน, ประวัติลูกค้า

> ⚠️ ก่อนรับงานจริง ให้ตรวจสอบเรื่องทะเบียนรถรับจ้าง ใบขับขี่สาธารณะ ประกันภัยเชิงพาณิชย์ และ PDPA
