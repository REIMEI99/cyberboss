# Reminder, Habit, Seedbox Philosophy

## Goal

Freeze the product semantics before the next refactor stage.

This document is about:

- what each module is for
- what each module is not for
- how they interact during `user_message`, `pulse`, and `reminder` triggers
- what should change first and what should wait

This document is intentionally earlier than any package split or schema migration.

## Core Position

Cyberboss should not behave like a todo app.

Its supporting modules are for:

- fuzzy follow-up
- contextual nudging
- soft continuity across time
- preserving things that matter before they disappear

The system should help with open loops that are easy to neglect, not force every intention into a hard task list.

## Module Roles

### Reminder

Keep the code and tool name `reminder` for now.

Product meaning:

- reminder is the default follow-up substrate
- reminder is a future re-entry anchor
- reminder answers the question: "how will I come back to this later?"

Reminder is the right default when something:

- should be checked later
- may slip
- depends on timing or future context
- is not urgent enough for a todo app
- should stay alive for either the user or the model

Reminder is for both sides:

- remind the user later
- remind the model to re-open a thread later

Reminder is not:

- a durable fact store
- a project planner
- a hard obligation tracker
- a replacement for the user's own todo system

### Habit

Product meaning:

- habit is a tracked soft commitment
- habit records recurring behavior expectations
- habit should produce completion history and heatmap-friendly state

Habit is softer than a todo, but harder than a casual reminder.

That means:

- it should track whether something was done today
- it should support `done`, `incomplete`, and `abandoned`
- it should not rely on pure conversational implication forever

Habit is not primarily a messaging feature.

Habit provides:

- state
- history
- completion evidence
- nudge suggestions

Habit should usually act through reminder when the right move is "check again later".

Habit is not:

- guilt machinery
- streak pressure for its own sake
- a generic task bucket

### Seedbox

Current code still says `task`. Product semantics should move toward `seedbox`.

Product meaning:

- seedbox stores unresolved, unexpanded, or someday-useful material
- seedbox is where the model keeps things that should not be lost but are not ready to become durable memory

Typical seedbox contents:

- something the user worries about but cannot unpack yet
- something the user wants to learn later
- something worth researching later
- something interesting to revisit
- a possible future thread, plan, or question

Seedbox is not a hard execution queue.

Seedbox is not:

- a sprint board
- a strict task manager
- a substitute for reminder

## Interaction Model

### User Message

When the user speaks, the model should answer the user first.

Then it should decide whether the message creates:

- a follow-up anchor -> `reminder`
- a habit state change -> `habit`
- a future exploration seed -> `seedbox`
- durable long-term knowledge -> `memory`

The important rule is closure:

- if the user says a habit is done, mark it
- if the user opens a loop that should be revisited, schedule reminder or explicitly decide not to
- if the user drops a future-interest item that should survive, capture it in seedbox

### Pulse

Pulse is a chance to review, not a duty to speak.

Pulse should check:

1. current context
2. habit state for today
3. relevant Obsidian signal
4. seedbox or other ongoing internal material
5. whether user contact is useful now
6. whether a follow-up reminder should be scheduled

If no message should be sent, pulse should still prefer one small private action.

### Reminder

Reminder is a due follow-up obligation.

At reminder time, the model should convert the reminder into the most useful present action:

- message the user
- check and update state
- reschedule if still genuinely open
- record something learned

Reminder should not be treated as optional pulse-style reflection.

## Priority Rules

### Default Follow-Up Rule

If the question is "what mechanism should preserve this open loop?", default to `reminder`.

That is why the code should keep `reminder` as the operational name for now. The mechanism is still reminder-shaped even if the product semantics are broader.

### Habit Closure Rule

Habit must not remain purely advisory.

When a habit is relevant, the model should usually do one of these:

1. remind the user now
2. schedule a reminder to revisit later
3. mark the habit state explicitly if the user already resolved it

The failure mode to avoid is:

- model notices habit
- sends a conversational nudge
- never updates the tracked state

### Seed Preservation Rule

If something matters enough to revisit but not enough to formalize, prefer seedbox over durable memory.

Memory should remain selective.

## Naming Decision

### Why not rename `reminder` to `followup` yet

Do not rename the module or tools yet.

Reasons:

- `reminder` is still the concrete mechanism
- `followup` is the product meaning, not necessarily the best implementation name
- rename cost is high across tools, storage, and prompts
- the current problem is semantic drift, not identifier scarcity

Recommended wording:

- `reminder`: follow-up substrate
- `habit`: tracked soft commitment
- `task` in current code: evolving toward `seedbox`

### Why pulse and checkin both exist

Current repo has a split between product semantics and implementation names:

- `pulse` is the trigger semantics exposed to the model
- `checkin` is still the host-side scheduler and command/config naming

So today:

- the model thinks in `pulse`
- the poller still runs as `checkin`
- some files, env vars, and commands still use `checkin`

This is acceptable short term, but it is naming debt.

The right interpretation is:

- `checkin` = legacy host/runtime label
- `pulse` = current behavioral meaning

## Non-Goals

This document does not require, yet:

- renaming files or tools
- changing storage schema
- extracting the habit package immediately
- turning tasks into a completely new database

Those changes should follow only after semantics are stable.

## Migration Order

### Phase 0. Freeze semantics

