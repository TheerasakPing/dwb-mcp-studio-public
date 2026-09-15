# เปรียบเทียบ DWB ต้นแบบกับ Public Core beta.12

ตรวจวันที่ 15 กันยายน 2026 จาก source ของสองโครงการ

เอกสารสำหรับพัฒนา core: ลิงก์ต้นแบบอ้าง sibling repository `dwb-desktop-bridge` ส่วนหลักฐานทดสอบเก็บในโฟลเดอร์เอกสารนี้ ไม่จำเป็นต่อการใช้งานโปรแกรม

- ต้นแบบ: `dwb-desktop-bridge` — package 1.0.0
- รุ่นแจก: `dwb-mcp-studio-public` — package 0.1.0-beta.12
- ขอบเขตที่ผู้ใช้ยืนยัน: รุ่นแจกคงฟีเจอร์เดิม เน้นปรับ core เพื่อเป็นฐานของรุ่นส่วนตัวภายหลัง
- รอบนี้ทำการตรวจ เปรียบเทียบ และเขียนตัวจำลองเพื่อยืนยันปัญหา ไม่ได้เพิ่ม MCP provider หรือแก้ production source

## ข้อสรุป

**ใช้ core รุ่นแจกเป็นฐานต่อยอด เหมาะกว่านำต้นแบบทั้งชุดมาใช้ต่อทันที** เพราะรุ่นแจกแก้ race ของการจัด worker, การเปลี่ยน workspace, resume/reconnect และการติดตั้งบนเครื่องอื่นไว้หลายจุดแล้ว

ต้นแบบยังมีความสามารถระดับแอปกว้างกว่า โดยเฉพาะ module registry, Work/handoff, Skills, telemetry และ Chat Library ส่วนเหล่านี้เหมาะเป็นแหล่งนำกลับมาใช้ในรุ่นส่วนตัวตามความจำเป็น การไม่มีส่วนเหล่านี้ในรุ่นแจกตรงกับขอบเขตที่กำหนด

**ยังไม่ควรเรียก core ของฝ่ายใดว่าครบสมบูรณ์**: พบปัญหาที่ทำซ้ำได้เกี่ยวกับตัวตนของไฟล์บน Windows, junction, การบันทึก workspace ไม่ครบธุรกรรม และ manual restart ของงานเบื้องหลัง รวมถึงข้อจำกัดเรื่อง cancellation, upgrade runtime และความทนทานของข้อมูลที่เห็นจากโค้ด

### วิธีอ่านหลักฐาน

- **ยืนยันด้วยการรัน**: ทดสอบซ้ำในรอบตรวจนี้
- **ยืนยันจากโค้ด**: พบเส้นทางการทำงานใน source แต่ไม่ได้จำลองผลกระทบทั้งหมด
- **หลักฐานเดิม**: ผลที่บันทึกไว้ก่อนหน้านี้ใน VALIDATION หรือการทดสอบ beta.12
- **ยังไม่วัด**: ไม่จัดอันดับความเร็ว/RAM หรือความเสถียรระยะยาวโดยไม่มี benchmark

## 1. โครงสร้างและการจัด worker

