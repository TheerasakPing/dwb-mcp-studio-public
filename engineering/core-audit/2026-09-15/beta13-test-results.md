# beta.13 test results

Local Windows validation, 2026-09-15. Generated from test output; personal paths omitted.

## beta13-core-tests.log

```text
REQUEST_CONTEXT_PASS
PAYLOAD_GUARD_UNIT_PASS
WORKER_CIRCUIT_PASS
✔ concurrent requests never oversubscribe a reclaimed worker slot
✔ shutdown waits for a starting worker and releases its reserved slot
✔ one queued request reclaims only one idle worker
✔ disconnect during worker startup does not leave an orphan process
✔ retiring processes still count toward the cap until they have stopped
✔ manual restart and resume reject while a resource request is running
✔ resumed logical sessions stay in the current transport family
✔ new chat stays on the resumed session for subsequent metadata-routed requests
✔ resume refuses to discard a current worker with background work and can retry later
✔ resuming one logical chat preserves sibling chat routing
✔ resource reads count as active work and survive idle reclamation
✔ new work arriving during an idle probe prevents retirement
ℹ tests 12
ℹ suites 0
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 683.1931
✔ explicit directory registers and binds the exact child, leaving unspecified chats unbound
✔ directory changes replace only the current idle worker; busy work is preserved
✔ workspace binding survives broker recovery and launches the next worker in the bound directory
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 58.9822
✔ Windows case variants and junction aliases share file identity and locks
✔ workspace boundary follows junctions and allows ordinary dot-prefixed children
✔ alias collision rolls back new workspace, rename, aliases and events
✔ manual restart and upgrade retain background work
✔ cancelled worker queue is removed and never executes later
✔ dispatched work retains lock until completion after caller cancellation
✔ upstream keeps long-running results and refuses recovery restart during a call
✔ persistence failures are visible, recover, and corrupt saved state is preserved
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 104.3233
PUBLIC_CORE_PASS: relocated launcher, generated config, missing dependency, read-only Doctor, core-only tools, 2 isolated workers, real OS home, unchanged external files, workspace boundary, stale-write protection, broker singleton, duplicate hello
DASHBOARD_TEST_PASS: redacted errors, partial logs, old broker, disconnected broker
```

## beta13-integration.log

```text
RUN smoke-test
SMOKE_PASS
RUN payload-smoke-test
PAYLOAD_SMOKE_PASS
RUN multi-session-test
MULTI_SESSION_PASS
RUN broker-recovery-test
BROKER_RECOVERY_PASS
RUN logical-context-test
LOGICAL_CONTEXT_PASS
RUN protocol-negotiation-test
PROTOCOL_NEGOTIATION_PASS
RUN workspace-integration-test
WORKSPACE_INTEGRATION_PASS: two chats, exact bindings, separate workers, real shell CWD, file routing and boundary
RUN resume-routing-test
RESUME_ROUTING_PASS: new chat, root token, sibling routing, different adapter CWD, concurrent reconnect, workspace and stale-write state
EXTERNAL_INSTALL_UNCHANGED_PASS
```

## beta13-zip-windows.log

```text
GUI_SETUP_PASS
GUI_SETUP_PASS
UPGRADE_ROLLBACK_PASS: failed final verification restored both configuration files.
UPGRADE_GUI_PASS: reused dependencies, no npm ci, old installation retained, saved key/tunnel/workspace/policy preserved, paths updated.
SETUP_TEST_PASS: requirements, safe arguments, GUI save flow, production install, independent worker, generated config.
GUI_SETUP_PASS
GUI_SETUP_PASS
UPGRADE_ROLLBACK_PASS: failed final verification restored both configuration files.
UPGRADE_GUI_PASS: reused dependencies, no npm ci, old installation retained, saved key/tunnel/workspace/policy preserved, paths updated.
SETUP_TEST_PASS: requirements, safe arguments, GUI save flow, production install, independent worker, generated config.
LEGACY_ZIP_UPGRADE_PASS: dwb-mcp-studio-core-0.1.0-beta.9-windows.zip
GUI_SETUP_PASS
GUI_SETUP_PASS
UPGRADE_ROLLBACK_PASS: failed final verification restored both configuration files.
UPGRADE_GUI_PASS: reused dependencies, no npm ci, old installation retained, saved key/tunnel/workspace/policy preserved, paths updated.
SETUP_TEST_PASS: requirements, safe arguments, GUI save flow, production install, independent worker, generated config.
LEGACY_ZIP_UPGRADE_PASS: dwb-mcp-studio-core-0.1.0-beta.11-windows.zip
RELEASE_ZIP_PASS: 73623f81490dcaf5106fc2c6e9e6eac7b2e0c3d2a83c1700bcbb23c65f6a84ec
```

## beta13-zip-source.log

```text
GUI_SETUP_PASS
GUI_SETUP_PASS
UPGRADE_ROLLBACK_PASS: failed final verification restored both configuration files.
UPGRADE_GUI_PASS: reused dependencies, no npm ci, old installation retained, saved key/tunnel/workspace/policy preserved, paths updated.
SETUP_TEST_PASS: requirements, safe arguments, GUI save flow, production install, independent worker, generated config.
RELEASE_ZIP_PASS: 051f4dda09a34db5354e2a05066008a8c93bdbcf5950b7fd54274eaced447e9c
```