Done when this document is accepted and prompt/tool descriptions align with it.

### Phase 1. Prompt and tool-surface cleanup

Change only descriptions and decision rules.

Goals:

- make reminder the explicit default follow-up substrate
- make habit closure expectations explicit
- reframe `task` tool descriptions toward seed-like capture instead of execution pressure

No schema changes yet.

### Phase 2. Behavior closure

Goals:

- ensure user-stated habit completion gets marked reliably
- ensure open loops more reliably turn into reminders
- ensure pulse does one small private action instead of silently doing nothing

This is about model behavior and host guardrails, not naming.

#### Phase 2A. Habit closure

Desired behavior:

- if the user explicitly says a habit was done, the system should usually write `done`
- if the user clearly says it will not happen today, the system should usually write `abandoned`
- if the habit remains open, the system should either nudge now or schedule reminder, not merely notice it

Failure modes to prevent:

- habit is discussed but no state is written
- habit is left `incomplete` after the user already confirmed completion
- habit repeatedly generates chat nudges without a clean state transition

Expected guardrails:

- stronger prompt rule for explicit user confirmation
- optional host-side audit when a habit-heavy turn ends without any state write
- pulse/review summary should surface closure pressure clearly enough that the model cannot ignore it casually

Non-goal:

- do not force rigid streak pressure or guilt-based enforcement

#### Phase 2B. Follow-up closure

Desired behavior:

- when the user creates a future open loop, the system should either create reminder or explicitly decide no reminder is needed
- when pulse notices a future-relevant loose end, the default preservation path should be reminder
- when a reminder fires, the system should either act, reschedule, or resolve the loop

Failure modes to prevent:

- the model says it will remember but creates no reminder
- a loose end is noticed during pulse and then silently disappears
- due reminders are treated like optional reflections rather than obligations

Expected guardrails:

- `cyberboss_followup_decide` remains the preferred unified entry
- host-side audit may re-open missed follow-up creation
- reminder handling should encourage re-entry, not passive restatement

#### Phase 2C. Pulse closure

Desired behavior:

- `silent` should mean "a judgment was made and at least one small private action was considered or performed"
- private action may be context review, habit state action, reminder creation, seed capture, memory update, or Obsidian inspection

Failure mode to prevent:

- pulse becomes a no-op disguised as silence

Non-goal:

- do not turn every pulse into user interruption or busywork

### Phase 3. Seedbox semantic migration

Goals:

- reinterpret current task service around seed preservation
- narrow what "task" means in prompts and tools
- decide whether a later code rename is worth the churn

Possible outcomes:

- keep code name `task`, change semantics only
- later rename code and tools to `seedbox` after behavior stabilizes

Important clarification:

- Phase 3 is not merely variable renaming
- renaming is, at most, the last optional cleanup step
- the core work is changing module semantics, default usage, and field meaning

#### Phase 3A. Behavior semantics

Current behavior pressure:

- task implies work queue
- pulse treats task as something to advance
- task overlaps with reminder on follow-up

Target behavior:

- seedbox preserves future-useful material
- reminder owns time-based re-entry
- memory owns durable facts
- stone box owns interesting shareable fragments

The decision question should become:

- "Should this be preserved for future expansion?"

not:

- "Should this become an active managed task?"

#### Phase 3B. Field semantics

Current fields that need review:

- `kind`
- `goal`
- `status`
- `priority`
- `dueAt`
- `nextAction`
- `deliverable`

Expected migration direction:

- `goal` may remain, but should mean future value or preservation reason, not project objective
- `status` may remain temporarily for compatibility, but should stop implying full task-lifecycle pressure
- `priority` should be treated cautiously because it pulls the system toward queue management
- `dueAt` should be minimized because reminder is supposed to own time-based follow-up
- `nextAction` should become optional and secondary, not the defining feature
- `deliverable` should describe possible future output, not force an execution plan at creation time

#### Phase 3C. Storage and compatibility

Default stance:

- avoid schema churn until semantic behavior stabilizes
- preserve existing files and tool names if possible during early migration

That means Phase 3 should usually happen in this order:

1. change descriptions and default usage
2. change behavioral expectations
3. decide which fields are still meaningful
4. only then consider schema cleanup or rename

#### Phase 3D. Optional rename

Only after the above is stable should the project decide whether to rename:

- `agent-task-service`
- `cyberboss_task_*`
- prompt/documentation labels

Criteria for doing the rename:

- the system already behaves like seedbox in practice
- the remaining confusion is mostly identifier-level
- the migration cost across tools/docs/state is justified

If those criteria are not met, keep `task` as a compatibility name and continue using seedbox as the product semantics.

### Phase 4. Habit package extraction

Do this after semantics and behavior are stable.

Goals:

- keep `habit-core` focused on state/history/heatmap logic
- keep host policy outside core
- publish habit separately without dragging reminder or pulse orchestration into it

## Design Test

A design is correct if the model can answer these questions cleanly:

1. "Should this survive later?" -> usually `reminder` or `seedbox`
2. "Should this count as done today?" -> `habit`
3. "Should this become durable knowledge?" -> `memory`
4. "Should I message now?" -> pulse or reminder judgment
5. "If not now, how do I come back later?" -> usually `reminder`

If those answers are still blurry, the semantics are not stable enough for deeper refactors.