| มิติ                       | ต้นแบบ                                               | Public beta.12                                             | ความหมายในการเลือกฐาน                                                              |
| -------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| โครงสร้างหลัก              | stdio adapter → singleton broker → DC worker         | โครงสร้างเดียวกัน                                          | รุ่นแจกสืบทอด core เดิม ไม่ใช่ engine คนละแบบ                                      |
| การแยก worker              | หนึ่ง process ต่อ session ที่ได้รับ worker           | เช่นเดียวกัน                                               | แยก state process/search ของ DC ได้ทั้งคู่ แต่แชร์ระบบไฟล์ของผู้ใช้                |
| จำนวน worker เริ่มต้น      | cap 4, queue และ idle reclaim                        | cap 4 พร้อมแก้การจอง slot ก่อนปลุกคิว                      | Public มี regression tests ของ race ที่ละเอียดกว่า                                 |
| process ที่กำลังปิด        | ล้าง worker reference โดยยังไม่มี stopping counter   | นับ stoppingWorkers จน stop เสร็จ                          | Public ลดโอกาสจำนวน process เกิน cap ระหว่างเปลี่ยน worker                         |
| การคืน worker ว่าง         | มี detached/idle reclaim และ Work superseded reclaim | ตรวจสถานะซ้ำหลัง await และคืนเท่าที่คิวต้องการ             | Public ป้องกันปิด worker ที่เพิ่งมีคำขอใหม่และเก็บ warm worker ที่ไม่จำเป็นต้องคืน |
| แยก worker state           | config home ต่อ session                              | config home ต่อ session                                    | ทั้งคู่ยังเป็น process isolation ไม่ใช่ VM/container                               |
| วิธีแก้ config home ของ DC | postinstall แก้ config.js ใน node_modules บนดิสก์    | loader แทนข้อความในหน่วยความจำของ worker                   | Public ไม่แก้ upstream file จริง แต่ยังผูกกับ layout ของ DC                        |
| upstream ที่รองรับ         | DC 0.2.50; workerEntry override ได้                  | ตรวจชื่อแพ็กเกจ เวอร์ชัน 0.2.50 และ layout อย่างเข้มงวด    | Public แจกง่าย/คาดการณ์ได้ แต่ไม่ใช่ generic worker provider                       |
| การตรวจงานเบื้องหลัง       | เรียก list_sessions/list_searches และอ่านข้อความ     | ใช้วิธีเดียวกัน                                            | ยังพึ่งรูปแบบข้อความของ DC; ไม่ใช่ state protocol ที่เป็นกลางต่อ provider          |
| คำขอที่นับว่ากำลังทำ       | callTool นับ แต่ resource/list ไม่ครอบคลุมเท่า       | withWorker นับ list/read resource ด้วย                     | Public ป้องกัน reclaim/restart ระหว่างอ่าน resource                                |
| manual restart             | ไม่กั้น concurrent request แบบรุ่นใหม่               | กั้น inFlight/allocation/restarting                        | ยังไม่ตรวจ background process/search ก่อน restart ทั้งสองแนวทาง                    |
| shutdown                   | หยุด worker ที่มีอยู่                                | รอ allocation/reclaim/retirement และปฏิเสธคิวใหม่          | Public จัดการวงจรเริ่ม/หยุดละเอียดกว่า แต่ยังไม่มี graceful drain ครบวงจรใน UI     |
| รูปแบบใช้ engine ภายหลัง   | SessionRegistry ผูกกับ WorkStore                     | ผูก WorkspaceStore และรับ factory สร้าง worker สำหรับ test | Public แยกง่ายขึ้น แต่ยังไม่มี provider contract ที่สมบูรณ์                        |

