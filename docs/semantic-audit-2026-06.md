# Semantic Audit 2026-06

## Scope

This audit records the post-refactor semantic state of:

- `reminder`
- `habit`
- `seedbox`
- `pulse` vs legacy `checkin`

This is a behavior and naming audit, not a package-boundary audit.

## Current Status

- `reminder`: aligned as the default follow-up substrate
- `habit`: aligned in state model; remaining risk is missed closure in real conversations
- `seedbox`: aligned as internal carry-over material, not a work queue
- `pulse`: aligned as the model-facing trigger semantics
- `checkin`: still the host-side scheduler/config naming

## What Was Completed

### Seedbox rename and semantics

Completed changes:

- service renamed to `src/services/seedbox-service.js`
- project service handle renamed from `agentTask` to `seedbox`
- tool family renamed to:
  - `cyberboss_seedbox_create`
  - `cyberboss_seedbox_list`
  - `cyberboss_seedbox_update`
  - `cyberboss_seedbox_complete`
- default storage file renamed to `seedbox.json`
- legacy read compatibility preserved through `agent-tasks.json`
- pulse review now refers to `seedbox`
- prompt and dispatcher wording now refer to `seedbox`

Semantic result:

- the module is now described and exposed as future-useful carry-over material
- reminder remains the owner of time-based re-entry
- memory remains the owner of durable facts

### Stone box removal

Completed changes:

- stone-box tools removed from model-visible surfaces
- stone-box service removed from active wiring
- dead `stone-box` service file deleted

Semantic result:

- there is no longer a competing “interesting finds” bucket in the active model workflow
- future-useful loose material now converges on `seedbox`

### Reminder closure strengthening

Completed changes:

- follow-up audit queues a pulse when user text implies later follow-up but no reminder was created
- pulse audit checks whether a silent internal turn skipped an obvious private action
- operations and dispatcher wording now explicitly push reminder creation as the default follow-up action

Semantic result:

- open loops are less likely to vanish into vague conversational memory

### Habit closure strengthening

Completed changes:

- host-side habit closure audit compares baseline and current daily state snapshots
- if the user appears to say “done”, “skip”, or equivalent but no habit write happened, a corrective pulse is queued

Semantic result:

- habit is no longer purely advisory in practice
- heatmap integrity is less dependent on perfect prompt obedience

## Remaining Gaps

### Gap 1. Habit completion can still miss on ambiguous phrasing

Current risk:

- explicit completion/abandonment is guarded better than before
- soft or indirect phrasing can still slip through without a state write

Next direction:

- improve completion detection or add a narrower closure helper path

### Gap 2. `pulse` vs `checkin` naming is still split

Current split:

- `pulse` = model-facing trigger semantics
- `checkin` = host scheduler, commands, config, and some docs

Assessment:

- behavior is coherent
- naming is still mixed for humans reading the repo

Next direction:

- leave it for a later readability pass unless it starts causing implementation mistakes

### Gap 3. Docs outside the core design set still lag

Likely stale areas:

- command docs
- README wording
- architecture summaries

Assessment:

- lower risk than behavior drift
- worth cleaning once the seedbox/habit split settles

## Audit Conclusion

The old `task` vs `seedbox` semantic mismatch is resolved in the active code path.

The main remaining semantic work is now:

1. habit closure reliability
2. reminder follow-up quality
3. repo-wide wording cleanup around `checkin`
