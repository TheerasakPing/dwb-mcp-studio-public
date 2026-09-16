# Core reliability — beta.13

## Files and workspaces

File locks and saved observations resolve junctions and normalize Windows case. New files use the real path of their nearest existing parent. The broker rechecks the path and workspace boundary after waiting for locks. Conflicting workspace aliases roll back the entire registration, including renames and events.

These checks coordinate the supported filesystem tools. They are not an OS sandbox: arbitrary shell commands, external programs, hard links and directory changes made outside the broker still require care. The configured Desktop Commander filesystem policy remains in effect.

## Timeouts and cancellation

- **DWB_REQUEST_CANCELLED:** the tool was not dispatched. Its queue/lock wait is removed; it will not execute later.
- **DWB_OUTCOME_PENDING:** the tool was dispatched. The broker keeps its worker and locks until the result arrives, even if the caller has stopped waiting. Check files/processes before retrying.
- **DWB_OUTCOME_UNKNOWN:** the broker connection or acknowledgement was lost. Inspect the actual result before retrying a mutation.

The adapter forwards MCP cancellation to the broker. Requests also carry a deadline; the broker never replays a failed or expired tool call automatically. These messages do not claim to undo already-started actions.

## Saved session health

`dwb_broker_status` and the dashboard report persistence health. A failed save also adds a warning to the completed tool result; a successful mutation must not be repeated just because its continuity metadata could not be saved. A later successful save clears the warning.

An unreadable or corrupt `broker-state.json` stops broker startup and is preserved for recovery. Check disk space and access rights first. Back up the data directory before repairing state. Workspace registrations and aliases live separately in SQLite; resetting a corrupt session snapshot does not require creating the ChatGPT connector again.

## Restart and update

Manual worker restart rejects active requests, processes and searches. A failed activity probe is treated as busy. Setup uses the same conservative rule when retiring a runtime, and refuses to update if it cannot save continuity first. The dashboard displays the version actually running in the broker.

See [updating with existing settings](UPDATING-TH.md). Closing or minimizing hides to tray by default. In beta.14 App preferences can change close to exit and stop MCP, guarded against active work, or minimize normally to the taskbar.
