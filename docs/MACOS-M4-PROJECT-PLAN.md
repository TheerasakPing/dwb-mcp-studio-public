# DWB MCP Studio — macOS Apple Silicon Project Plan

> Target: Native macOS Apple Silicon (M1–M4+) release while preserving Windows beta.14 behavior and architecture.

## Project goal

สร้าง DWB MCP Studio เวอร์ชัน macOS แบบ native arm64 โดยรักษา Core broker, multi-worker, session recovery, workspace binding, payload guard, Desktop Commander isolation และ OpenAI tunnel workflow เดิมให้มากที่สุด พร้อมแทนที่ Windows-specific platform layer ด้วย macOS-native implementation

## Target release

- Product: DWB MCP Studio
- Track: macOS Apple Silicon
- Architecture: arm64
- Initial target: macOS M1 / M2 / M3 / M4+
- Rosetta: ไม่ควรต้องใช้
- Proposed version: `0.1.0-beta.15-macos`
- Upstream Desktop Commander: `0.2.50`
- OpenAI tunnel-client: `0.0.11`
- Tunnel asset: `tunnel-client-v0.0.11-darwin-arm64.zip`
- Tunnel SHA-256: `3685443b057614ff932d2d477dab94be2082e60bcf4e8b4e378bebc89121b714`

## Suggested GitHub Project fields

| Field | Values |
| --- | --- |
| Status | Backlog / Ready / In progress / Review / Validation / Done |
| Priority | P0 / P1 / P2 / P3 |
| Platform | Cross-platform / macOS / Windows |
| Area | Core / Runtime / Installer / Tunnel / UI / Security / CI / Release / Docs |
| Phase | 0–6 |
| Risk | Low / Medium / High |
| Target | beta.15-macos |

---

# Phase 0 — Baseline and architecture freeze

## MAC-001 — Freeze Windows beta.14 behavior as compatibility baseline
**Priority:** P0  
**Area:** Core / Validation

### Tasks
- [ ] บันทึก public tool surface ปัจจุบัน
- [ ] บันทึก broker/session/workspace behavior ที่ต้องห้าม regression
- [ ] บันทึก config schema และ runtime data layout
- [ ] บันทึก managed dependency versions
- [ ] บันทึก release/upgrade behavior
- [ ] สร้าง compatibility checklist สำหรับ Windows

### Definition of Done
- มี baseline document ที่ใช้เทียบ Windows/macOS ได้
- ทุกงาน macOS อ้างอิง behavior baseline เดียวกัน

---

# Phase 1 — Cross-platform Core

## MAC-101 — Remove Windows-only package/runtime guards
**Priority:** P0  
**Area:** Core

### Tasks
- [ ] ปรับ `package.json` ที่จำกัด `os: ["win32"]`
- [ ] ปรับ `scripts/doctor.mjs` ไม่ให้ reject macOS
- [ ] เปลี่ยนข้อความ error ที่ hard-code `.exe`
- [ ] เพิ่ม platform helper กลาง
- [ ] รักษา Windows behavior เดิม

### Acceptance
- [ ] `npm run typecheck` ผ่าน Windows/macOS
- [ ] `npm run build` ผ่าน Windows/macOS

## MAC-102 — Validate broker Unix socket lifecycle
**Priority:** P0  
**Area:** Core / Runtime

### Tasks
- [ ] ทดสอบ `brokerEndpoint()` บน darwin
- [ ] ทดสอบ stale socket cleanup
- [ ] ทดสอบ duplicate broker startup
- [ ] ทดสอบ broker reconnect
- [ ] ทดสอบ crash recovery
- [ ] ทดสอบ permissions ของ socket

### Acceptance
- [ ] broker เปิดผ่าน Unix domain socket ได้
- [ ] reconnect/recovery ไม่ต้องใช้ Windows Named Pipe

## MAC-103 — Audit filesystem/path semantics on macOS
**Priority:** P1  
**Area:** Core

### Tasks
- [ ] ตรวจ `toLowerCase()` path comparisons
- [ ] ตรวจ case-sensitive vs case-insensitive volumes
- [ ] ตรวจ symlink handling
- [ ] ตรวจ Unicode normalization
- [ ] ตรวจ path ที่มี space, ampersand และภาษาไทย
- [ ] ตรวจ removable/external volume paths

### Acceptance
- [ ] workspace boundary ไม่หลุดเพราะ path semantics
- [ ] stale-write protection ยังถูกต้อง

---

# Phase 2 — macOS configuration and managed dependencies

