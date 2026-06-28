# Activity / Review / Reminder Redesign

## Goal

Rewrite task-tracking around three separate concepts:

- `activity`: a living work thread or topic container
- `review loop`: the host/model cadence for mandatory re-contact on an activity
- `reminder`: a hard-time trigger for things with a real due point

This redesign exists to solve four current failures:

1. one activity grows too long because it is being used to suppress reminder explosion
2. the model loses track of which item is still open
3. the model sometimes marks item completion without explicit user confirmation
4. many same-day tasks would create too many reminders if each task becomes its own reminder

The core change is:

- do not bind one reminder to every activity item
- bind one mandatory `review loop` to an activity
- reserve `reminder` for hard-time obligations only

## Design Principles

### 1. Separate topic-tracking from time-tracking

`activity` stores what the user is trying to move.

`review loop` stores when the system should look at that activity again.

`reminder` stores a hard-time obligation.

These are different concerns and should not be overloaded into one object.

### 2. Default to activity review, not to per-item alarm

Most everyday life tasks are not "message me exactly at 18:40".
They are "check back on this thread later and see what matters now".

Therefore:

- household clusters
- errands
- admin piles
- "today I should probably do these"

should default to activity review loops, not hard reminders.

### 3. Completion must be explicit

The model must not mark an activity item `done` unless the user clearly said it is done.

Allowed evidence:

- "done"
- "finished"
- "already did it"
- "I took it"
- "I bought it"
- "I sent it"

Not enough:

- "I'll do it"
- "later"
- "probably"
- "I should"
- "remind me"
- model inference from context alone

### 4. Reduce user-facing noise by batching review

If the user has ten things to do today, the system should not create ten separate nudges.

Instead:

- create one or a few activities
- assign a review loop to each activity
- at each review, select only the most relevant `1-3` open items to mention

## Core Model

## Activity

An activity is a topic container with its own review cadence.

Examples:

- "today's outing errands"
- "monday project push"
- "kitchen reset"
- "weekend laundry block"

Suggested fields:

```json
{
  "id": "activity-uuid",
  "title": "today's outing errands",
  "status": "open",
  "kind": "task_cluster",
  "summary": "A same-day bundle of outside errands and quick purchases.",
  "items": [],
  "tags": ["today", "errands"],
  "priority": "normal",
  "createdAt": "2026-06-28T08:00:00.000Z",
  "updatedAt": "2026-06-28T08:00:00.000Z",
  "lastReviewedAt": "",
  "lastUserProgressAt": "",
  "nextReviewAt": "",
  "reviewPolicy": {},
  "source": {
    "type": "user_message",
    "turnId": "..."
  }
}
```

`status` at activity level:

- `open`
- `paused`
- `done`
- `archived`

Activity-level `done` means the thread is closed, not that every historical item vanished.

## Activity Item

An item is an atomic step inside an activity.

Suggested fields:

```json
{
  "id": "item-uuid",
  "text": "buy milk",
  "status": "open",
  "order": 20,
  "createdAt": "2026-06-28T08:00:00.000Z",
  "updatedAt": "2026-06-28T08:00:00.000Z",
  "completedAt": "",
  "droppedAt": "",
  "notes": ""
}
```

Keep item fields intentionally small in phase 1.
Do not add rich priority, dependency, scoring, or note structures yet.
The durable item contract should stay close to:

- `id`
- `text`
- `status`
- optional `updatedAt`
- optional `doneAt`

Item status:

- `open`
- `done`
- `dropped`
- optional later: `deferred`

Important rule:

- `done` only from explicit user evidence
- `dropped` only from explicit user evidence or direct user command
- never auto-delete item history just to make prompts shorter

## Review Loop

The review loop is the scheduler attached to an activity.

It does not mean "maybe check this if convenient".
It means "when due, create a mandatory activity-review turn that must send a user-facing message".

Suggested fields:

```json
{
  "mode": "adaptive",
  "minIntervalMinutes": 120,
  "maxIntervalMinutes": 360,
  "nextReviewAt": "2026-06-28T14:00:00.000Z",
  "lastReviewAt": "2026-06-28T10:00:00.000Z",
  "quietHoursAware": true,
  "maxItemsPerMessage": 3
}
```

### Review loop responsibilities

- decide next review time for each activity
- reduce reminder explosion
- keep one activity alive with periodic mandatory follow-up
- batch many open items into one user-facing outreach

### Reminder responsibilities

`reminder` is only for hard-time obligations:

- "leave at 18:30"
- "doctor appointment at 9 tomorrow"
- "submit before monday 11:00"
- "take medicine at dinner"

If an obligation has a real due point, use `reminder`.
If it only needs revisiting, use `activity review`.

## Trigger Semantics

The redesigned system has two independent hard-trigger lines:

- `activity_review`
- `hard_reminder`

