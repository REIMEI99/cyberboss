# Reminder, Habit, Memory Philosophy

## Goal

Define the stable product semantics for Cyberboss support modules.

The system should not behave like a todo app. It should preserve soft continuity, contextual nudging, and fuzzy follow-up without turning everything into pressure.

## Core Roles

### Reminder

Reminder is the default follow-up substrate.

Use reminder when something:

- should be revisited later
- depends on timing or future context
- may slip if nobody comes back to it
- should stay alive for either the user or the model

Reminder is for:

- reminding the user later
- reminding the model to reopen a thread later

Reminder is not:

- durable memory
- a planner
- a hard obligation tracker

### Habit

Habit is a tracked soft commitment.

Habit should provide:

- day state
- completion history
- heatmap-friendly records
- suggestion inputs

Habit is softer than todo, but harder than casual reminder. It should track `done`, `incomplete`, and `abandoned`.

Habit should usually act through reminder when the right move is “check again later”.

Habit is not:

- guilt machinery
- streak pressure for its own sake
- a generic catch-all queue

### Memory

Memory stores unresolved, unexpanded, or someday-useful material that should survive across turns, along with durable long-term knowledge. Relevant carry-over kinds include:

- `wishseed`: future things to do, items to try or buy, content to read or watch, saved links, half-formed ideas, and anything the user may want to revisit later.
- `concern`: unresolved worries, risks, or heavy matters that should stay on the radar.

Typical lifecycle memory contents:

- a worry the user has not unpacked yet (`concern`)
- something she wants to learn or try later (`wishseed`)
- a possible future thread (`wishseed`)
- a find, link, quote, product, or idea worth keeping (`wishseed`)

This lifecycle layer is not:

- a sprint board
- a strict task manager
- the default timing mechanism
- a place for model-facing workflow fields like `status`, `priority`, or `nextAction`

Reminder owns timing. Memory owns preservation.

## Trigger Model

### User Message

When the user speaks, the model should answer first, then decide whether the message creates:

- a follow-up anchor -> `reminder`
- a habit state change -> `habit`
- a future-useful preserved thread -> `memory` (usually `wishseed` or `concern`)
- durable long-term knowledge -> `memory`

Important closure rules:

- if the user says a habit is done, skipped, or abandoned, tracked state should usually change
- if the user opens a loop that should be revisited, create a reminder or clearly decide not to
- if the user drops future-useful material, capture it in memory, usually as `wishseed` or `concern`

### Pulse

Pulse is a soft review trigger, not a duty to speak.

Pulse should usually check:

1. current context
2. today’s habit state
3. relevant Obsidian signal
4. memory and other ongoing internal material
5. whether contact is useful now
6. whether a reminder should be scheduled

If no message should be sent, pulse should still prefer one small private action.

### Reminder

Reminder is a due re-entry obligation.

At reminder time, the model should convert it into the most useful present action:

- message the user
- reschedule if still genuinely open
- update habit or other state
- capture what was learned

Reminder should not degrade into vague optional reflection.

## Priority Rules

### Default Follow-Up Rule

If the question is “what preserves this open loop?”, default to `reminder`.

### Habit Closure Rule

Habit should not remain purely advisory.

When habit is relevant, the model should usually do one of:

1. remind now
2. schedule a reminder
3. mark the state explicitly

### Lifecycle Memory Rule

If something matters enough to revisit but not enough to formalize as a stable fact or preference, prefer `memory` with a lifecycle type such as `wishseed` or `concern`.

## Naming Notes

### Reminder vs follow-up

Keep `reminder` as the implementation and tool name. “Follow-up” is the product meaning; reminder is the concrete mechanism.

### Pulse vs checkin

The current split is behavioral:

- `pulse` = model-facing soft-trigger semantics for internal review turns such as audits, location/context nudges, or manual system triggers
- `checkin` = host scheduler/config naming for interval- or gap-driven reach-out

In particular, contact-gap triggering is now treated as `checkin`, not as ordinary `pulse`.

## Design Test

The design is behaving correctly if these questions have clean answers:

1. “Should this survive later?” -> usually `reminder` or `memory` (`wishseed` / `concern`)
2. “Should this count as done today?” -> `habit`
3. “Should this become durable knowledge?” -> `memory`
4. “Should I message now?” -> `pulse`, `checkin`, or `reminder` judgment depending on trigger strength
5. “If not now, how do I come back later?” -> usually `reminder`