## MAC-201 — macOS data directory and default shell
**Priority:** P0  
**Area:** Runtime

### Tasks
- [ ] macOS data root = `~/Library/Application Support/DWB-MCP-Studio`
- [ ] Windows data root คงเดิม
- [ ] Linux fallback แยกชัดเจน
- [ ] macOS default shell = `/bin/zsh`
- [ ] migration config ที่มี `powershell.exe`
- [ ] regenerate `mcp-client.json` ด้วย POSIX paths

### Acceptance
- [ ] configure/doctor ใช้ path แบบ macOS ถูกต้อง
- [ ] workspace Unicode + space ใช้งานได้

## MAC-202 — Cross-platform external dependency installer
**Priority:** P0  
**Area:** Installer

### Tasks
- [ ] ย้าย installer logic ที่สำคัญออกจาก PowerShell
- [ ] สร้าง Node-based download/install primitives
- [ ] staging directory
- [ ] atomic promote
- [ ] rollback เมื่อ fail
- [ ] SHA-256 verification
- [ ] archive traversal protection
- [ ] symlink/path escape protection
- [ ] dependency reuse ตอน upgrade

### Acceptance
- [ ] installer logic เดียวรองรับ Windows/macOS เท่าที่เป็นไปได้

## MAC-203 — Desktop Commander 0.2.50 on Apple Silicon
**Priority:** P0  
**Area:** Installer / Worker

### Tasks
- [ ] npm install pinned `@wonderwhy-er/desktop-commander@0.2.50`
- [ ] validate `dist/index.js`
- [ ] validate `dist/config.js`
- [ ] ตรวจ `sharp` arm64
- [ ] ตรวจ `@vscode/ripgrep` arm64
- [ ] ตรวจ PDF/document native dependencies
- [ ] ทดสอบ worker bootstrap loader isolation
- [ ] ทดสอบ multi-worker config homes

### Acceptance
- [ ] worker ทำงาน native arm64
- [ ] upstream install ไม่ถูก patch บน disk
- [ ] multi-worker isolation ผ่าน

## MAC-204 — OpenAI tunnel-client darwin-arm64 installer
**Priority:** P0  
**Area:** Tunnel / Installer

### Tasks
- [ ] เลือก asset `darwin-arm64`
- [ ] pin SHA-256
- [ ] download จาก upstream release
- [ ] verify checksum
- [ ] safe extract
- [ ] chmod executable
- [ ] `--version` verification
- [ ] managed-path enforcement
- [ ] staging/rollback

### Acceptance
- [ ] tunnel-client 0.0.11 ทำงาน native arm64
- [ ] checksum mismatch ถูก reject

---

# Phase 3 — macOS runtime and security

## MAC-301 — Tunnel lifecycle on POSIX
**Priority:** P0  
**Area:** Tunnel / Runtime

### Tasks
- [ ] แทน `taskkill.exe` ด้วย POSIX process lifecycle
- [ ] process group ownership
- [ ] PID + executable identity verification
- [ ] graceful stop ก่อน force terminate
- [ ] health endpoint probe
- [ ] orphan process detection
- [ ] restart behavior
- [ ] log path management

### Acceptance
- [ ] Start/Stop ไม่ฆ่า process อื่น
- [ ] child adapter tree ถูกจัดการถูกต้อง

## MAC-302 — macOS Keychain integration
**Priority:** P0  
**Area:** Security

### Tasks
- [ ] แทน Windows DPAPI ด้วย Keychain
- [ ] service/account naming
- [ ] save/read/delete API key
- [ ] ไม่เขียน plaintext key ลง disk
- [ ] ไม่ใส่ key ใน argv
- [ ] inject key เฉพาะ tunnel environment
- [ ] ตรวจ `tunnel-mcp.mjs` ลบ runtime key ก่อนโหลด core
- [ ] redact logs/errors

### Acceptance
- [ ] plaintext key ไม่ปรากฏใน config/profile/log
- [ ] Remember/Forget key ทำงานครบ

## MAC-303 — macOS startup/login lifecycle
**Priority:** P1  
**Area:** Runtime / UI

### Tasks
- [ ] Login Item
- [ ] Start MCP automatically
- [ ] launch hidden/menu bar
- [ ] close behavior
- [ ] prevent duplicate UI instance
- [ ] wake/restore existing app
- [ ] preserve running MCP when UI closes ตาม setting

### Acceptance
- [ ] behavior เทียบเท่า Windows preferences ที่เกี่ยวข้อง