Both must send a message.
They do not share cooldown.
They do not cancel each other.
They do not consume each other's trigger budget.

The difference is semantic:

- `activity_review` = thread-level hard follow-up
- `hard_reminder` = clock-time hard follow-up

## Hard Reminder Follow-up

Hard reminders are not one-shot.

Rules:

- at `dueAt`, the reminder must send
- if the user does not resolve it, the reminder remains active
- unresolved reminders should re-contact every `5-10` minutes by default
- this repeats until the user:
  - marks it done
  - turns it off
  - changes the time
  - or a tool operation explicitly resolves it

This follow-up cadence belongs only to the hard reminder line.
It must not block, delay, or consume activity review cadence.

## Review Decision Flow

Each due activity review should go through this pipeline.

### Step 1. Load the activity

Load:

- activity metadata
- open items
- recently completed items
- last review time
- last user progress time
- any linked hard reminders
- current context such as quiet hours, recent user activity, active reminders, location, memory, diary, obsidian, timeline
- today's unfinished habit overview:
  - unfinished habit title list
  - each unfinished habit's note / minimal note text if available

### Step 2. Re-rank open items

Score open items using lightweight heuristics:

- user mentioned it recently
- same-day urgency
- context fit right now
- low effort / easy win
- dependency ordering
- repeated neglect

Do not score based on model fantasy completion.

### Step 3. Build one mandatory send

An activity review does not decide whether to send.
It must send.

The actual decision space is:

1. which open activity item should lead
2. whether to mention one more open item
3. how to summarize today's unfinished habits
4. what the next review interval should be
5. whether the activity should stay open or close

### Step 4. If sending, select only a subset

Never dump the whole activity unless the user explicitly asked for the list.

Default:

- mention at most `1-3` open items
- prefer the most context-relevant subset
- summarize the rest, if needed, as "the rest can wait"

### Step 5. Commit state updates

Allowed review-time state writes:

- advance `lastReviewedAt`
- compute `nextReviewAt`
- create or clear linked review queue entries
- add notes
- suggest splits

Not allowed without explicit user evidence:

- mark item `done`
- mark item `dropped`
- delete item

## Review Output

## Mandatory `send_message`

Send a short natural message when:

- the activity review becomes due

This is mandatory.
The review turn is not allowed to return `silent`.

Message style:

- mention one main item
- optionally mention a second low-friction item
- include a compact unfinished-habit overview when relevant
- do not list all activity items
- do not sound like a task app

Example:

> 你这会儿如果正好要出门，先把牛奶和快递一起处理掉会比较顺，裤子退货可以放下一轮。

## Close / keep open

Close only when:

- all items are explicitly done or dropped
- or the user clearly says the thread is no longer needed

Closing writes `status=done` or `status=archived`.

## How Review Timing Should Work

The scheduler should operate per activity, not per item.

### Default review policy

Suggested starter defaults:

- same-day errand/activity cluster: `60-180` minutes
- larger project push: `180-480` minutes
- paused activity: no automatic review unless reactivated

Linked hard reminders do not suppress activity review by default.
They are separate hard lines.

### Adaptive adjustments

The next review time should adapt based on:

- last user progress time
- how many open items remain
- whether the user ignored the last nudge
- whether the activity is same-day
- whether the context is favorable right now
- how many unfinished habits exist today

Example rules:

- user just made progress: back off
- no progress for a long time on a same-day cluster: come back sooner
- repeatedly irrelevant item cluster: widen interval
- hard deadline approaching: convert relevant part to reminder

## How To Prevent Oversized Activities

Long activities are allowed, but only with structure.

### Threshold policy

Suggested thresholds:

- `1-5` open items: normal
- `6-10` open items: warning zone, prioritize sorting and grouping
- `11+` open items: must split or stage

### Split strategies

When an activity gets too long, the system should not silently delete items.
It should choose one of these:

1. split by time
- `today`
- `later this week`

2. split by place
- `home`
- `outside`

3. split by mode
- `quick wins`
- `deep work`

4. split by dependency
- `before leaving`
- `after coming back`

The split should be explicit in state, not just prompt wording.

## Item Completion Policy

The current bug is that the model sometimes marks completion without user mention.
The redesign must make that structurally hard.

### Allowed completion transitions

Only these should set item `done`:

- explicit user message
- explicit `/activity done ...` command later, if added
- explicit tool operation called by the model after user confirmation

### Disallowed completion transitions

These must not set item `done`:

- inferred from elapsed time
- inferred from location
- inferred from the model's own earlier suggestion
- inferred from "probably already"

### Suggested internal review label

The model may use an internal non-persistent concept like:

- `maybe_done_candidate`

But this must stay internal and must not overwrite durable state.

## Relationship Between Activity Review And Reminder

### Activity review drives hard thread follow-up

Use for:

- clusters
- unfinished threads
- same-day bundles
- life-admin
- errands
- open loops with no precise due point

