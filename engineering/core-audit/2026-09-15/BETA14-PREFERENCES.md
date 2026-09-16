# beta.14 — app lifecycle preferences

Date: 2026-09-16

## Delivered

Dashboard and tray now expose one persistent preferences dialog: start at Windows login, optionally connect MCP with the saved key, close to tray or exit and stop MCP, and minimize to tray or taskbar. Defaults retain the previous tray behavior and leave Windows startup disabled.

Startup uses the current user's Run entry and carries the data directory. Successful Setup refreshes the launcher path for an enabled startup entry. Explicit full exit uses the existing conservative runtime shutdown checks; a busy broker remains alive. The tunnel may already be stopped in that case, so reconnect to finish pending work.

## Validation

- npm test: all core, public runtime, and dashboard suites passed.
- npm run test:preferences: actual WPF controls and Save click, persisted choices, isolated registry enable/disable, unrelated registry values preserved, new-installation startup path refresh passed. Rendered dialog inspected: readable with no clipped controls.
- npm run test:shell: tray close/minimize, normal taskbar minimize, close-to-exit, launcher wake, page navigation and hidden startup dashboard passed.
- npm run test:tunnel: simulated startup with saved DPAPI key and ready loopback tunnel passed; existing tunnel ownership and GUI Start/Stop checks passed.
- npm run test:setup: upgrade preserves preferences, key, tunnel, workspace and policy; rollback checks passed.
- Actual Windows ZIP: fresh Setup and upgrade from beta.13 archive passed.
- Actual source ZIP: fresh Setup including source compilation passed.
- Archive exclusion scans, PowerShell parser checks, formatting and git diff checks passed.

Tests used isolated data and a separate registry key. They did not enable real login startup on the developer account. Actual Windows sign-out/sign-in and hosted OpenAI authentication still require a user-machine check; the startup integration used a local tunnel fixture.

## Verified archives

- Windows: dwb-mcp-studio-core-0.1.0-beta.14-windows.zip
  SHA256: dfb4f72e4d82319d805b174f1241827ee23a55e759882d2950821c7512b79bc7
- Source: dwb-mcp-studio-core-0.1.0-beta.14-source-test.zip
  SHA256: ab2783f0db2dea736d9c4a41e3e1bc05c37c0f49652de8d34979ef1fd4d70137

Release test evidence: logs/beta14-release-windows.log and logs/beta14-release-source.log (local, excluded from Git and archives).