---

# Phase 4 — Native macOS application

## MAC-401 — SwiftUI/AppKit application shell
**Priority:** P0  
**Area:** UI

### Tasks
- [ ] สร้าง Xcode project
- [ ] app bundle identifier
- [ ] app icon assets
- [ ] navigation architecture
- [ ] shared app state
- [ ] process bridge ระหว่าง Swift app กับ Node runtime
- [ ] error presentation
- [ ] Thai/English text architecture

### Acceptance
- [ ] เปิด `DWB MCP Studio.app` แบบ native arm64 ได้
- [ ] ไม่ต้องใช้ Electron/Rosetta

## MAC-402 — Machine Setup screen
**Priority:** P0  
**Area:** UI / Installer

### Tasks
- [ ] Node version detection
- [ ] npm detection
- [ ] workspace folder picker
- [ ] worker-cap selector
- [ ] install/update action
- [ ] phase/progress display
- [ ] cancellation behavior
- [ ] diagnostics
- [ ] success/failure state

### Acceptance
- [ ] clean setup ทำครบจาก GUI

## MAC-403 — Tunnel Settings screen
**Priority:** P0  
**Area:** UI / Tunnel

### Tasks
- [ ] Tunnel ID input
- [ ] API key secure input
- [ ] Remember key
- [ ] Start MCP
- [ ] Stop MCP
- [ ] health/readiness state
- [ ] validation/error states

### Acceptance
- [ ] user เริ่ม tunnel ได้โดยไม่ใช้ Terminal

## MAC-404 — Dashboard
**Priority:** P1  
**Area:** UI

### Tasks
- [ ] Tunnel state
- [ ] Broker state
- [ ] active/max workers
- [ ] queue count
- [ ] sessions list
- [ ] workspace
- [ ] worker PID
- [ ] session status
- [ ] recent events/logs
- [ ] redaction
- [ ] 3-second non-invasive refresh

### Acceptance
- [ ] dashboard polling ไม่ attach session/allocate worker

## MAC-405 — Menu Bar and Preferences
**Priority:** P1  
**Area:** UI

### Tasks
- [ ] Menu Bar icon
- [ ] Open Dashboard
- [ ] Hide
- [ ] Start/Stop MCP
- [ ] Quit UI only
- [ ] Quit app + stop MCP
- [ ] close/minimize preferences
- [ ] login-item preference
- [ ] auto-connect preference

### Acceptance
- [ ] lifecycle behavior สอดคล้องกับ settings

---

# Phase 5 — Tests and CI

## MAC-501 — Cross-platform unit/regression test matrix
**Priority:** P0  
**Area:** CI

### Tasks
- [ ] core tests บน Windows
- [ ] core tests บน macOS
- [ ] path semantics tests
- [ ] Unix socket tests
- [ ] config migration tests
- [ ] worker lifecycle tests
- [ ] workspace tests
- [ ] payload guard tests
- [ ] runtime upgrade tests

### Acceptance
- [ ] Windows regressions = 0
- [ ] macOS core suite ผ่านทั้งหมด

## MAC-502 — Real Desktop Commander integration on macOS
**Priority:** P0  
**Area:** CI / Validation

### Tasks
- [ ] real upstream DC install
- [ ] two sessions / two workers
- [ ] separate workspaces
- [ ] file boundary
- [ ] command CWD
- [ ] crash recovery
- [ ] idle reclaim
- [ ] queue at capacity
- [ ] resume detached session
- [ ] worker source hash unchanged

### Acceptance
- [ ] parity กับ Windows integration suite

## MAC-503 — Tunnel integration validation
**Priority:** P0  
**Area:** CI / Tunnel

### Tasks
- [ ] binary/version test
- [ ] profile generation
- [ ] environment isolation
- [ ] readiness endpoint
- [ ] start/stop
- [ ] invalid credential handling
- [ ] local proxy/end-to-end test where available

### Acceptance
- [ ] DWB adapter ถูก tunnel เปิดและเรียก MCP tools ได้

## MAC-504 — macOS GitHub Actions workflow
**Priority:** P1  
**Area:** CI

### Tasks
- [ ] เพิ่ม macOS runner job
- [ ] Node 22.16 minimum test
- [ ] current supported Node test
- [ ] install real Desktop Commander
- [ ] arm64 assumptions validation
- [ ] package artifact
- [ ] upload test reports/artifacts

### Acceptance
- [ ] PR ทุกอันตรวจ Windows + macOS ก่อน merge

---

