# Activity Review Phase 1 Checklist

## Objective

Phase 1 should make the new model usable without doing the full redesign all at once.

The target outcome is:

- activity threads become the main container for same-day and multi-step work
- activity review becomes a mandatory-send host-scheduled turn
- hard reminders remain separate and keep repeated follow-up behavior
- item completion becomes explicit and durable
- WeChat gets read-side `/activity` and `/reminder`

Phase 1 should not attempt:

- automatic activity splitting
- complex item ranking persistence
- rich item metadata
- full replacement of all existing reminder logic

## Scope Summary

Phase 1 should deliver:

1. minimal durable item status
2. per-activity review scheduling
3. independent hard reminder repeated follow-up
4. read-only WeChat list commands
5. post-turn audit behavior that prefers activity updates over reminder storms

## Decision Snapshot

These are the intended phase 1 decisions unless changed later:

- `activity_review` is mandatory-send
- `hard_reminder` is mandatory-send
- hard reminders re-fire every `5-10` minutes until resolved
- unfinished habit context is passed into `activity_review` as title list plus note overview
- item fields stay minimal

Open decision:

- whether `activity_review` and `hard_reminder` should have any cooldown interaction at all

Current recommendation:

- do not make that decision part of phase 1 storage design
- keep timing channels independent in code structure
- allow policy tuning later without migrating schema

## Files And Components Likely Touched

## Core storage / scheduling

- `src/services/activity-service.js`
- `src/app/system-checkin-poller.js`
- `src/core/app-background-ops.js`
- `src/core/system-message-queue-store.js`
- `src/tools/runtime-context-store.js`

## Core app flow

- `src/core/app.js`
- `src/core/app-runtime-events.js`
- `src/core/stream-delivery.js`
- `src/core/system-message-dispatcher.js`
- `src/core/command-registry.js`

## Existing reminder path

- `src/adapters/channel/weixin/reminder-queue-store.js`
- `src/services/reminder-service.js`

## WeChat command surface

- `src/core/app.js`
- `src/core/command-registry.js`
- `docs/commands.md`
- `README.md`

## Suggested Phase 1 Data Model

## Activity

Phase 1 activity object should stay simple:

```json
{
  "id": "activity-uuid",
  "title": "today's outing errands",
  "status": "open",
  "items": [],
  "nextReviewAt": "",
  "lastReviewedAt": "",
  "lastProgressAt": "",
  "reviewMinMinutes": 120,
  "reviewMaxMinutes": 360,
  "createdAt": "",
  "updatedAt": ""
}
```

Notes:

- `status` should remain activity-level only: `open | paused | done | archived`
- no persistent ranking cache in phase 1
- no dependency graph in phase 1

## Activity item

Phase 1 item object:

```json
{
  "id": "item-uuid",
  "text": "buy milk",
  "status": "open",
  "updatedAt": "",
  "doneAt": ""
}
```

Allowed statuses:

- `open`
- `done`
- `dropped`

## Hard reminder

Keep the existing reminder object mostly intact.
Phase 1 only needs:

- explicit repeated follow-up interval or interval policy
- optional link to `activityId`
- optional link to `itemId`

## Queue Design

Phase 1 should preserve two independent hard-trigger lines.

## Line 1: activity review queue

Purpose:

- due scan on activities
- enqueue mandatory-send `activity_review` turns

Suggested source / kind:

- `systemKind: "activity_review"` if you want a cleaner protocol split

or, if minimizing protocol churn:

- `systemKind: "pulse"`
- `systemSource: "activity_review"`

Recommended choice for phase 1:

- prefer explicit `systemSource: "activity_review"` first
- only add a new `systemKind` if the current dispatcher becomes too messy

## Line 2: hard reminder queue

Purpose:

- due scan on reminder deadlines
- repeated `5-10` minute re-contact until resolved

Suggested source / kind:

- `systemKind: "reminder"`
- `systemSource: "hard_reminder"`

Phase 1 rule:

- do not merge activity review and reminder queue semantics
- they may share the same queue file mechanically, but must remain distinct by source and policy

## Checklist By Workstream

## 1. Activity storage upgrade

Tasks:

- extend `activity-service.js` to support item status fields
- ensure existing activity records can load even if items are plain strings
- add normalization for legacy item values:
  - string item -> object with generated `id`, `text`, `status=open`
- add write helpers for:
  - add item
  - mark item done
  - mark item dropped
  - list items

Acceptance:

- old data still loads
- new writes always persist item objects
- phase 1 can show open vs done items durably

## 2. Activity review scheduling

Tasks:

- define how `nextReviewAt` is set for newly created activities
- add due-scan logic for activities
- enqueue one mandatory `activity_review` system message per due activity
- after dispatch, compute and persist the next review time

Minimum policy:

