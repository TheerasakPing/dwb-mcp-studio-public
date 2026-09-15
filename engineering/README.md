# Core engineering notes

- [เปรียบเทียบต้นแบบกับ Public Core beta.12](core-audit/2026-09-15/COMPARISON-TH.md)

เอกสารและหลักฐานสำหรับพัฒนา core อยู่ใน Git โดยโฟลเดอร์นี้ไม่อยู่ใน allowlist ของ ZIP release

ตัวจำลองต้องใช้ source ของ `dwb-desktop-bridge` อยู่ข้างโครงการนี้ รันจากราก `dwb-mcp-studio-public`:

```powershell
node --import tsx engineering/core-audit/2026-09-15/probes.mjs
```

ผลรันใหม่จะอยู่ใน `logs/core-audit-2026-09-15` ซึ่ง Git ไม่ติดตาม ตัวจำลองใช้โฟลเดอร์และฐานข้อมูลทดสอบแยก ไม่เปิด hosted tunnel
