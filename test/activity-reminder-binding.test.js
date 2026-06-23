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

test("activity add stores items and empty reminderId", () => {
  const { service } = createActivityService();
  const activity = service.add({
    title: "errands",
    items: ["buy fruit", "pick up package"],
    reminderId: "",
  });
  assert.equal(activity.title, "errands");
  assert.deepEqual(activity.items, ["buy fruit", "pick up package"]);
  assert.equal(activity.reminderId, "");
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

test("activity bindReminder throws for unknown id", () => {
  const { service } = createActivityService();
  assert.throws(() => service.bindReminder({ id: "nonexistent", reminderId: "r" }), /Activity not found/);
});

test("activity addItem appends to open activity", () => {
  const { service } = createActivityService();
  const activity = service.add({ title: "errands", items: ["task1"] });
  const updated = service.addItem({ id: activity.id, text: "task2" });
  assert.deepEqual(updated.items, ["task1", "task2"]);
  const list = service.list({ limit: 10 });
  assert.equal(list.activities[0].items.length, 2);
});

test("activity addItem throws for unknown id", () => {
  const { service } = createActivityService();
  assert.throws(() => service.addItem({ id: "nope", text: "x" }), /Activity not found/);
});

test("activity complete returns items and reminderId", () => {
  const { service } = createActivityService();
  const activity = service.add({ title: "test", items: ["a", "b"], reminderId: "rem-1" });
  const result = service.complete({ id: activity.id });
  assert.equal(result.reminderId, "rem-1");
  assert.deepEqual(result.items, ["a", "b"]);
  assert.equal(service.list({ limit: 10 }).count, 0);
});

test("activity drop returns items and reminderId", () => {
  const { service } = createActivityService();
  const activity = service.add({ title: "test", items: ["a"], reminderId: "rem-2" });
  const result = service.drop({ id: activity.id });
  assert.equal(result.reminderId, "rem-2");
  assert.deepEqual(result.items, ["a"]);
  assert.equal(service.list({ limit: 10 }).count, 0);
});

test("normalizeActivity preserves items from persisted data", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-activity-persist-test-"));
  const activityFile = path.join(stateDir, "activities.json");
  fs.writeFileSync(activityFile, JSON.stringify({
    open: [{
      id: "persist-1",
      title: "persisted task",
      items: ["x", "y"],
      reminderId: "rem-old",
      createdAt: "2026-06-22T00:00:00.000Z",
    }],
    done: [],
  }));
  const service = new ActivityService({ config: { activityFile } });
  const list = service.list({ limit: 10 });
  assert.equal(list.count, 1);
  assert.deepEqual(list.activities[0].items, ["x", "y"]);
  assert.equal(list.activities[0].reminderId, "rem-old");
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
  const all = store.listAll();
  assert.equal(all[0].activityId, "act-99");
});

test("reminder queue without activityId defaults to empty string", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-reminder-default-test-"));
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
});

test("1:1 binding flow: create activity, create reminder with activityId, bindReminder back", () => {
  const { service, stateDir } = createActivityService();
  const reminderStore = createReminderStore(stateDir);

  // Step 1: create activity with empty reminderId
  const activity = service.add({ title: "write report", items: ["draft", "review"], reminderId: "" });
  assert.equal(activity.reminderId, "");

  // Step 2: create reminder with activityId
  const reminder = reminderStore.enqueue({
    id: "rem-flow-1",
    accountId: "acct",
    senderId: "user",
    contextToken: "ctx",
    text: "check on report",
    dueAtMs: Date.now() + 600_000,
    createdAt: "2026-06-22T00:00:00.000Z",
    activityId: activity.id,
  });
  assert.equal(reminder.activityId, activity.id);

  // Step 3: bind reminderId back to activity
  service.bindReminder({ id: activity.id, reminderId: reminder.id });
  const list = service.list({ limit: 10 });
  assert.equal(list.activities[0].reminderId, "rem-flow-1");

  // Step 4: complete activity, then complete reminder
  const completed = service.complete({ id: activity.id });
  assert.equal(completed.reminderId, "rem-flow-1");
  reminderStore.complete({ id: "rem-flow-1" });
  assert.equal(reminderStore.listAll().length, 0);
  assert.equal(service.list({ limit: 10 }).count, 0);
});

test("orphan reminder with check-back text gets completed, not activity-created", () => {
  const { service, stateDir } = createActivityService();
  const reminderStore = createReminderStore(stateDir);

  // Simulate old system: reminder with check-back text, no activityId
  const reminder = reminderStore.enqueue({
    id: "rem-stale-1",
    accountId: "acct",
    senderId: "user",
    contextToken: "ctx",
    text: "Activity check-back. Call cyberboss_activity_list to see all open activities.",
    dueAtMs: Date.now() - 1_000,
    createdAt: "2026-06-22T00:00:00.000Z",
  });
  assert.equal(reminder.activityId, "");

  // Simulate reconcileOrphanReminder logic
  const openActivities = service.list({ limit: 50 }).activities;
  const hasBoundActivity = openActivities.some((a) => a.reminderId === reminder.id);
  assert.equal(hasBoundActivity, false);

  // Since text includes "Activity check-back", complete it
  reminderStore.complete({ id: reminder.id });
  assert.equal(reminderStore.listAll().length, 0);
  // No activity should have been created
  assert.equal(service.list({ limit: 50 }).count, 0);
});

test("standalone reminder can be replaced by a new activity-reminder pair", () => {
  const { service, stateDir } = createActivityService();
  const reminderStore = createReminderStore(stateDir);

  const oldReminder = reminderStore.enqueue({
    id: "rem-orphan-1",
    accountId: "acct",
    senderId: "user",
    contextToken: "ctx",
    text: "call mom",
    dueAtMs: Date.now() - 1_000,
    createdAt: "2026-06-22T00:00:00.000Z",
  });
  assert.equal(oldReminder.activityId, "");

  const activity = service.add({ title: "call mom", reminderId: "" });
  const newReminder = reminderStore.enqueue({
    id: "rem-activity-1",
    accountId: "acct",
    senderId: "user",
    contextToken: "ctx",
    text: "Check-back: call mom",
    dueAtMs: Date.now() + 10 * 60_000,
    createdAt: "2026-06-22T00:00:00.000Z",
    activityId: activity.id,
  });
  service.bindReminder({ id: activity.id, reminderId: newReminder.id });
  reminderStore.complete({ id: oldReminder.id });

  const reminders = reminderStore.listAll();
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].id, "rem-activity-1");
  assert.equal(reminders[0].activityId, activity.id);
  const updatedActivity = service.list({ limit: 50 }).activities[0];
  assert.equal(updatedActivity.reminderId, "rem-activity-1");
});