# Phase 6 — Packaging, signing and release

## MAC-601 — Build native arm64 .app
**Priority:** P0  
**Area:** Release

### Tasks
- [ ] Release configuration
- [ ] bundle Node/runtime strategy
- [ ] bundle ownership rules
- [ ] keep third-party binaries outside release where required
- [ ] app metadata/version
- [ ] arm64 validation using `file`/Mach-O inspection
- [ ] release allowlist

### Acceptance
- [ ] ได้ signed-ready `.app`

## MAC-602 — Code signing and Hardened Runtime
**Priority:** P0  
**Area:** Release / Security

### Tasks
- [ ] Developer ID Application signing
- [ ] entitlements review
- [ ] Hardened Runtime
- [ ] nested executable signing
- [ ] verify signature
- [ ] Gatekeeper validation

### Acceptance
- [ ] `codesign --verify` ผ่าน

## MAC-603 — Apple notarization and stapling
**Priority:** P0  
**Area:** Release

### Tasks
- [ ] notarization workflow
- [ ] wait/status handling
- [ ] staple ticket
- [ ] verify notarization
- [ ] failure diagnostics

### Acceptance
- [ ] Gatekeeper เปิด package บน clean Mac โดยไม่ต้อง bypass security

## MAC-604 — DMG/ZIP release artifact
**Priority:** P1  
**Area:** Release

### Tasks
- [ ] create DMG
- [ ] create ZIP
- [ ] SHA-256 files
- [ ] GitHub Release naming
- [ ] release notes
- [ ] explicit allowlist
- [ ] ensure no API keys/logs/runtime/node_modules leak

### Acceptance
- [ ] downloadable release พร้อม checksum

## MAC-605 — Clean-machine acceptance on Apple Silicon
**Priority:** P0  
**Area:** Validation

### Tasks
- [ ] fresh macOS user/profile
- [ ] clean install
- [ ] setup
- [ ] Keychain
- [ ] tunnel
- [ ] broker
- [ ] multi-worker
- [ ] workspace
- [ ] restart
- [ ] upgrade
- [ ] uninstall/cleanup
- [ ] M4 physical hardware test

### Acceptance
- [ ] end-to-end ผ่านบน M4 โดยไม่ใช้ Rosetta

---

# Documentation and migration

## MAC-701 — macOS user documentation
**Priority:** P1  
**Area:** Docs

- [ ] Installation
- [ ] First run
- [ ] Workspace
- [ ] Tunnel connection
- [ ] Keychain
- [ ] Login Item
- [ ] Dashboard
- [ ] Update
- [ ] Removal
- [ ] Troubleshooting
- [ ] Security boundaries

## MAC-702 — Windows/macOS shared documentation cleanup
**Priority:** P2  
**Area:** Docs

- [ ] แยกข้อความ platform-specific
- [ ] เปลี่ยนคำอ้างอิง `.exe` ที่ไม่ควรเป็น global
- [ ] update README compatibility table
- [ ] update THIRD-PARTY
- [ ] update VALIDATION
- [ ] update PUBLISHING

---

# Release gate

ห้ามประกาศ macOS beta พร้อมใช้งานจนกว่าจะผ่านทุกข้อด้านล่าง

- [ ] Core tests Windows ผ่าน
- [ ] Core tests macOS ผ่าน
- [ ] Desktop Commander real integration ผ่าน
- [ ] Tunnel native arm64 ผ่าน
- [ ] Keychain ไม่มี plaintext leak
- [ ] Multi-worker/session/workspace parity ผ่าน
- [ ] App native arm64
- [ ] Code signed
- [ ] Notarized
- [ ] Stapled
- [ ] Clean-machine acceptance ผ่าน
- [ ] M4 physical hardware validation ผ่าน
- [ ] Documentation พร้อม
- [ ] Release checksum พร้อม

# Recommended execution order

`MAC-001 → MAC-101/102/103 → MAC-201/202 → MAC-203/204 → MAC-301/302 → MAC-401/402/403 → MAC-404/405 → MAC-501/502/503/504 → MAC-601/602/603/604 → MAC-605 → MAC-701/702`

# Scope rule

ระหว่างพอร์ต macOS ต้องรักษา Windows behavior เดิมเป็นหลัก หากจำเป็นต้องเปลี่ยน Core ให้แยก platform abstraction ก่อน หลีกเลี่ยงการ fork Core เป็น Windows Core / macOS Core สองชุด เพื่อไม่ให้เกิด divergence ระยะยาว
