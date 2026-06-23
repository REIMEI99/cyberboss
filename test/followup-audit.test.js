const test = require("node:test");
const assert = require("node:assert/strict");

const { maybeQueuePostTurnAudit, buildOpenActivityDigest } = require("../src/core/app-runtime-events");

function createMockApp({ activities = [], reminders = [], habitSnapshot = null } = {}) {
  const enqueued = [];
  return {
    enqueued,
    reminderQueue: {
      listAll: () => reminders.slice(),
    },
    projectServices: {
      activity: {
        allIds: () => activities.map((a) => a.id),
        list: ({ limit = 20 } = {}) => ({ count: activities.length, activities: activities.slice(0, limit) }),
      },
      habit: {
        getTodayClosureSnapshot: () => habitSnapshot,
      },
    },
    systemMessageQueue: {
      enqueue(message) {
        enqueued.push(message);
      },
    },
  };
}

function baseAudit(overrides = {}) {
  return {
    threadId: "t1",
    turnId: "turn1",
    bindingKey: "bk",
    workspaceRoot: "/ws",
    accountId: "acct",
    senderId: "sender",
    originalText: "I will handle the package soon",
    shouldAuditFollowup: true,
    shouldAuditHabit: false,
    baselineReminderIds: [],
    baselineActivityIds: [],
    ...overrides,
  };
}

test("maybeQueuePostTurnAudit returns false when a new activity was added during the turn", async () => {
  const app = createMockApp({
    activities: [{ id: "a-new", title: "ship package", items: [], createdAt: new Date().toISOString() }],
  });
  const result = await maybeQueuePostTurnAudit(app, baseAudit());
  assert.equal(result, false);
  assert.equal(app.enqueued.length, 0);
});

test("maybeQueuePostTurnAudit returns false when a new reminder was added during the turn", async () => {
  const app = createMockApp({
    reminders: [{ id: "r-new", accountId: "acct", senderId: "sender" }],
  });
  const result = await maybeQueuePostTurnAudit(app, baseAudit());
  assert.equal(result, false);
  assert.equal(app.enqueued.length, 0);
});

test("maybeQueuePostTurnAudit enqueues one unified audit when follow-up was missed", async () => {
  const existing = [{ id: "a-old", title: "write report", items: ["draft", "review"], createdAt: new Date().toISOString() }];
  const app = createMockApp({ activities: existing });
  const result = await maybeQueuePostTurnAudit(app, baseAudit({
    baselineActivityIds: ["a-old"],
    originalText: "I will fix that bug next",
  }));
  assert.equal(result, true);
  assert.equal(app.enqueued.length, 1);
  const msg = app.enqueued[0];
  assert.equal(msg.kind, "pulse");
  assert.equal(msg.source, "post_turn_audit");
  assert.ok(msg.text.includes("I will fix that bug next"));
  assert.ok(msg.text.includes("Open activities:"));
  assert.ok(msg.text.includes("write report"));
  assert.ok(msg.text.includes("cyberboss_activity_add"));
});

test("maybeQueuePostTurnAudit includes the saying-is-not-doing rule", async () => {
  const app = createMockApp({ activities: [] });
  await maybeQueuePostTurnAudit(app, baseAudit({
    baselineActivityIds: [],
    originalText: "I will do it later",
  }));
  assert.match(app.enqueued[0].text, /does NOT mean they already did it/i);
});

test("maybeQueuePostTurnAudit can also flag missing habit closure in the same audit", async () => {
  const snapshot = { date: "2026-06-23", habitCount: 1, stateEventCount: 3, signature: "abc" };
  const app = createMockApp({ activities: [], habitSnapshot: snapshot });
  const result = await maybeQueuePostTurnAudit(app, baseAudit({
    shouldAuditFollowup: false,
    shouldAuditHabit: true,
    baselineHabitClosureSnapshot: snapshot,
    originalText: "I already took it",
  }));
  assert.equal(result, true);
  assert.equal(app.enqueued.length, 1);
  assert.equal(app.enqueued[0].source, "post_turn_audit");
  assert.ok(app.enqueued[0].text.includes("No habit state change was detected during that turn."));
});

test("buildOpenActivityDigest returns none when there are no open activities", () => {
  const app = createMockApp({ activities: [] });
  assert.equal(buildOpenActivityDigest(app), "Open activities: (none)");
});

test("buildOpenActivityDigest lists titles, items and open age", () => {
  const old = new Date(Date.now() - 12 * 60 * 1000).toISOString();
  const app = createMockApp({
    activities: [
      { id: "a1", title: "buy food", items: ["eggs", "fruit"], createdAt: old },
      { id: "a2", title: "read", items: [], createdAt: new Date().toISOString() },
    ],
  });
  const digest = buildOpenActivityDigest(app);
  assert.ok(digest.includes("- buy food [items: eggs; fruit] (open 12m)"));
  assert.ok(digest.includes("- read (open 0m)"));
});
