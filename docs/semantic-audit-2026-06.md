# Semantic Audit 2026-06

## Scope

This audit checks whether current code paths, tool descriptions, prompt surfaces, and docs match the target philosophy for:

- `reminder`
- `habit`
- current `task`, which is intended to evolve toward `seedbox`
- `pulse` vs legacy `checkin`

This is a semantic audit, not a storage-schema audit.

## Audit Result

### Overall status

- `reminder`: mostly aligned at both policy and tool-description layers; remaining work is behavior closure and consistent follow-up enforcement
- `habit`: mostly aligned in state design, partially misaligned in closure enforcement
- `task`: still materially misaligned at the service/data-semantics layer, even after prompt/tool wording improvements
- `pulse` vs `checkin`: behavior is coherent, naming is split across model-facing vs host-facing layers

The largest semantic gap is current `task`.

## What Is Already Aligned

### Reminder is already treated as the default follow-up substrate in prompt policy

Aligned surfaces:

- `templates/weixin-operations.md`
- `src/core/system-message-dispatcher.js`
- `cyberboss_followup_decide`

Evidence:

- the operations prompt explicitly says reminder is the default follow-up substrate
- the system dispatcher repeats that instruction for internal triggers
- `cyberboss_followup_decide` already turns follow-up judgment into reminder creation

Implication:

- high-level product semantics for reminder are already moving in the correct direction

### Habit state model is already close to the target product shape

Aligned surfaces:

- `src/habit/habit-state-service.js`
- `src/habit/habit-suggestion-engine.js`
- `src/habit/habit-tool-specs.js`
- `docs/habit-plugin-refactor.md`

Evidence:

- habits have day-state semantics
- history and heatmap export exist
- suggestion logic is separate from state logic
- packaging direction is now explicit

Implication:

- the main remaining problem is not state design, but making sure the state gets updated reliably during real interactions

### Pulse semantics are already model-facing

Aligned surfaces:

- `templates/weixin-operations.md`
- `src/core/system-message-dispatcher.js`
- `cyberboss_pulse_review`

Evidence:

- the model is instructed in terms of `user_message`, `pulse`, and `reminder`
- unified pulse review exists as a first-step tool

Implication:

- the behavioral vocabulary is already centered on `pulse`

## Semantic Mismatches

### Mismatch 1. `task` still means execution-oriented internal work in the service layer, not seedbox-like future material

Files:

- `src/services/agent-task-service.js`
- `src/tools/tool-host.js`
- `templates/weixin-operations.md`
- `src/core/system-message-dispatcher.js`

Evidence:

- service uses `TASK_STATUSES = pending, active, waiting, done, cancelled`
- service uses `TASK_PRIORITIES = low, normal, high`
- service sorts by status, priority, and due time
- `cyberboss_task_create` still requires `kind`, `title`, and `goal`
- task fields still include `status`, `priority`, `dueAt`, `nextAction`, and `deliverable`
- underlying storage and service behavior still describe a managed work queue even after wording cleanup

Why this is misaligned:

- this semantics describes a work queue
- seedbox is supposed to hold unresolved or unexpanded future material, not demand structured execution state
- due dates and active/done lifecycle create pressure toward project-management behavior

Observed rename pressure:

- code name: `agent-task-service`
- tool family: `cyberboss_task_*`
- prompt family label: `Task`
- pulse review includes tasks by default

Impact:

- model is more likely to treat these items as work to manage
- reminder and task overlap too much on follow-up
- user-facing philosophy drifts back toward todo-like behavior

### Mismatch 2. Pulse review still includes tasks by default, which may continue to over-emphasize them

Files:

- `src/tools/tool-host.js`

Evidence:

- `includeTasks` defaults to true
- pulse review still loads carry-over items unless explicitly disabled
- even with softened wording, default inclusion means this bucket remains salient during review

Why this is misaligned:

- pulse should primarily check context, habit, Obsidian signal, contact timing, and follow-up
- future material such as seedbox should be available, but it should not dominate the default internal action model

Impact:

- pulse keeps inheriting task-manager bias

### Mismatch 3. Reminder policy is mostly aligned, but behavior closure is still the remaining risk

Files:

- `src/tools/tool-host.js`
- `src/services/reminder-service.js`
- runtime behavior around missed follow-up creation

Evidence:

- tool wording now frames reminder as a future follow-up anchor
- service implementation supports queue-backed re-entry
- the remaining risk is not description drift but missed creation or weak follow-through in actual turns

Why this is still incomplete:

- open loops can still escape if the model does not convert them into reminders reliably enough

Impact:

- philosophy can be correct on paper while real follow-up behavior remains lossy

### Mismatch 4. Habit closure still depends too much on prompt compliance

Files:

- `templates/weixin-operations.md`
- `src/core/system-message-dispatcher.js`
- `src/habit/habit-tool-specs.js`
- runtime behavior around ordinary user replies

