const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { ReminderQueueStore } = require("../src/adapters/channel/weixin/reminder-queue-store");

function createStore() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-reminder-queue-test-"));
  return new ReminderQueueStore({
    filePath: path.join(stateDir, "reminders.json"),
  });
}

test("reminder queue keeps due reminders active until explicitly completed", () => {
  const store = createStore();
  const reminder = store.enqueue({
    id: "r1",
    accountId: "acct",
    senderId: "user",
    contextToken: "ctx",
    text: "order food",
    dueAtMs: Date.now() - 1_000,
    followupDelayMinutes: 12,
    createdAt: "2026-06-21T00:00:00.000Z",
  });

  const due = store.listDue(Date.now());
  assert.equal(due.length, 1);
  assert.equal(store.listAll().length, 1);
  assert.equal(store.listAll()[0].id, reminder.id);

  const deferred = store.defer({
    id: reminder.id,
    dueAtMs: Date.now() + 60_000,
  });
  assert.equal(deferred.followupDelayMinutes, 12);
  assert.equal(deferred.triggerCount, 1);

  const completed = store.complete({ id: reminder.id });
  assert.equal(completed.id, reminder.id);
  assert.equal(store.listAll().length, 0);
});
