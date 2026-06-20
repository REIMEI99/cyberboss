# Habit Plugin Refactor

## Goal

Do two things in parallel:

1. clarify what the habit subsystem actually does
2. split it into boundaries that can later become an external package or plugin

This document is intentionally about structure, not prompt wording.

## Current Logic Map

The current habit subsystem contains four different responsibilities.

### 1. Definition storage

File:

- `src/services/habit-service.js`

Behavior:

- create/update habit definitions
- keep habit metadata such as `preferredWindows`, `contexts`, `avoidContexts`, `minimumVersion`
- sort and persist definitions

Current storage:

- `habit-definitions.json`

### 2. Event log and daily state derivation

File:

- `src/services/habit-service.js`

Behavior:

- append immutable events into `habit-events.jsonl`
- derive one daily state per habit: `done`, `incomplete`, `abandoned`, or `none`
- support user-side completion and agent-side nudging/defer/note events

Current storage:

- `habit-events.jsonl`
- `habit-state.json`

### 3. Analytics and heatmap shaping

File:

- `src/services/habit-service.js`

Behavior:

- convert event history into date-keyed cell arrays
- compute completion summaries
- export `habit-heatmap.json`

Current storage:

- `habit-heatmap.json`

### 4. Agent-facing decision support

Files:

- `src/services/habit-service.js`
- `src/tools/tool-host.js`
- `templates/weixin-operations.md`
- `src/core/system-message-dispatcher.js`

Behavior:

- expose MCP-like tools such as `mark_done`, `status_today`, `suggest_next_action`
- feed pulse review with habit status + nudge suggestion
- influence reminder behavior and user messaging

## Current Coupling

The subsystem is not yet plugin-shaped because these concerns are still mixed.

### Domain and file storage are fused

`HabitService` currently accepts `config` and pulls file paths directly from host app config.

That means:

- the service cannot be reused cleanly outside Cyberboss
- tests and packaging depend on the host config contract

### Tool registration and habit logic are fused into host tooling

Before this step, all habit tool specs lived inline in `src/tools/tool-host.js`.

That made:

- host tool registry harder to read
- habit plugin extraction harder

This refactor step moves those tool specs into a dedicated file:

- `src/tools/habit-tool-specs.js`

### Pulse review depends on a concrete `services.habit`

`cyberboss_pulse_review` still directly calls:

- `services.habit.statusToday(...)`
- `services.habit.suggestNextAction(...)`

This is acceptable for now, but it is still host-to-implementation coupling.

## Desired Split

The clean long-term split is:

### A. `habit-core`

Responsibility:

- definitions
- event log
- daily status derivation
- history
- heatmap export

Current implementation split:

- `src/habit/habit-state-service.js`
- `src/habit/habit-suggestion-engine.js`
- `src/habit/habit-service.js` as compatibility facade

Should not know about:

- WeChat
- reminder queue
- tool host
- prompt text
- Cyberboss runtime context

Suggested constructor shape:

```js
new HabitService({
  definitionsFile,
  eventsFile,
  stateFile,
  heatmapFile,
  timezone: "Asia/Shanghai",
  dayResetHour: 4,
});
```

### B. `habit-plugin`

Responsibility:

- connect `habit-core` to Cyberboss
- register habit tools
- optionally provide one pulse-facing adapter

Should know about:

- host config
- tool registration
- host runtime context

Should not own:

- the reminder scheduler itself

### C. optional `habit-heatmap` consumer

Responsibility:

- read `history()` output or `habit-heatmap.json`
- render dashboards, charts, or external visual plugins

This can remain entirely separate from the write path.

## Functional Split Plan

These steps are ordered by risk.

### Step 1. Extract habit tool specs

Status:

- done in this refactor step

Files:

- added `src/tools/habit-tool-specs.js`
- updated `src/tools/tool-host.js`

Effect:

- host tool registry is slimmer
- habit registration now has a natural plugin seam

### Step 2. Decouple `HabitService` from host config

Status:

- done in this refactor step

Change:

- replaced `new HabitService({ config })`
- with explicit path-based construction from host-side adapter code

Target:

```js
new HabitService({
  definitionsFile: config.habitDefinitionsFile,
  eventsFile: config.habitEventsFile,
  stateFile: config.habitStateFile,
  heatmapFile: config.habitHeatmapFile,
});
```

Effect:

- easier to publish as package
- clearer test surface
- no implicit dependency on full Cyberboss config object

### Step 3. Extract habit provider from pulse review

Status:

- done in this refactor step

Change:

- introduce a narrow adapter boundary, for example:

```js
services.habitProvider.getPulseSnapshot({ context, userState })
```

Instead of making pulse review know all `HabitService` methods directly.

Effect:

- pulse logic depends on a small contract
- plugin replacement becomes realistic

Current file:

- `src/habit/habit-provider.js`

### Step 4. Split state logic from suggestion logic

Status:

- done in this refactor step

Change:

- moved status/history/heatmap persistence into `HabitStateService`
- moved nudge scoring and recommendation logic into `HabitSuggestionEngine`
- kept `HabitService` as a facade so existing callers do not break immediately
- grouped habit-facing files under `src/habit/` so the domain is no longer scattered across `services/` and `tools/`

Effect:

- state facts and decision policy now have different code boundaries
- heatmap/export consumers no longer conceptually depend on nudge scoring
- package extraction can publish a cleaner internal API later

### Step 5. Move host-only policies out of core

Examples:

- how aggressively to remind
- whether reminder is the default habit channel
- how to word low-shame nudges

These belong to host prompt/policy layers, not `habit-core`.

## What Should Stay in Core

Keep these inside the future package:

- habit definition normalization
- event normalization
- daily state derivation
- date window logic
- completion and abandonment semantics
- history/heatmap shaping
- suggestion scoring

## What Should Stay Outside Core

Keep these outside the future package:

- WeChat messaging policy
- reminder queue creation
- prompt wording
- pulse orchestration
- runtime/session awareness

## Notes About Reminder

Habit should be able to say:

- this looks incomplete
- this can be nudged now
- this should be checked later

Habit should not directly enqueue reminders in core.

Reason:

- reminder is host infrastructure
- habit is decision support plus state

## Next Practical Refactor

The next code change should be Step 5:

- move host-only habit policies further out of core and keep plugin seams explicit

That is the smallest next change that improves package cleanliness without forcing behavior changes.