Evidence:

- prompts explicitly say to mark habit done when the user says it was done
- dedicated mark tools exist
- but there is no stronger host-level closure mechanism that guarantees the state update from conversational confirmation alone

Why this is misaligned:

- product goal is tracked soft commitment with reliable completion history
- purely advisory prompting is not enough when the model is inattentive

Impact:

- the model may message about habit successfully but fail to update the actual tracked state
- heatmap integrity becomes dependent on prompt obedience

### Mismatch 5. Tool-family language has improved, but `task` still inherits old semantics from the service layer

Files:

- `templates/weixin-operations.md`
- `src/core/system-message-dispatcher.js`

Evidence:

- prompt and dispatcher wording now describe task as internal carry-over material
- service name, field set, and ordering logic still encode a task-queue worldview

Why this is misaligned:

- under the new philosophy, this bucket should move closer to seed preservation rather than active work management

Impact:

- the model receives mixed signals even after the philosophy doc was added

## Naming Pressure Points

### `pulse` vs `checkin`

Files:

- `src/app/system-checkin-poller.js`
- `src/core/checkin-config-store.js`
- `src/core/command-registry.js`
- `package.json`
- `README.md`
- `README.en.md`
- `README.zh-CN.md`

Current split:

- `pulse` is the model-facing behavioral term
- `checkin` is still the scheduler, command, config, and README term

Assessment:

- this is naming debt, not a behavioral contradiction
- the split is understandable if interpreted as:
  - `pulse` = semantic trigger kind
  - `checkin` = legacy host wake-up mechanism label

Rename pressure:

- npm script `start:checkin`
- `/checkin <min>-<max>`
- `system.checkin_range`
- `checkin-config.json`

Recommendation:

- do not rename this first
- only rename after reminder/habit/task semantics stabilize

### `task` vs `seedbox`

Files:

- `src/services/agent-task-service.js`
- `src/tools/tool-host.js`
- prompt surfaces and docs

Assessment:

- this is the highest rename pressure area because the current name is tightly coupled to the wrong behavior expectations

Recommendation:

- first change semantics and descriptions
- later decide whether code/tool renaming is worth the churn

## Docs Drift

### Commands docs still use `checkin` terminology

Files:

- `docs/commands.md`

Assessment:

- acceptable for now because this file documents command/action surfaces, not model semantics
- still worth annotating later so readers know `checkin` corresponds to the pulse wake-up path

### README files explicitly explain `checkin`

Files:

- `README.md`
- `README.en.md`
- `README.zh-CN.md`

Assessment:

- not wrong
- but they currently explain host wake-up semantics more than the newer pulse/follow-up philosophy

### Architecture doc is too shallow for current semantics

Files:

- `docs/architecture.md`

Assessment:

- it describes broad repository layers
- it does not yet reflect reminder/habit/seedbox boundaries

## Risk Ranking

### Highest risk

1. `task` semantics continue to train the model toward execution-oriented internal work
2. habit completion may still fail to write state even after successful conversation

### Medium risk

1. low-level reminder tool wording lags behind policy wording
2. pulse review gives too much default salience to tasks

### Low risk

1. `pulse` vs `checkin` split causes confusion but not immediate behavioral failure
2. docs lag behind implementation philosophy

## Recommended Refactor Order

### Step 1. Fix prompt and tool descriptions for current `task`

Goal:

- keep storage and code names for now
- stop presenting the system as an execution queue

Status:

- done

Changes covered:

- `cyberboss_task_create`
- `cyberboss_task_list`
- `cyberboss_task_update`
- `cyberboss_task_complete`
- task family wording in prompts and dispatcher
- pulse review wording around tasks

### Step 2. Tighten habit closure behavior

Goal:

- reduce cases where conversational confirmation fails to become tracked state

Possible directions:

- stronger host-side reminder or audit
- more explicit tool-routing rule for user-confirmed completion
- optional closure helper tool later

### Step 3. Strengthen reminder/follow-up closure behavior

Goal:

- ensure open loops reliably become reminders or explicit no-reminder decisions
- ensure due reminders are acted on, rescheduled, or resolved cleanly

### Step 4. Re-evaluate whether current `task` should remain code-named `task`

Decision options:

- keep code/tool names and change semantics only
- rename prompt-facing language first and code later
- eventually rename implementation to seedbox if the behavior stabilizes and the churn is justified

### Step 5. Rename `checkin` only after the above is stable

Reason:

- this is mostly readability work
- it should not distract from the real semantic drift

## Audit Conclusion

The repo is no longer missing a reminder/habit philosophy.

The remaining problem is semantic unevenness across layers:

- prompts mostly know the new philosophy
- habit state design mostly matches it
- reminder policy mostly matches it
- current `task` implementation and presentation still belong to an older internal-work model

That makes `task` the main pressure point for the next refactor stage.