### Reminder drives hard clock-time follow-up

Use for:

- calendar-like due moments
- medication timing
- leave-now deadlines
- externally committed submission times

### Linking behavior

An activity may optionally link to reminders.

Example:

- activity: `monday project push`
- reminder: `send doc before monday 11:00`

The activity remains the container.
The reminder is only the hard deadline edge.

Important:

- `activity_review` and `hard_reminder` do not share cooldown
- `activity_review` firing does not postpone a hard reminder
- `hard_reminder` firing does not postpone an activity review
- each line should track its own last-send / next-send timing independently

## WeChat Command Surface

The redesign should expose human-readable list commands in WeChat.

## `/activity`

Purpose:

- show current activities for the bound workspace/chat

Suggested forms:

- `/activity`
  Show the current open activities summary.
- `/activity all`
  Show open + paused + recent done.
- `/activity <id>`
  Show one activity in detail.
- `/activity today`
  Show activities tagged or scored as today-relevant.

Default `/activity` output should be compact:

```text
Open activities
1. today's outing errands
   open items: 4
   next review: in 2h
   top open: buy milk / pick up package

2. monday project push
   open items: 3
   next review: tonight
   top open: revise prompt / connect MCP list
```

Detailed `/activity <id>` output:

```text
Activity: today's outing errands
Status: open
Next review: 14:00

Open
- buy milk
- pick up package
- return pants

Done
- order lunch
```

Important:

- do not dump all archived history by default
- open items first
- done items folded into a short section

## `/reminder`

Purpose:

- show current hard reminders, not activity review loops

Suggested forms:

- `/reminder`
  Show active reminders due later.
- `/reminder all`
  Show active + overdue.
- `/reminder <id>`
  Show one reminder detail.

Default output should answer:

- what is due
- when
- which activity, if linked

Example:

```text
Active reminders
1. send doc before monday 11:00
   due: 2026-06-29 11:00
   linked activity: monday project push

2. take medicine with dinner
   due: today 19:00
```

## Optional future command surface

Not required for phase 1, but compatible later:

- `/activity split <id>`
- `/activity pause <id>`
- `/activity done <id>`
- `/activity review <id>`
- `/activity archive <id>`
- `/reminder done <id>`

Phase 1 only needs read-side list commands:

- `/activity`
- `/reminder`

## Host / Model Responsibilities

## Host responsibilities

- maintain activity storage
- maintain item storage
- maintain review schedule queue
- maintain hard reminder queue
- expose `/activity` and `/reminder` query commands
- provide tool operations with explicit status transitions

## Model responsibilities

- create and update activities/items
- choose review phrasing
- choose which subset of items to mention
- summarize unfinished habits as title list plus note overview
- avoid unauthorized completion writes
- decide when an activity should split
- decide when a hard reminder is required

## Recommended Tool Changes

This doc does not implement code yet, but the design assumes these tool families eventually exist.

### Activity tools

- `cyberboss_activity_create`
- `cyberboss_activity_list`
- `cyberboss_activity_get`
- `cyberboss_activity_update`
- `cyberboss_activity_close`

### Activity item tools

- `cyberboss_activity_item_add`
- `cyberboss_activity_item_update`
- `cyberboss_activity_item_mark_done`
- `cyberboss_activity_item_mark_dropped`
- `cyberboss_activity_item_list`

### Review scheduling tools

- `cyberboss_activity_review_schedule`
- `cyberboss_activity_review_list_due`
- `cyberboss_activity_review_defer`

### Reminder tools

Existing reminder tools can remain, but should accept optional linking:

- `linkedActivityId`
- `linkedItemId`

## Migration Strategy

Do not attempt a big-bang rewrite.

### Phase 1

- define the new model in docs
- add read-side `/activity` and `/reminder`
- stop auto-completing item state without user evidence

### Phase 2

- create per-activity mandatory-send review scheduling
- reduce dependence on per-item reminder creation
- keep reminder repeated-follow-up behavior only for hard deadlines

### Phase 3

- add item-level status transitions
- add activity split support
- update post-turn audit to create or update activities without spawning reminder storms

### Phase 4

- tune adaptive review timing
- refine selection of top items per review
- add optional command actions for power users

## Open Questions

These should be settled before implementation:

1. should review loops live in the same file as activities or in a separate queue file?
2. should item history be append-only event log or in-place state objects?
3. should `/activity` list only current chat scope or all activities for the workspace?
4. should activity review be one global poller queue or per-workspace due scan?
5. when splitting an activity, should child activities inherit the same review policy or get fresh defaults?

## Recommended Decision

For the first implementation:

- keep activity state in one durable file
- keep review schedule in a separate queue/index file
- make `/activity` scoped to current bound workspace/chat by default
- keep reminders separate and explicit
- require explicit user evidence for all durable completion writes

This gives the smallest rewrite that still fixes the current structural problem.
