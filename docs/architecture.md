# Architecture

## Core

`core` is responsible for:

- reading config
- choosing which channel / runtime / integrations to use
- orchestrating capabilities instead of implementing concrete protocols
- owning trigger semantics such as user message, pulse, checkin, reminder, and approval flow

## Channel Adapters

`adapters/channel/*`

Responsible for:

- receiving messages
- sending messages
- typing / media / context token handling

Not responsible for:

- Codex / Claude Code thread logic
- reminder / habit / memory / timeline / diary logic

## Runtime Adapters

`adapters/runtime/*`

Responsible for:

- sending messages into the specific agent runtime
- handling thread / session / approval / stop
- injecting model-facing instruction layers and project-native tools

Not responsible for:

- WeChat protocol details
- timeline UI

## Local State Modules

The main local behavior/state modules are:

- `reminder`
  Follow-up substrate and future re-entry queue
- `habit`
  Daily completion state, history, and heatmap-oriented tracking
- `memory`
  Unified structured carry-over store for durable facts, preferences, and lifecycle material such as `wishseed` and `concern`

These modules are coordinated by app/runtime flow rather than treated as separate products.

## Capability Integrations

`integrations/*`

Examples:

- `timeline`
- `whereabouts`

External integrations should depend on standalone projects whenever possible, instead of being folded back into the main repository.

## Expected External Dependencies

- timeline:
  - `timeline-for-agent`
- weixin bridge:
  - to be split into a standalone adapter
- codex runtime:
  - to be split into a standalone adapter
