const test = require("node:test");
const assert = require("node:assert/strict");

const { maybeQueueFollowupAudit, buildOpenActivityDigest } = require("../src/core/app-runtime-events");

// Minimal mock app that satisfies maybeQueueFollowupAudit + buildOpenActivityDigest.
function createMockApp({ activities = [], reminders = [] } = {}) {
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
    },
    systemMessageQueue: {
      enqueue(msg) { enqueued.push(msg); },
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
    originalText: "我去寄个快递",
    baselineReminderIds: [],
    baselineActivityIds: [],
    ...overrides,
  };
}

test("maybeQueueFollowupAudit returns false (no audit) when a new activity was added during the turn", async () => {
  const app = createMockApp({
    activities: [{ id: "a-new", title: "寄快递", items: [], createdAt: new Date().toISOString() }],
  });
  const audit = baseAudit({ baselineActivityIds: [] });
  const result = await maybeQueueFollowupAudit(app, audit);
  assert.equal(result, false);
  assert.equal(app.enqueued.length, 0);
});

test("maybeQueueFollowupAudit returns false when a new reminder was added during the turn", async () => {
  const app = createMockApp({
    reminders: [{ id: "r-new", accountId: "acct", senderId: "sender" }],
  });
  const audit = baseAudit({ baselineReminderIds: [] });
  const result = await maybeQueueFollowupAudit(app, audit);
  assert.equal(result, false);
  assert.equal(app.enqueued.length, 0);
});

test("maybeQueueFollowupAudit appends a pulse system message carrying open activities when nothing was added", async () => {
  const existing = [{ id: "a-old", title: "写报告", items: ["第一节", "第二节"], createdAt: new Date().toISOString() }];
  const app = createMockApp({ activities: existing });
  const audit = baseAudit({ baselineActivityIds: ["a-old"], originalText: "弄一下那个bug" });
  const result = await maybeQueueFollowupAudit(app, audit);
  assert.equal(result, true);
  assert.equal(app.enqueued.length, 1);
  const msg = app.enqueued[0];
  assert.equal(msg.kind, "pulse");
  assert.equal(msg.source, "followup_audit");
  assert.ok(msg.text.includes("弄一下那个bug"), "message includes original user text");
  assert.ok(msg.text.includes("Open activities:"), "message includes open activity digest");
  assert.ok(msg.text.includes("写报告"), "message includes existing activity title");
  assert.ok(msg.text.includes("items: 第一节; 第二节"), "message includes activity items");
  assert.ok(msg.text.includes("cyberboss_activity_add"), "message points to activity_add tool");
});

test("maybeQueueFollowupAudit message includes the hard rule that saying is not doing", async () => {
  const app = createMockApp({ activities: [] });
  const audit = baseAudit({ baselineActivityIds: [], originalText: "等下去寄快递" });
  await maybeQueueFollowupAudit(app, audit);
  const msg = app.enqueued[0];
  assert.ok(/does NOT mean they already did it/i.test(msg.text), "message states the saying!=doing hard rule");
});

test("buildOpenActivityDigest returns (none) when there are no open activities", () => {
  const app = createMockApp({ activities: [] });
  const digest = buildOpenActivityDigest(app);
  assert.equal(digest, "Open activities: (none)");
});

test("buildOpenActivityDigest lists titles, items and open age", () => {
  const old = new Date(Date.now() - 12 * 60 * 1000).toISOString();
  const app = createMockApp({
    activities: [
      { id: "a1", title: "买菜", items: ["番茄", "鸡蛋"], createdAt: old },
      { id: "a2", title: "看书", items: [], createdAt: new Date().toISOString() },
    ],
  });
  const digest = buildOpenActivityDigest(app);
  assert.ok(digest.includes("- 买菜 [items: 番茄; 鸡蛋] (open 12m)"));
  assert.ok(digest.includes("- 看书 (open 0m)"));
});