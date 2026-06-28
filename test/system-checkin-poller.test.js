const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCheckinTrigger,
  buildPulseTrigger,
  buildActivityReviewTrigger,
  pickPulseMemorySeeds,
} = require("../src/app/system-checkin-poller");

test("buildCheckinTrigger stays focused on contact-gap wording", () => {
  const trigger = buildCheckinTrigger(
    { userName: "Tester" },
  );

  assert.match(trigger, /contact-gap check-in fired/i);
  assert.doesNotMatch(trigger, /Random longer-life seeds to bring into this outreach:/);
});

test("buildPulseTrigger includes random longer-life seeds as natural outreach guidance", () => {
  const trigger = buildPulseTrigger(
    { userName: "Tester" },
    {
      memorySeeds: [
        { id: "m1", type: "wishseed", subject: "Read later", content: "That architecture book" },
        { id: "m2", type: "concern", subject: "Sleep drift", content: "Still sleeping too late this week" },
      ],
    }
  );

  assert.match(trigger, /Random longer-life seeds to bring into this outreach:/);
  assert.match(trigger, /\[wishseed\] Read later - That architecture book/);
  assert.match(trigger, /\[concern\] Sleep drift - Still sleeping too late this week/);
  assert.match(trigger, /naturally mention at least one of these seeds/i);
  assert.match(trigger, /Do not dump them as a list or sound like a reminder app/i);
});

test("pickPulseMemorySeeds prefers unseen wishseeds and records exposure", () => {
  let savedPatch = null;
  const runtimeContextStore = {
    getPulseExposureModule() {
      return {
        shownRounds: [["wish-old"], ["concern-old"]],
      };
    },
    setPulseExposureModule(workspaceRoot, moduleName, patch) {
      savedPatch = { workspaceRoot, moduleName, patch };
      return patch;
    },
  };
  const agentMemory = {
    list() {
      return {
        count: 4,
        memories: [
          { id: "wish-old", type: "wishseed", subject: "Old seed", content: "Old seed", status: "active" },
          { id: "wish-new", type: "wishseed", subject: "New seed", content: "Buy that lamp", status: "active" },
          { id: "concern-new", type: "concern", subject: "Neck pain", content: "Still stiff lately", status: "active" },
          { id: "fact-1", type: "fact", subject: "Ignore", content: "Ignore", status: "active" },
        ],
      };
    },
  };

  const picked = pickPulseMemorySeeds({
    agentMemory,
    runtimeContextStore,
    workspaceRoot: "/workspace",
    limit: 2,
  });

  assert.equal(picked.length, 2);
  assert.equal(picked[0].id, "wish-new");
  assert.equal(picked[1].id, "concern-new");
  assert.deepEqual(savedPatch, {
    workspaceRoot: "/workspace",
    moduleName: "pulse_memory_seeds",
    patch: {
      shownRounds: [["wish-old"], ["concern-old"], ["wish-new", "concern-new"]],
    },
  });
});

test("buildActivityReviewTrigger includes due activities and unfinished habit overview", () => {
  const trigger = buildActivityReviewTrigger(
    { userName: "Tester" },
    {
      activities: [
        {
          title: "Finish planning doc",
          items: [
            { text: "write scheduler section", status: "open" },
            { text: "close open questions", status: "done" },
          ],
        },
      ],
      habitSummary: {
        lines: [
          "Stretch - after lunch",
          "Read - 20 min before sleep",
        ],
      },
    }
  );

  assert.match(trigger, /scheduled activity review fired/i);
  assert.match(trigger, /Do not return silent/i);
  assert.match(trigger, /Finish planning doc/);
  assert.match(trigger, /write scheduler section/);
  assert.match(trigger, /Today's unfinished habits overview:/);
  assert.match(trigger, /Stretch - after lunch/);
});
