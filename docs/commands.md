# Commands

## Design Principles

`Cyberboss` does not hard-code one shared string format across terminal commands, WeChat commands, and different agent runtimes.

It defines stable internal actions first, then lets each channel expose its own entrypoints:

- core action: stable internal meaning
- terminal command: terminal entrypoint
- weixin command: WeChat entrypoint

This keeps the core naming stable when new runtimes or channels are added later.

The runtime can be `codex` or `claudecode`, but the documented command surface stays the same.

## Current Action Groups

### Lifecycle & Diagnostics

- `app.login`
- `app.accounts`
- `app.start`
- `app.shared_start`
- `app.shared_open`
- `app.shared_status`
- `app.doctor`

### Workspace & Thread

- `workspace.bind`
- `workspace.status`
- `thread.new`
- `thread.reread`
- `thread.compact`
- `thread.switch`
- `thread.stop`
- `system.checkin_range`
  Host-side name for the check-in wake-up interval control.
- `system.pulse_range`
  Host-side name for the scheduled life-pulse interval control.
- `channel.chunk_min`

### Approvals & Control

- `approval.accept_once`
- `approval.accept_workspace`
- `approval.reject_once`

### Capabilities

- `model.inspect`
- `model.select`
- `activity.inspect`
- `reminder.inspect`
- `channel.send_file`
- `timeline.write`
- `reminder.create`
- `diary.append`
- `app.star`
- `app.help`

## Current Terminal Commands

The intentionally small public set is:

- `npm run login`
- `npm run accounts`
- `npm run shared:start`
- `npm run shared:open`
- `npm run shared:status`
- `npm run doctor`
- `npm run help`

## Project Tools

Models no longer use local capability CLI commands for diary, reminders, timeline, screenshots, or file sending.

Those capabilities are exposed as project-native structured tools:

- `cyberboss_channel_send_file`
- `cyberboss_diary_append`
- `cyberboss_reminder_create`
- `cyberboss_system_send`
- `cyberboss_timeline_write`
- `cyberboss_timeline_build`
- `cyberboss_timeline_serve`
- `cyberboss_timeline_dev`
- `cyberboss_timeline_screenshot`

Notes:
- These tools are bound to the Cyberboss project and routed through the repo's internal tool host.
- Claude Code loads them through workspace-local `.mcp.json` injected by Cyberboss and passed to Claude at startup with `--mcp-config`.
- Codex loads them through the runtime-side Cyberboss MCP bridge configured at spawn time.
- The public human terminal surface stays intentionally small: lifecycle commands plus shared bridge scripts.
- Future-useful carry-over material now lives in the unified memory tools as memory types such as `wishseed` and `concern`.
- `cyberboss_memory_complete` is the lifecycle-close path for `wishseed`, `concern`, and `project`.
- Legacy `seedbox` names may still appear in migration notes or old state files, but they are no longer the active model-facing tool surface.

## Current WeChat Commands

- `/bind`
- `/status`
- `/new`
- `/reread`
- `/compact`
- `/stop`
- `/switch <threadId>`
- `/checkin <min>-<max>`
  Adjust the host-side random check-in wake-up range for the current project.
- `/pulse <min>-<max>`
  Adjust the host-side scheduled life-pulse range for the current project.
- `/chunk <number>`
- `/activity`
  Inspect current activities for the bound workspace/chat.
- `/activity items`
  Inspect current activities with each open item expanded.
- `/reminder`
  Inspect current hard reminders for the bound workspace/chat.
- `/yes`
- `/always`
- `/no`
- `/model`
- `/model <id>`
- `/star`
- `/help`

Notes:

- `/status` covers thread, workspace, and context details
- there is no separate `/context` command; use `/status` and read the `📦 context` line
- `/compact` asks the current thread to compact its context and reports start / finish back to WeChat
- file sending is still available, but no longer exposed as a WeChat command
- `checkin` remains the human-facing command/config term for the host scheduler
- `pulse` remains the model-facing soft-trigger semantic term for non-reminder internal turns
- when unset, `/checkin` falls back to `CYBERBOSS_CHECKIN_MIN_INTERVAL_MS` / `CYBERBOSS_CHECKIN_MAX_INTERVAL_MS`, then to `5-15` minutes
- when unset, `/pulse` falls back to `CYBERBOSS_PULSE_MIN_INTERVAL_MS` / `CYBERBOSS_PULSE_MAX_INTERVAL_MS`, then to `180-360` minutes
- `/activity` is read-only in phase 1 and shows activity threads rather than creating reminders
- activities auto-arm a first review by default; if the model does not specify one, the default cadence is `30-60` minutes
- `/reminder` is read-only in phase 1 and shows active hard reminders only
