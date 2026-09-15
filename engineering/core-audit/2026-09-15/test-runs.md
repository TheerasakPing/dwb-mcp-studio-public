# Test runs for the core comparison

2026-09-15. Commands run in isolated test directories where applicable; no hosted tunnel started.

## Run 0

```

> dwb-mcp-studio-core@0.1.0-beta.12 test
> npm run typecheck && npm run build && tsx src/request-context-test.ts && tsx src/payload-guard-test.ts && tsx src/worker-circuit-test.ts && tsx src/session-lifecycle-test.ts && tsx src/workspace-binding-test.ts && node scripts/public-core-test.mjs && node scripts/dashboard-test.mjs


> dwb-mcp-studio-core@0.1.0-beta.12 typecheck
> tsc -p tsconfig.json --noEmit


> dwb-mcp-studio-core@0.1.0-beta.12 build
> tsc -p tsconfig.json

REQUEST_CONTEXT_PASS {"a":"openai.conversation_id#09398bc9bc19981c","b":"thread_id#a9fdd9183024c061"}
PAYLOAD_GUARD_UNIT_PASS {"guardedCount":3,"imageOriginalBytes":2097299,"imageForwardedBytes":906,"structuredOriginalBytes":131158,"structuredForwardedBytes":1003}
WORKER_CIRCUIT_PASS {"firstMs":77,"secondMs":0,"failures":2,"circuitOpenUntil":"2026-09-15T15:23:10.688Z"}
✔ concurrent requests never oversubscribe a reclaimed worker slot (321.2276ms)
✔ shutdown waits for a starting worker and releases its reserved slot (1.5989ms)
✔ one queued request reclaims only one idle worker (311.7571ms)
✔ disconnect during worker startup does not leave an orphan process (2.9578ms)
✔ retiring processes still count toward the cap until they have stopped (5.1686ms)
✔ manual restart and resume reject while a resource request is running (4.1551ms)
✔ resumed logical sessions stay in the current transport family (9.4132ms)
✔ new chat stays on the resumed session for subsequent metadata-routed requests (7.8047ms)
✔ resume refuses to discard a current worker with background work and can retry later (7.1387ms)
✔ resuming one logical chat preserves sibling chat routing (12.4488ms)
✔ resource reads count as active work and survive idle reclamation (1.6433ms)
✔ new work arriving during an idle probe prevents retirement (1.535ms)
ℹ tests 12
ℹ suites 0
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 692.606
(node:21352) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
✔ explicit directory registers and binds the exact child, leaving unspecified chats unbound (23.4909ms)
✔ directory changes replace only the current idle worker; busy work is preserved (18.2891ms)
✔ workspace binding survives broker recovery and launches the next worker in the bound directory (11.7118ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 56.195
PUBLIC_CORE_PASS: relocated launcher, generated config, missing dependency, read-only Doctor, core-only tools, 2 isolated workers, real OS home, unchanged external files, workspace boundary, stale-write protection, broker singleton, duplicate hello
DASHBOARD_TEST_PASS: redacted errors, partial logs, old broker, disconnected broker

```

## Run 1

```
(node:16220) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
CAPABILITY_BUS_PASS {"moduleCount":1,"accessTiers":["read","write","destructive"],"dynamicAddRemove":true,"staleRevisionBlocked":true,"stablePublicTools":["dwb_discover","dwb_read","dwb_write","dwb_destructive"]}

```

## Run 2

```
(node:11216) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
WORKSPACE_STORE_PASS {"workId":"work_bfb62b8b","workWorkspace":"<workspace>/dwb-desktop-bridge\\logs\\workspace-store-test\\alpha-workspace\\feature-a","currentWorkspace":"Alpha Workspace","boundaryBlocked":true,"switchPausedPreviousWork":true,"resumeRestoredWorkspace":true}
REQUEST_CONTEXT_PASS {"a":"openai.conversation_id#09398bc9bc19981c","b":"thread_id#a9fdd9183024c061"}

```
