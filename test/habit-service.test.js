const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { HabitService } = require("../src/services/habit-service");

function createService() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-habit-test-"));
  return new HabitService({
    config: {
      habitDefinitionsFile: path.join(stateDir, "habit-definitions.json"),
      habitEventsFile: path.join(stateDir, "habit-events.jsonl"),
      habitStateFile: path.join(stateDir, "habit-state.json"),
    },
  });
}

test("habit service creates definitions and reports today's status", () => {
  const service = createService();
  const habit = service.upsertDefinition({
    title: "Eat supplements",
    preferredWindows: ["lunch", "before_sleep"],
    contexts: ["at_home", "after_meal"],
    avoidContexts: ["deep_work"],
    minimumVersion: "vitamin D only",
  });

  const status = service.statusToday({});
  assert.equal(status.count, 1);
  assert.equal(status.habits[0].habit.id, habit.id);
  assert.equal(status.habits[0].dailyState, "incomplete");
  assert.equal(status.habits[0].completedToday, false);
});

test("habit service suggests contextual low-shame nudges and respects completion", () => {
  const service = createService();
  const habit = service.upsertDefinition({
    id: "supplements",
    title: "Eat supplements",
    preferredWindows: ["lunch"],
    contexts: ["at_home", "after_meal"],
    minimumVersion: "vitamin D only",
    cooldownMinutes: 180,
  });

  const suggestion = service.suggestNextAction({
    context: "lunch at_home after_meal",
    userState: "low_cognitive_load",
  });
  assert.equal(suggestion.shouldContactUser, true);
  assert.equal(suggestion.suggestions[0].habitId, habit.id);
  assert.match(suggestion.suggestions[0].messageGuidance, /minimum viable version/i);

  service.markDone({ habitId: habit.id, note: "done after lunch" });
  const afterDone = service.suggestNextAction({
    context: "lunch at_home after_meal",
  });
  assert.equal(afterDone.shouldContactUser, false);
});

test("habit service daily state is mutually exclusive and can be changed", () => {
  const service = createService();
  const habit = service.upsertDefinition({
    id: "vitamin-b",
    title: "Take vitamin B",
    contexts: ["after_meal"],
  });

  service.markDone({ habitId: habit.id, note: "took it" });
  assert.equal(service.statusToday({ habitId: habit.id }).habits[0].dailyState, "done");

  service.markAbandoned({ habitId: habit.id, note: "too late; would hurt sleep" });
  const abandoned = service.statusToday({ habitId: habit.id }).habits[0];
  assert.equal(abandoned.dailyState, "abandoned");
  assert.equal(abandoned.completedToday, false);
  assert.equal(abandoned.abandonedToday, true);
  assert.equal(service.suggestNextAction({ context: "after_meal" }).shouldContactUser, false);

  service.markIncomplete({ habitId: habit.id, note: "reopened after correction" });
  const incomplete = service.statusToday({ habitId: habit.id }).habits[0];
  assert.equal(incomplete.dailyState, "incomplete");
  assert.equal(incomplete.incompleteToday, true);
  assert.equal(service.suggestNextAction({ context: "after_meal" }).shouldContactUser, true);
});

test("habit service legacy skipped maps to abandoned", () => {
  const service = createService();
  const habit = service.upsertDefinition({
    id: "supplements",
    title: "Eat supplements",
  });

  const event = service.markSkipped({ habitId: habit.id, note: "skip today" });
  const status = service.statusToday({ habitId: habit.id }).habits[0];

  assert.equal(event.type, "abandoned");
  assert.equal(status.dailyState, "abandoned");
});

test("habit service treats pre-4am events as the previous habit day", () => {
  const service = createService();
  const habit = service.upsertDefinition({
    id: "sleep-vitamins",
    title: "Avoid late vitamins",
  });

  service.markDone({
    habitId: habit.id,
    note: "logged after midnight",
    source: "test",
    createdAt: "2026-06-20T19:30:00.000Z",
  });

  assert.equal(service.statusToday({ habitId: habit.id, date: "2026-06-20" }).habits[0].dailyState, "done");
  assert.equal(service.statusToday({ habitId: habit.id, date: "2026-06-21" }).habits[0].dailyState, "incomplete");
});

test("habit service avoids nudges in avoid contexts and after recent nudges", () => {
  const service = createService();
  const habit = service.upsertDefinition({
    id: "water",
    title: "Drink water",
    contexts: ["at_home"],
    avoidContexts: ["deep_work"],
    cooldownMinutes: 180,
  });

  assert.equal(service.suggestNextAction({ context: "at_home deep_work" }).shouldContactUser, false);

  service.logEvent({ habitId: habit.id, type: "nudged", context: "at_home" });
  assert.equal(service.suggestNextAction({ context: "at_home" }).shouldContactUser, false);
});
