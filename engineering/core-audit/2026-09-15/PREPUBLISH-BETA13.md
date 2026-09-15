# ปิดรายการก่อนเผยแพร่ — beta.13

ขอบเขต: แก้ core และขั้นตอนใช้งานเดิม ไม่เพิ่ม MCP provider, Work, Skills หรือการเก็บบทสนทนา โปรแกรมต้นแบบส่วนตัวไม่ได้ถูกแก้ไข

## รายการที่ตกลงทำ

| ข้อ                               | ผลที่แก้                                                                                                                                      | หลักฐานทดสอบ                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1. ตัวตนไฟล์ / workspace boundary | ล็อกและ observation ใช้ path จริงกับตัวพิมพ์ Windows แบบเดียวกัน, resolve junction และ parent ของไฟล์ใหม่, ตรวจซ้ำหลังรอล็อก                  | core-hardening + public-core + Desktop Commander จริง |
| 2. Restart worker                 | ปฏิเสธเมื่อมีคำขอ, process หรือ search ทำงาน; ตรวจไม่ได้ถือว่ายังยุ่ง                                                                         | core-hardening + session-lifecycle                    |
| 3. Timeout / cancellation         | ส่ง deadline และ MCP cancellation ถึง broker, ถอนงานรอและ lock wait, งานส่งแล้วรักษาล็อกจนผลจริง, ไม่ replay; แจ้ง pending/unknown ตามหลักฐาน | core-hardening + wire deadline ใน public-core         |
| 4. Workspace transaction          | workspace, rename, alias และ event บันทึกครบชุดหรือ rollback                                                                                  | core-hardening                                        |
| 5. Persistence failure            | สถานะ broker/session/dashboard แสดงการบันทึกล้มเหลว, เตือนในผล tool โดยไม่บอกให้ทำ mutation ซ้ำ; corrupt state เก็บไว้และหยุด startup         | core-hardening + dashboard error handling             |
| 6. Runtime ต่างรุ่น               | handshake ตรวจรุ่นและโฟลเดอร์จริง, dashboard แสดงรุ่น broker, Setup ตรวจงานและหยุด runtime ก่อนเปลี่ยน config                                 | runtime-upgrade + public-core prepare-upgrade         |
| 7. ข้อความเก่า                    | แทนคำแนะนำ Setup.cmd / ตั้ง tunnel เอง ด้วย launcher และ flow ปัจจุบัน                                                                        | source review + Setup / tunnel GUI                    |
| 8. Heartbeat ใน dashboard         | กรองทั้ง worker_heartbeat และ broker_heartbeat, แสดง fatal เป็นข้อผิดพลาด                                                                     | dashboard-test + ภาพ render                           |
| 9. CI                             | Windows: core, external, upgrade, runtime cutover, Setup, tunnel, shell, real-worker integration และ ZIP Setup                                | workflow ใน Git; คำสั่งทดสอบผ่านบนเครื่องนี้          |
| 10. ZIP สุดท้าย                   | ตัว Windows ติดตั้งใหม่, อัปเกรดจาก beta.9 และ beta.11 โดยรักษาข้อมูล; source ZIP ติดตั้งและ build ครั้งแรก                                   | release-test ใช้ archive จริง ตาม hash ด้านล่าง       |

## เพิ่มเติมที่พบระหว่างทดสอบ

- เลือก broker ที่ถือ endpoint ก่อนเปิด SQLite ป้องกันการเริ่มพร้อมกันแย่งสร้างฐานข้อมูล
- ไม่ให้ timeout เริ่มต้นของ upstream SDK ทิ้งผลที่ยังทำงาน และป้องกัน heartbeat/recovery restart ระหว่าง tool call
- การเขียน event log ล้มเหลวไม่เปลี่ยน tool ที่สำเร็จแล้วให้กลายเป็นคำขอที่ควรทำซ้ำ
- Setup เรียก TypeScript compiler โดยตรง แก้การ build ในชื่อโฟลเดอร์ที่มีช่องว่างและ `&`
- จำกัด pending requests ต่อ connection และขนาด buffer ของ broker
- ปรับ Git line endings ให้ตรงกับ formatter และยืนยัน `format:check` จาก fresh local clone แล้ว

## ผลรวม

- `npm test`: ผ่าน รวม regression core ใหม่ 8 กรณี, lifecycle 12 และ workspace binding 3 กรณี
- Desktop Commander 0.2.50: integration ผ่านทั้ง 8 suites และไฟล์ upstream ไม่เปลี่ยน
- Setup / tunnel / external / upgrade / runtime-upgrade / shell: ผ่าน
- ZIP Windows: fresh Setup, beta.9 → beta.13, beta.11 → beta.13 ผ่าน พร้อมตรวจ rollback เมื่อ verification ล้มเหลว
- ZIP source: fresh Setup และ automatic build ผ่านในโฟลเดอร์ที่มีช่องว่างและ `&`
- ตรวจรายการไฟล์ที่จะเข้า Git: ไม่พบ runtime directory, credential หรือ path เครื่องผู้พัฒนา
- รายละเอียดผลย่อ: [beta13-test-results.md](beta13-test-results.md)

## Archive ที่ผ่านการทดสอบ

| ชุด                                               | SHA256                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| dwb-mcp-studio-core-0.1.0-beta.13-windows.zip     | `41ae29535cd50ff372e2327beb6d68c6aaba79ed37ae2ee71646047e68e2a1a4` |
| dwb-mcp-studio-core-0.1.0-beta.13-source-test.zip | `1b0384252759483959b107876e77d75eba9ffec7c698109eca9c21951d2d1414` |

## ขอบเขตการยืนยัน

ทดสอบบน Windows เครื่องปัจจุบัน โดยแยก installation และ data directory ใช้ dependency fixture ของ DWB ในการทดสอบ Setup/upgrade และใช้ Desktop Commander จริงใน integration แยกกัน ไม่ได้ทดสอบ Windows เครื่องเปล่าอีกเครื่องหรือการยืนยันตัวตนกับ OpenAI hosted tunnel ในรอบนี้ และยังไม่ได้รัน workflow บน Git host เพราะยังไม่ push

ไฟล์ล็อกและ workspace guard ไม่ใช่ OS sandbox และไม่ครอบคลุม hard links, shell หรือโปรแกรมอื่นที่แก้ไฟล์นอก broker ส่วน legacy runtime จะถูกปิดอัตโนมัติเฉพาะเมื่อยืนยัน process และไม่เหลืองาน/worker/connection หากยืนยันไม่ได้ Setup หยุดโดยไม่ reset ข้อมูล

พฤติกรรมผู้ใช้: [การอัปเดต](../../../docs/UPDATING-TH.md) · [ความถูกต้องของ core](../../../docs/CORE-RELIABILITY.md)

รายงานเปรียบเทียบ [COMPARISON-TH.md](COMPARISON-TH.md) เป็นหลักฐาน baseline beta.12 และเก็บไว้ตามวันที่เดิม
