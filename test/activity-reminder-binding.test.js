const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { ActivityService } = require("../src/services/activity-service");
const { ReminderQueueStore } = require("../src/adapters/channel/weixin/reminder-queue-store");

function createActivityService() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-activity-test-"));
  return {
    service: new ActivityService({
      config: { activityFile: path.join(stateDir, "activities.json") },
    }),
    stateDir,
  };
}

function createReminderStore(stateDir) {
  return new ReminderQueueStore({
    filePath: path.join(stateDir, "reminders.json"),
  });
}

test("activity add stores normalized item objects and empty reminderId", () => {
  const { service } = createActivityService();
  const beforeMs = Date.now();
  const activity = service.add({
    title: "errands",
    items: ["buy fruit", "pick up package"],
    reminderId: "",
  });
  const afterMs = Date.now();
  assert.equal(activity.title, "errands");
  assert.equal(activity.status, "open");
  assert.equal(activity.reminderId, "");
  assert.equal(activity.items.length, 2);
  assert.equal(activity.items[0].text, "buy fruit");
  assert.equal(activity.items[0].status, "open");
  const nextReviewAtMs = Date.parse(activity.nextReviewAt || "");
  assert.ok(Number.isFinite(nextReviewAtMs));
  assert.ok(nextReviewAtMs >= beforeMs + 30 * 60_000);
  assert.ok(nextReviewAtMs <= afterMs + 60 * 60_000);
});

test("activity add without items defaults to empty array", () => {
  const { service } = createActivityService();
  const activity = service.add({ title: "quick task" });
  assert.deepEqual(activity.items, []);
});

test("activity bindReminder sets reminderId on open activity", () => {
  const { service } = createActivityService();
  const activity = service.add({ title: "test", reminderId: "" });
  const bound = service.bindReminder({ id: activity.id, reminderId: "rem-123" });
  assert.equal(bound.reminderId, "rem-123");
  const list = service.list({ limit: 10 });
  assert.equal(list.activities[0].reminderId, "rem-123");
});

test("activity addItem appends normalized item object", () => {
  const { service } = createActivityService();
  const activity = service.add({ title: "errands", items: ["task1"] });
  const updated = service.addItem({ id: activity.id, text: "task2" });
  assert.equal(updated.items.length, 2);
  assert.equal(updated.items[1].text, "task2");
  assert.equal(updated.items[1].status, "open");
});

test("activity item status can be marked done and dropped", () => {
  const { service } = createActivityService();
  const activity = service.add({ title: "errands", items: ["task1", "task2"] });
  const doneResult = service.markItemDone({ id: activity.id, itemId: activity.items[0].id });
  const droppedResult = service.markItemDropped({ id: activity.id, itemId: activity.items[1].id });
  assert.equal(doneResult.items[0].status, "done");
  assert.ok(doneResult.items[0].doneAt);
  assert.equal(droppedResult.items[1].status, "dropped");
});

test("activity complete closes thread and clears nextReviewAt", () => {
  const { service } = createActivityService();
  const activity = service.add({
    title: "test",
    items: ["a", "b"],
    reminderId: "rem-1",
    nextReviewAt: "2026-06-28T12:00:00.000Z",
  });
  const result = service.complete({ id: activity.id });
  assert.equal(result.status, "done");
  assert.equal(result.reminderId, "rem-1");
  assert.equal(result.nextReviewAt, "");
  assert.equal(service.list({ limit: 10 }).count, 0);
});

test("activity drop archives thread and clears nextReviewAt", () => {
  const { service } = createActivityService();
  const activity = service.add({
    title: "test",
    items: ["a"],
    reminderId: "rem-2",
    nextReviewAt: "2026-06-28T12:00:00.000Z",
  });
  const result = service.drop({ id: activity.id });
  assert.equal(result.status, "archived");
  assert.equal(result.reminderId, "rem-2");
  assert.equal(result.nextReviewAt, "");
  assert.equal(service.list({ limit: 10 }).count, 0);
});

test("normalizeActivity preserves items from persisted mixed legacy data", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-activity-persist-test-"));
  const activityFile = path.join(stateDir, "activities.json");
  fs.writeFileSync(activityFile, JSON.stringify({
    open: [{
      id: "persist-1",
      title: "persisted task",
      items: ["x", { id: "item-y", text: "y", status: "done", doneAt: "2026-06-28T10:00:00.000Z" }],
      reminderId: "rem-old",
      createdAt: "2026-06-22T00:00:00.000Z",
    }],
    done: [],
  }));
  const service = new ActivityService({ config: { activityFile } });
  const list = service.list({ limit: 10 });
  assert.equal(list.count, 1);
  assert.equal(list.activities[0].items[0].text, "x");
  assert.equal(list.activities[0].items[0].status, "open");
  assert.equal(list.activities[0].items[1].text, "y");
  assert.equal(list.activities[0].items[1].status, "done");
});

test("old activity data without items migrates to empty items array", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-activity-migrate-test-"));
  const activityFile = path.join(stateDir, "activities.json");
  fs.writeFileSync(activityFile, JSON.stringify({
    open: [{
      id: "old-1",
      title: "old task",
      reminderId: "rem-old",
      createdAt: "2026-06-22T00:00:00.000Z",
    }],
    done: [],
  }));
  const service = new ActivityService({ config: { activityFile } });
  const list = service.list({ limit: 10 });
  assert.equal(list.count, 1);
  assert.deepEqual(list.activities[0].items, []);
});

test("old open activity without nextReviewAt is backfilled with a review time", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-activity-review-backfill-test-"));
  const activityFile = path.join(stateDir, "activities.json");
  fs.writeFileSync(activityFile, JSON.stringify({
    activities: [{
      id: "old-open-1",
      title: "old open task",
      status: "open",
      items: [],
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-22T01:00:00.000Z",
    }],
  }));
  const service = new ActivityService({ config: { activityFile } });
  const activity = service.getById("old-open-1");
  assert.ok(activity);
  assert.ok(activity.nextReviewAt);
});

test("listDueReviews returns only open due activities", () => {
  const { service } = createActivityService();
  service.add({
    title: "due now",
    nextReviewAt: "2026-06-28T10:00:00.000Z",
  });
  const future = service.add({
    title: "future",
    nextReviewAt: "2026-06-29T10:00:00.000Z",
  });
  service.complete({ id: future.id });
  const due = service.listDueReviews(Date.parse("2026-06-28T12:00:00.000Z"));
  assert.equal(due.count, 1);
  assert.equal(due.activities[0].title, "due now");
});

test("reminder queue stores and retrieves activityId", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-reminder-activity-test-"));
  const store = createReminderStore(stateDir);
  const reminder = store.enqueue({
    id: "r1",
    accountId: "acct",
    senderId: "user",
    contextToken: "ctx",
    text: "do something",
    dueAtMs: Date.now() + 60_000,
    createdAt: "2026-06-22T00:00:00.000Z",
    activityId: "act-1",
  });
  assert.equal(reminder.activityId, "act-1");
  const all = store.listAll();
  assert.equal(all[0].activityId, "act-1");
});

test("reminder queue bindActivity sets activityId", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-reminder-bind-test-"));
  const store = createReminderStore(stateDir);
  const reminder = store.enqueue({
    id: "r1",
    accountId: "acct",
    senderId: "user",
    contextToken: "ctx",
    text: "do something",
    dueAtMs: Date.now() + 60_000,
    createdAt: "2026-06-22T00:00:00.000Z",
  });
  assert.equal(reminder.activityId, "");
  const bound = store.bindActivity({ id: reminder.id, activityId: "act-99" });
  assert.equal(bound.activityId, "act-99");
});
