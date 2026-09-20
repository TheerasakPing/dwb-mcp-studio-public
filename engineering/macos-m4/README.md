# macOS M4 GitHub Project bootstrap

ไฟล์ในโฟลเดอร์นี้ใช้สร้างและซิงก์ GitHub Project สำหรับงานพอร์ต DWB MCP Studio ไป macOS Apple Silicon

## Source of truth

- `backlog.json` — backlog แบบ machine-readable จำนวน 27 งาน
- `../../docs/MACOS-M4-PROJECT-PLAN.md` — แผนงานฉบับอ่านโดยคน
- `../../scripts/bootstrap-macos-project.mjs` — ตัวสร้าง/ซิงก์ GitHub Project

## Project ที่จะสร้าง

ชื่อ:

`DWB MCP Studio — macOS M4 Port`

Fields:

- Work Status: Backlog / Ready / In progress / Review / Validation / Done
- Priority: P0 / P1 / P2 / P3
- Phase: 0–6
- Area: Core / Runtime / Installer / Tunnel / Security / UI / CI / Validation / Release / Docs
- Platform: Cross-platform / macOS / Windows
- Risk: Low / Medium / High
- Target: beta.15-macos

รายการงานถูกสร้างเป็น **Draft items** ใน GitHub Projects ก่อน จึงไม่ต้องพึ่ง Issues ของ repository และสามารถแปลงเป็น Issues ภายหลังได้

## ใช้งาน

ต้องมี GitHub CLI ที่ login ด้วย account เจ้าของ Project และมี Projects scope:

```bash
gh auth status
gh auth refresh -s project
npm run project:macos
```

ระบุ repository อื่นได้:

```bash
node scripts/bootstrap-macos-project.mjs --repo OWNER/REPO
```

สคริปต์เป็น idempotent:
- ใช้ Project เดิมเมื่อชื่อเดียวกันมีอยู่แล้ว
- สร้างเฉพาะ field ที่ยังไม่มี
- ไม่สร้าง item ซ้ำเมื่อพบ title ที่มี ID งานเดียวกัน
- ซิงก์ metadata fields กลับเป็นค่าจาก `backlog.json`

## Important

การ bootstrap Project ไม่แก้ source code ของ DWB และควรรันก่อนเริ่ม Phase 1