- if the activity stays open, always write a new `nextReviewAt`
- if the activity closes, clear `nextReviewAt`

Acceptance:

- one activity can keep reappearing without creating reminder storms
- review cadence is stored durably

## 3. Hard reminder repeated follow-up

Tasks:

- keep current due-reminder flow
- normalize default repeated follow-up interval to `5-10` minutes
- confirm reminder remains active until explicit resolution
- add optional activity link fields if helpful

Acceptance:

- unresolved reminders keep re-contacting
- reminder resolution semantics stay explicit

## 4. System message policy split

Tasks:

- add explicit policy branch for `activity_review`
- mandatory send for activity review
- mandatory send for hard reminder
- keep fallback message behavior for malformed model output

Acceptance:

- `activity_review` cannot return silent
- `hard_reminder` cannot return silent
- protocol errors still degrade safely to user-facing fallback text

## 5. Activity review prompt payload

Tasks:

- build one review payload containing:
  - activity title
  - open items
  - recently done items
  - last review time
  - last progress time
  - today's unfinished habit title list
  - each unfinished habit note overview
- keep the payload concise

Phase 1 rule:

- habits are passed as a compact overview block
- do not make the model choose only one habit ahead of time

Acceptance:

- model gets the full unfinished-habit summary for the day
- model can weave activity + habit into one mandatory message

## 6. Post-turn audit rewrite

Current problem:

- follow-up audit tends to create more pulse-like pressure
- legacy logic assumes reminder creation is the main closure path

Phase 1 target:

- when a user message implies ongoing multi-step work, prefer creating or updating an activity
- only create a hard reminder when the user or context provides a true time point

Tasks:

- review `app-runtime-events.js`
- review `trackPendingPostTurnAudit` in `app.js`
- change audit guidance so it prefers:
  - add activity
  - add activity item
  - update activity item state

over:

- immediate reminder creation for every near-term intention

Acceptance:

- same-day task clusters mostly become activities
- reminders become rarer and more time-specific

## 7. WeChat `/activity`

Phase 1 is read-only.

Tasks:

- add `/activity`
- add optional `/activity all`
- add optional `/activity <id>`

Default output should show:

- title
- open item count
- maybe done item count
- next review time
- top `1-2` open items

Detailed output should show:

- activity status
- open items
- done items

Acceptance:

- a user can inspect current activity state from WeChat without entering a model turn

## 8. WeChat `/reminder`

Phase 1 is read-only.

Tasks:

- add `/reminder`
- add optional `/reminder all`
- add optional `/reminder <id>`

Default output should show:

- reminder text
- due time
- whether it is still actively following up
- linked activity if available

Acceptance:

- a user can inspect hard reminders separately from activities

## 9. Command registry / docs

Tasks:

- register `/activity`
- register `/reminder`
- update `docs/commands.md`
- update `README.md`

Acceptance:

- docs match the implemented command surface

## 10. Migration handling

Tasks:

- load old activity item arrays safely
- do not require manual state resets
- avoid destructive migration

Recommended strategy:

- normalize on read
- write back in new shape on first mutation

Acceptance:

- old activity data survives
- no forced one-time migration script is required for phase 1

## Testing Checklist

## Storage tests

- loading legacy string items
- writing new object items
- marking item done
- marking item dropped

## Scheduler tests

- due activity creates one `activity_review`
- open activity gets a fresh `nextReviewAt` after review
- closed activity stops scheduling

## Reminder tests

- due reminder requeues follow-up every `5-10` minutes until resolved
- resolved reminder stops follow-up

## Command tests

- `/activity` renders open activities
- `/reminder` renders active reminders
- missing / invalid ids return safe help text

## Policy tests

- `activity_review` cannot return silent
- `hard_reminder` cannot return silent
- fallback text is used on malformed output

## Cooldown Decision Note

This needs a product decision, but not a schema decision.

### Known options

Option A:

- no cross-line cooldown at all
- `activity_review` and `hard_reminder` are fully independent

Option B:

- independent queues, but a very small presentation guard
- for example, if both fire within `1-2` minutes, the second message may be lightly merged or delayed

Option C:

- shared cooldown

Current recommendation:

- reject Option C

Reason:

- it couples two different semantics too early
- it makes debugging harder
- it reintroduces "which one ate my trigger?" ambiguity

Phase 1 recommendation:

- implement independent timing first
- if user experience shows visible over-contact, add a thin presentation-layer guard later
- do not encode shared cooldown into durable state

## Suggested Implementation Order

1. activity item storage normalization
2. mandatory `activity_review` source/policy
3. activity due-scan and next-review writeback
4. hard reminder repeated follow-up normalization
5. activity review payload with habit overview
6. `/activity` read-side command
7. `/reminder` read-side command
8. post-turn audit preference shift from reminders to activities
9. doc cleanup

This order keeps risk low while making the new mental model visible early.