หลักฐานสำคัญ: [Public SessionRegistry](../../../src/session-registry.ts#L472), [WorkerSupervisor](../../../src/worker-supervisor.ts#L95), [loader](../../../src/worker-config-loader.ts#L1), [patch ของต้นแบบ](../../../../dwb-desktop-bridge/scripts/patch-desktop-commander.mjs#L1)

## 2. Workspace และการต่อเนื่องข้ามแชท

| มิติ                            | ต้นแบบ                                                                        | Public beta.12                                                     | ข้อสรุป                                                           |
| ------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| ชื่อ/alias ของ workspace        | มีทะเบียน SQLite และ resolve ชื่อ                                             | มีเหมือนกัน แยก DB เฉพาะ core                                      | ใช้ชื่อสั้นได้ทั้งคู่ เมื่อชื่อ resolve ได้ชัดเจน                 |
| ระบุ directory ครั้งแรก         | bind อาจใช้ workspace แม่ที่ครอบ path อยู่                                    | register/reuse directory ที่ระบุโดยตรง                             | Public เหมาะกับคำสั่งให้ทำงานในโฟลเดอร์ย่อยที่เจาะจง              |
| CWD ของ worker                  | spawn อิง session.workspaceKey; logical workspace อยู่ใน Work/Workspace layer | spawn อิง workspace ที่ bind; เปลี่ยน worker เมื่อเปลี่ยน root     | Public ลดโอกาส logical workspace กับ CWD จริงไม่ตรงกัน            |
| เปลี่ยน workspace ระหว่างงาน    | binding/Work state เปลี่ยนได้; ไม่มี guard รอบ worker แบบใหม่                 | กั้นคำขอและตรวจ process/search ก่อนเปลี่ยน worker                  | Public ชัดเจนและมี regression test                                |
| ไม่มี workspace ระบุ            | ไม่รู้เจตนาจากแชทเอง; Work open มีเงื่อนไขต้อง bind                           | ไม่เดา workspace จากแชทอื่น; worker ใช้ค่า CWD เริ่มต้นถ้าไม่ bind | ทั้งคู่ไม่ได้อ่านความหมายของข้อความสนทนาด้วยตัว engine            |
| directory เดียวกันหลายแชท       | คนละ worker, แชร์ไฟล์                                                         | เช่นเดียวกัน                                                       | workspace ไม่ได้บังคับให้ทุกแชทใช้ worker ตัวเดียว                |
| แยก logical chat จาก metadata   | อาจรับ nested request_id หรือ conversation.title เป็น identity                | ตัด request/run/trace/title ออกจากตัวระบุที่รับ                    | ทดสอบยืนยันว่า Public แก้สองกรณีนี้แล้ว                           |
| ไม่มี stable chat ID จาก client | fallback ตาม transport                                                        | เช่นเดียวกัน                                                       | ไม่สามารถรับประกันแยกแชทได้ถ้า client ไม่ส่ง identity ที่แยกกัน   |
| resume แล้วคำขอต่อไป            | context/family/root cache มีช่องว่าง                                          | ย้าย contextKey, transport family และส่ง sessionId กลับให้ adapter | Public มี regression ของ new-chat resume และ sibling routing      |
| reconnect หลังเปลี่ยน CWD       | workspaceKey ถูกใช้ปนหลายหน้าที่                                              | มี transportWorkspaceKey แยกจาก workingDirectory                   | Public กู้การเชื่อมต่อโดยไม่สลับ root ผิดได้ดีขึ้น                |
| งานต่อเนื่องในระดับโปรเจกต์     | Work open/checkpoint/resume/close/history และ ownership handoff               | ไม่มี Work layer ตามขอบเขต                                         | ถ้ารุ่นส่วนตัวต้องการ checkpoint/ownership ให้นำกลับเป็นชั้นเสริม |
| กันแชทเก่าเขียนหลังส่งต่องาน    | WorkStore mutationGate กั้น session ที่ superseded ในงานนั้น                  | ไม่มี ownership rule นี้; มี lock/stale observation                | คนละการรับประกัน: stale-write ไม่ได้แทนการครอบครองงาน             |
| ประวัติสนทนา                    | Chat Library/import/archive และ session-chat binding                          | ไม่มีการเก็บบทสนทนาเต็ม                                            | Public ตรงความต้องการเน้น workspace/worker                        |

ข้อสำคัญ: การ resume worker ที่ยังอยู่ กับการเปิดแชทใหม่แล้ว bind workspace ชื่อเดิมเป็นคนละ flow การ bind ชื่อเดิมไม่ได้ทำให้ process/search handles เก่ากลับมาเอง

หลักฐาน: [Public workspace routing](../../../src/session-registry.ts#L482), [resume](../../../src/session-registry.ts#L890), [Work ownership ต้นแบบ](../../../../dwb-desktop-bridge/src/work-store.ts#L470)

## 3. ความถูกต้องของไฟล์ ข้อมูล และการกู้ระบบ

| มิติ                         | ต้นแบบ                                                     | Public beta.12                               | ข้อจำกัดที่ยังเหลือ                                                                   |
| ---------------------------- | ---------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------- |
| RW locks                     | LockManager                                                | ไฟล์เดียวกันแบบบรรทัดต่อบรรทัด               | ไม่ควรอ้างว่ารุ่นแจกเพิ่มความแข็งแรงของ lock แล้ว                                     |
| stale-write protection       | fingerprint หลังอ่าน/เขียน แล้วตรวจก่อนแก้                 | กลไกเดียวกัน                                 | ถ้าไม่เคย observe จะไม่มี expected version; ไม่ได้บังคับ read-before-write            |
| ตัวตนไฟล์ Windows            | normalize/resolve ของข้อความ path                          | เหมือนกัน                                    | case variant/junction/hard link ยังไม่ได้ถูกรวมเป็นตัวตนไฟล์เดียวทั้งหมด              |
| ขอบเขต workspace             | relative/resolve แบบ lexical                               | เหมือนกัน                                    | ไม่ resolve ปลายทาง junction ในด่านนี้                                                |
| shell และ background command | ล็อก workspace-process ระหว่าง tool call                   | เหมือนกัน                                    | lock ไม่ครอบคลุมอายุ background process ทั้งหมด และไม่รู้ทุกไฟล์ที่ script ไปแก้      |
| ไฟล์ใหญ่                     | hash เมื่อขนาดไม่เกิน 16 MiB; ใหญ่กว่านั้นใช้ size/mtime   | เหมือนกัน                                    | ไม่ใช่ checksum ทุกไฟล์ และไม่ล็อกการเขียนจากแอปภายนอก                                |
| worker crash                 | retry/restart/backoff/circuit breaker                      | เหมือนเดิมพร้อม stop/start race fixes        | process/search handles ใน worker ที่ตายไม่ถูกกู้กลับ                                  |
| broker crash                 | เก็บ session metadata + observations ลง JSON               | เช่นเดียวกัน พร้อมแก้ singleton ก่อน restore | ยังต้องเปิด worker ใหม่; ไม่มี exactly-once ของคำสั่งที่ผลลัพธ์ขาดกลางทาง             |
| การ replay คำสั่งแก้ไฟล์     | ไม่ replay tool call ที่ล้มกลางทางแบบอัตโนมัติ             | เช่นเดียวกัน                                 | ทิศทางเหมาะสม แต่ยังไม่มี request outcome journal สำหรับบอกว่าผลจริงเกิดไปแล้วหรือยัง |
| session persistence          | temp file + rename; write chain กลืน error                 | เหมือนกัน                                    | พัง/เขียนไม่ได้อาจเสีย continuity โดยไม่มีสถานะแจ้งชัดเจน                             |
| อายุ session ที่กู้          | ค่าเริ่มต้น restore window 30 นาที, detached grace 5 นาที  | เช่นเดียวกัน                                 | ไม่ใช่การเก็บ session ถาวร; workspace registry อยู่ได้นานกว่า                         |
| workspace transaction        | หลาย SQL statement ต่อ register/bind                       | เช่นเดียวกัน                                 | alias ชนแล้วอาจมี row หรือ alias ก่อนหน้าถูกบันทึกไปแล้ว                              |
| DB                           | telemetry + Work + Chat + Skills + Workspace ใน store ใหญ่ | CoreStore เฉพาะ workspace 4 ตาราง            | Public ลด coupling; ยังไม่มีระบบ migration/backup/restore ที่ครบสำหรับอนาคต           |
| request timeout/cancel       | timeout ฝั่ง adapter ลบ pending request                    | เหมือนกัน                                    | ยังไม่เห็น cancellation ส่งไปเอางานออกจากคิวหรือยกเลิกการทำงานใน broker               |
| IPC/queue limits             | ไม่เห็นขอบเขตขนาด buffer/queue ที่เป็นระบบ                 | เหมือนกัน                                    | payload guard ของผลลัพธ์ไม่ได้แทน backpressure ของคำขอเข้า                            |

หลักฐาน: [file-observer](../../../src/file-observer.ts#L23), [workspace boundary](../../../src/workspace-store.ts#L30), [request timeout](../../../src/broker-client.ts#L198), [broker-state](../../../src/broker-state.ts#L29)

## 4. MCP และการต่อยอดรุ่นส่วนตัว

| มิติ                         | ต้นแบบ                                                  | Public beta.12                                  | แนวทางตามขอบเขตปัจจุบัน                                                                               |
| ---------------------------- | ------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| core control tools           | 14: core 8 + Work/Skill + gateway 4                     | 8 core/workspace tools                          | ยังไม่เพิ่มกลับเข้า public                                                                            |
| tools/resources ของ DC       | ส่งผ่าน upstream                                        | เช่นเดียวกัน                                    | ทั้งคู่ไม่ได้เป็น proxy ครบทุกความสามารถในสเปก MCP                                                    |
| upstream transports ของโมดูล | stdio และ Streamable HTTP                               | worker DC แบบ stdio                             | เก็บความสามารถนี้ไว้พิจารณาในรุ่นส่วนตัว                                                              |
| เพิ่ม/ลบโมดูลภายหลัง         | manifest registry, discover/read/write/destructive      | ไม่มี                                           | เป็น feature ที่ตั้งใจไม่แจกในขอบเขตนี้                                                               |
| public tool schema ที่คงที่  | gateway 4 ตัวใช้ชื่อกลาง ไม่ต้องเพิ่มชื่อ tool ทุกโมดูล | ยังไม่มี gateway                                | ต้นแบบมีการทดสอบ dynamic add/remove และ stale revision                                                |
| การแยก module process        | runtime map แยกตาม module ID                            | ไม่มีโมดูล                                      | ต้นแบบไม่ได้แยกทุกโมดูลเป็น worker ต่อ workspace/session                                              |
| CWD ของ module               | manifest cwd หรือ projectRoot                           | ไม่มีโมดูล                                      | ไม่ได้รับ workspace ของแต่ละคำขอโดยอัตโนมัติ                                                          |
| policy ของ module call       | access tier + revision + payload guard                  | ไม่เกี่ยวกับขอบเขตรุ่นแจก                       | ต้นแบบเรียกผ่าน CapabilityRegistry โดยไม่ผ่าน DC SessionRegistry.callTool ที่จัด locks/workspace gate |
| การเปลี่ยน config โมดูล      | ปิด runtime เก่าเมื่อ manifest เปลี่ยน                  | ไม่มี                                           | ถ้านำไปใช้ส่วนตัวควรเพิ่ม draining/in-flight protection ก่อนถือว่า hot reload สมบูรณ์                 |
| Skills                       | registry/read/match/configure ผูก Work                  | ไม่มี                                           | ข้อความแนะนำ/verification gates ไม่ใช่ OS security boundary                                           |
| generic provider contract    | ยังไม่แยก DC lifecycle ออกจาก core ชัดเจน               | มี worker factory เพื่อทดสอบ แต่ยัง DC-specific | ควรแยก interface ภายในเมื่อทำฐานส่วนตัว โดยไม่เพิ่ม UI/ฟีเจอร์สู่ชุดแจก                               |

**ต้องแก้ความเข้าใจจากคำตอบก่อนหน้าให้ครบ:** ต้นแบบเพิ่ม MCP ภายหลังผ่าน gateway ได้จริง แต่ไม่ได้แปลว่าทุก MCP จะได้รับ worker isolation, workspace routing และ file locks แบบ DC โดยอัตโนมัติ การนำ registry กลับมาอย่างเดียวจึงยังไม่พอสำหรับฐานส่วนตัวที่แข็งแรงกว่าเดิม

หลักฐาน: [CapabilityRegistry](../../../../dwb-desktop-bridge/src/capability-registry.ts#L108), [module cwd](../../../../dwb-desktop-bridge/src/capability-registry.ts#L202), [module call route](../../../../dwb-desktop-bridge/src/broker-server.ts#L108)

## 5. การติดตั้ง อัปเดต UI และความเป็นส่วนตัว

| มิติ                          | ต้นแบบ                                                                                 | Public beta.12                                                                         | ข้อสรุป                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| First run                     | repo/npm และ runtime scripts                                                           | branded EXE → Setup ตรวจ Node/เตรียม dependencies/ตั้งค่า                              | Public เป็นผลิตภัณฑ์สำหรับผู้ใช้ทั่วไปมากกว่า                                                     |
| ทางเข้าแอป                    | dashboard script/web UI และ runtime scripts                                            | EXE เดียว, Setup/Connection/Dashboard ใน host เดียว                                    | Public ลดขั้นตอนเปิดหลายโปรแกรม                                                                   |
| ปิด/ย่อ                       | web dashboard ตาม browser                                                              | notification icon, restore, duplicate-launch wake                                      | Public รองรับ desktop lifecycle ตามคำขอ                                                           |
| Dashboard เชิงลึก             | summary/time series/tool stats/sources/work/chat library                               | สถานะ tunnel/broker/worker/session/queue + recent events                               | ต้นแบบวิเคราะห์ย้อนหลังได้มากกว่า                                                                 |
| อ่านสถานะ runtime             | CIM + command-line pattern และข้อมูล telemetry                                         | inspect broker แบบไม่ attach + PID/path/creation time ของ tunnel                       | Public ลดการนับผิดและการ stop ชน instance อื่น                                                    |
| Start/Stop                    | stopConnection จับชื่อ/command-line pattern กว้าง                                      | หยุด process tree ของ tunnel ที่บันทึก ownership ไว้                                   | Public แคบกว่า แต่ Stop tunnel ไม่ได้แปลว่าหยุด broker และงานทั้งหมด                              |
| path เครื่อง                  | มี default C:\\tools\\dwb-mcp-tunnel และ state ใน projectRoot                          | data ใน LOCALAPPDATA; external อยู่กับ app; generated absolute paths                   | Public ย้ายเครื่อง/โฟลเดอร์ได้ตาม flow Setup                                                      |
| dependency distribution       | DC เป็น dependency และ postinstall patch                                               | DC/tunnel ดาวน์โหลดลง external; DWB EXE เป็นโค้ดของโครงการ                             | ขอบเขตแจกชัดเจน แต่ runtime ยังใช้ dependency tree ของ DC ตามเดิม                                 |
| key                           | runtime-control ใน repo อ้าง external tunnel script; ไม่ได้ audit key storage นอก repo | DPAPI key, แยก runtime environment และล้างก่อนส่งต่อ worker                            | Public มีเส้นทางจัดการ secret ที่เห็นและทดสอบได้ใน repo นี้                                       |
| อัปเดตโฟลเดอร์ใหม่            | ไม่มี flow ครบแบบรุ่นแจกใน repo นี้                                                    | reuse/copy dependency + preserve config/tunnel/key + rollback config เมื่อ verify fail | Public ดีกว่า แต่ไม่ใช่ atomic upgrade ของ app/runtime/DB ทั้งชุด                                 |
| เปลี่ยนรุ่นขณะ broker ยังวิ่ง | ไม่มี version negotiation ครบ                                                          | ยังไม่มี drain/restart/activation แบบอัตโนมัติครบ                                      | Public GUI รุ่นใหม่อาจคุยกับ broker รุ่นก่อนหน้าใน data directory เดียวกัน                        |
| แยกหลาย installation          | pipe ชื่อคงที่โดย default                                                              | pipe hash ตาม user/data directory                                                      | Public ลดการชน; คนละ app folder แต่ data directory เดียวกันยังแชร์ broker/config โดยตั้งใจ        |
| ข้อมูลสนทนา                   | มี Chat Library/archive/import                                                         | ไม่มี transcript database                                                              | Public ตรงกับการเก็บเฉพาะข้อมูลที่ใช้จัดงาน                                                       |
| log/privacy                   | event JSONL + telemetry DB + upstream-history ingestion                                | event JSONL, workspace DB และ oversized payload archive                                | Public ไม่ได้แปลว่าไม่มีเนื้อหางานบนดิสก์: payload archive ค่าเริ่มต้น redacted ยังเก็บบางส่วนได้ |
| retention                     | มี clean-logs แบบสั่งเอง; state ไม่ถูกลบทิ้งอัตโนมัติ                                  | payload retention มี; ไม่พบ rotation ครบของ event/setup/tunnel logs                    | ทั้งคู่ควรมี retention policy ที่แยก log กับข้อมูลสำคัญ                                           |
| platform                      | มี fallback Unix บางส่วน แต่ runtime controls เป็น Windows                             | Windows-only พร้อม minimum Node 22.16                                                  | อย่านับว่าเป็น cross-platform จากการมี path fallback                                              |
| packaging/docs                | เอกสารระบบส่วนตัวและเครื่องมือ dev มาก                                                 | release allowlist, license/third-party docs, first-run/update guides                   | Public เหมาะสำหรับแจกมากกว่า; ยังมีข้อความตกค้างบางจุด                                            |

หลักฐาน: [runtime-control ต้นแบบ](../../../../dwb-desktop-bridge/src/runtime-control.ts#L7), [public tunnel ownership](../../../scripts/tunnel-common.ps1#L21), [upgrade](../../../scripts/upgrade.mjs#L64), [desktop shell](../../../scripts/app.ps1#L13)

## 6. ข้อค้นพบที่ยืนยันด้วยตัวจำลองในรอบนี้

ผลเต็ม: [probe-results.json](probe-results.json)

### P1 — ไฟล์เดียวกันบน Windows ได้ lock คนละตัว (ทั้งสองรุ่น)

สร้างไฟล์ทดสอบหนึ่งไฟล์ ยืนยันว่า path ที่เปลี่ยนตัวพิมพ์ยังอ้างไฟล์เดียวกัน จากนั้น acquire write lock ด้วยสอง path พบว่าได้พร้อมกัน ผลนี้ยืนยันการแยก lock ผิดตัวตน ไม่ได้จำลองการสูญหายของไฟล์จริง

ควรสร้าง file identity กลางสำหรับ lock, observation และ boundary ให้ตรงกัน รวม case, canonical parent ของไฟล์ใหม่ และการจัดการ link โดยมีข้อกำหนดชัดเจนสำหรับ Windows

### P1 — junction ผ่านการตรวจ workspace แบบ lexical (ทั้งสองรุ่น)

สร้าง alpha/linked-out เป็น junction ไป beta ซึ่งทั้งสองอยู่ในพื้นที่ทดสอบ ตรวจพบ pathWithin(alpha, alpha/linked-out/file) เป็น true แต่ realpath อยู่ beta

ยืนยันเฉพาะด่านตรวจของ core; ไม่ได้สรุปว่า Desktop Commander หรือ Windows permission อนุญาตการเขียนจริงทุกกรณี ต้องมี end-to-end test เพิ่มเมื่อแก้

### P1 — manual restart ยอมรับขณะที่มี background work (Public ยืนยันด้วย fake worker)

fake worker ตอบ hasActiveWork=true แต่ restartWorker ยังเรียก restart ได้เมื่อไม่มี inFlight request การเปลี่ยน workspace/resume มี guard นี้แล้ว แต่ manual restart ยังไม่ครอบคลุม ควรกำหนด graceful/force semantics และใช้การตรวจงานชุดเดียวกันทุกเส้นทาง รวม recovery policy เมื่อ heartbeat timeout

### P2 — workspace register ล้มเหลวแต่บันทึกไปบางส่วน (ทั้งสองรุ่น)

ลงทะเบียน alpha พร้อม alias taken แล้วลงทะเบียน beta โดยใช้ alias เดิม คำขอ beta error แต่ beta ยังปรากฏในทะเบียนแล้ว ยืนยันจาก DB ทดสอบแยกทั้งสอง implementation

ควรตรวจ alias และทำ register/rename/alias/event เป็น transaction เดียว รวมกรณี concurrent register

### Public แก้ chat identity ได้จริง

ข้อมูลที่มีเฉพาะ conversation.request_id หรือ conversation.title ถูกต้นแบบรับเป็น logical context แต่ Public คืน null ขณะที่ stable conversation ID ที่อยู่ร่วมกับ request ID ยังนิ่งในทั้งคู่

นี่เป็นข้อได้เปรียบของ Public ที่ยืนยันเพิ่มจาก regression เดิม ไม่ต้องอาศัยการเก็บบทสนทนาเพื่อให้ได้ผลนี้

## 7. ข้อค้นพบจากโค้ดที่ควรจัดลำดับต่อ

| ระดับ       | เรื่อง                                                                        | ผลที่ต้องการ                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| P1          | timeout ของ adapter ไม่ผูกกับ broker cancellation                             | เอาคำขอที่ยังไม่เริ่มออกจากคิวได้; งานที่เริ่มแล้วรายงานสถานะจริง ไม่ให้ timeout ดูเหมือนยกเลิกสำเร็จ                                        |
| P1          | upgrade ไม่มี runtime drain/version handshake ครบ                             | แสดง GUI/broker/worker version ที่กำลังใช้จริง; รอจบงานแล้วสลับ runtime โดยไม่ต้องเดาหรือรีสตาร์ต Windows เป็นทางหลัก                        |
| P1          | persistence failures ถูกกลืน; config rollback ไม่ครอบ power loss/process kill | แจ้ง degraded state, บันทึกอย่าง atomic และทดสอบ crash ระหว่างขั้นตอน                                                                        |
| P2          | log error อยู่ในเส้นทาง tool/probe                                            | แยกความล้มเหลวของ observability ออกจากผลของคำสั่งและ health ของ worker; ทดสอบ disk-full/permission-denied                                    |
| P2          | queue/IPC/lock wait ไม่มีขอบเขตและ cancellation ที่สอดคล้องกัน                | กำหนด maximums, deadlines และคืนทรัพยากรเมื่อ client หาย                                                                                     |
| P2          | event/setup/tunnel logs และ state เก่าไม่มีวงจรดูแลครบ                        | quota/rotation/retention และ backup/restore ที่ไม่ลบ workspace สำคัญ                                                                         |
| P2          | Public dashboard กรอง worker_heartbeat แต่ยังแสดง broker_heartbeat            | ทำ recent events ให้มีเหตุการณ์ที่ช่วยตัดสินใจ; นี่อธิบาย heartbeat เต็มตารางในภาพของผู้ใช้ได้จากโค้ด                                        |
| P2          | version/status และข้อความแนะนำบางแห่งยังไม่ตรง                                | ต้นแบบ package 1.0.0 แต่ server info ยัง 0.4.0; public doctor ยังบอกให้ configure tunnel แยก และ external-worker ยังอ้าง Setup.cmd ที่ลบแล้ว |
| P2          | CI ไม่รันชุดทดสอบครบตามแพ็กที่แจก                                             | workflow ปัจจุบันรัน npm test/release แต่ไม่รวม shell/setup/tunnel/upgrade/external และ real DC integration                                  |
| รุ่นส่วนตัว | module runtime แยกตาม module แต่ไม่ผ่าน worker scheduler/locks เดียวกัน       | เมื่อจะนำกลับใช้ ให้วาง scope และ execution contract ให้ชัดก่อน; ไม่เพิ่ม provider ใน public ตอนนี้                                          |

ข้อเหล่านี้เป็นรายการที่ตรวจพบจาก source ไม่ใช่การอ้างว่าทุกกรณีเกิดความเสียหายแล้ว และรอบนี้ยังไม่ได้แก้ production source

## 8. ผลทดสอบและสิ่งที่ยังตัดสินไม่ได้

### รันใหม่ในรอบนี้

- ต้นแบบ: TypeScript typecheck ผ่าน
- ต้นแบบ: request-context test ผ่าน แต่ probes ใหม่พบ edge cases ที่ test เดิมไม่ครอบคลุม
- ต้นแบบ: workspace-store test ผ่าน รวม Work/workspace switch/resume
- ต้นแบบ: capability-registry test ผ่าน รวม add/remove module, access tiers และ stale revision
- Public: npm test ผ่าน ประกอบด้วย typecheck/build, request context, payload, circuit, lifecycle 12 กรณี, workspace binding 3 กรณี, public core และ dashboard tests
- Probes เปรียบเทียบใหม่รันใน directory/DB แยก: case locks, junction boundary, partial registration, context selection และ background restart

ผลคำสั่ง: [test-runs.md](test-runs.md)

### หลักฐานเดิมที่ยังใช้ประกอบ

Public มีการทดสอบ GUI Setup/upgrade/rollback, tunnel fixture Start/Stop, EXE duplicate launch/tray/navigation และ real DC integration ที่บันทึกใน VALIDATION การตรวจนี้ไม่ได้รัน real hosted OpenAI authentication หรือ clean Windows OS ใหม่

### ยังไม่มีข้อมูลเปรียบเทียบเพียงพอ

- CPU/RAM และเวลาตอบสนองภายใต้ workload เดียวกัน จึงยังบอกไม่ได้ว่าฝ่ายใดเร็วหรือประหยัดกว่า
- การรันต่อเนื่องหลายวัน, disk-full, power loss, antivirus/SmartScreen และ installer cancellation ทุกจังหวะ
- การรองรับ Windows ARM64 จริง; มี archive/hash แต่หลักฐานทดสอบหลักเป็น x64
- การทดสอบทั้งหมดของต้นแบบพร้อมกันกับ runtime จริง; รอบนี้เลือกเฉพาะชุดที่แยก fixture และไม่ต้องหยุดบริการที่ใช้อยู่
- พฤติกรรมโปรเซสรุ่นที่เปิดอยู่บนเครื่องทดสอบของผู้ใช้: รายงานนี้เปรียบเทียบ source snapshot ในเครื่องพัฒนา

จำนวน production TypeScript ใน src (ไม่นับ test/fixture และไม่รวม PowerShell, UI assets หรือ dependency): ต้นแบบ 29 ไฟล์ 6,854 บรรทัด; Public 20 ไฟล์ 3,530 บรรทัด ตัวเลขนี้สะท้อนขอบเขต source เท่านั้น ไม่ใช่คะแนนคุณภาพหรือประมาณ RAM

snapshot/hash: [source-snapshot.json](source-snapshot.json)

## 9. ฐานที่ควรใช้ต่อสำหรับรุ่นส่วนตัว

1. **เริ่มจาก Public core ปัจจุบัน** เพื่อรักษา worker lifecycle, routing, workspace CWD, process ownership และการติดตั้งที่แก้แล้ว
2. **แก้ P1 ก่อนเพิ่มความสามารถ** โดยใช้ test ของตัวตนไฟล์, transaction, restart/cancel, persistence และ runtime version เป็นเกณฑ์ผ่าน
3. **แยก core engine ให้ใช้ร่วมกันภายใน**: session/scheduler/workspace/locks/recovery แยกจาก Windows UI, event sinks และ feature ชั้นบน อย่าปล่อยให้ core สองชุดพัฒนาแยกกันจนแก้บั๊กแล้วตกหล่นอีกฝั่ง
4. **นำกลับจากต้นแบบเฉพาะที่รุ่นส่วนตัวใช้จริง**: gateway/module registry, Work ownership/checkpoint, Skills และ telemetry ที่จำเป็น โดยต้องผ่าน execution/policy contracts ของ core ใหม่
5. **คง public product profile เดิม**: Desktop Commander หลาย worker + workspace + setup/dashboard ไม่เพิ่ม provider catalog, Chat Library หรือ workflow module ลงชุดแจก

เกณฑ์ว่า “ดีกว่าเดิม” ควรเป็นพฤติกรรมที่พิสูจน์ได้: ไม่ส่งงานผิด workspace, ไม่ปิด worker กลางงานโดยไม่ตั้งใจ, ไม่เขียนทับเพราะ path คนละรูป, ยกเลิก/อัปเดตแล้วสถานะตรงกับความจริง และสามารถต่อ feature ส่วนตัวโดยไม่ต้องแก้ core หลายสำเนา
