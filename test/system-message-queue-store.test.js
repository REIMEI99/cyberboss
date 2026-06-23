const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { SystemMessageQueueStore } = require("../src/core/system-message-queue-store");

function createStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-system-queue-test-"));
  return new SystemMessageQueueStore({ filePath: path.join(dir, "system-message-queue.json") });
}

function baseMessage(overrides = {}) {
  return {
    id: "msg-1",
    accountId: "account-1",
    senderId: "user-1",
    workspaceRoot: "/workspace",
    text: "A quiet pulse fires.",
    createdAt: "2026-06-18T17:00:00.000Z",
    ...overrides,
  };
}

test("system message queue preserves source, kind and expiresAt metadata", () => {
  const store = createStore();
  const queued = store.enqueue(baseMessage({
    kind: "pulse",
    source: "checkin",
    expiresAt: "2026-06-18T17:30:00.000Z",
  }));

  assert.equal(queued.kind, "pulse");
  assert.equal(queued.source, "checkin");
  assert.equal(queued.expiresAt, "2026-06-18T17:30:00.000Z");
  assert.equal(store.hasPendingForAccount("account-1"), true);
});

test("pruneStaleForAccount removes expired checkins without touching other system messages", () => {
  const store = createStore();
  store.enqueue(baseMessage({
    id: "old-checkin",
    source: "checkin",
    createdAt: "2026-06-18T17:00:00.000Z",
    expiresAt: "2026-06-18T17:30:00.000Z",
  }));
  store.enqueue(baseMessage({
    id: "reminder",
    source: "reminder",
    text: "Due reminder for User: stretch",
    createdAt: "2026-06-18T17:00:00.000Z",
  }));

  const removed = store.pruneStaleForAccount("account-1", {
    source: "checkin",
    legacyText: "A quiet pulse fires.",
    maxAgeMs: 30 * 60 * 1000,
    nowMs: Date.parse("2026-06-18T17:31:00.000Z"),
  });

  assert.equal(removed, 1);
  const remaining = store.drainForAccount("account-1");
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, "reminder");
});

test("pruneStaleForAccount removes legacy checkins by exact text after ttl", () => {
  const store = createStore();
  store.enqueue(baseMessage({
    id: "legacy-checkin",
    text: "legacy checkin text",
    createdAt: "2026-06-18T17:00:00.000Z",
  }));

  const removed = store.pruneStaleForAccount("account-1", {
    source: "checkin",
    legacyText: "legacy checkin text",
    maxAgeMs: 30 * 60 * 1000,
    nowMs: Date.parse("2026-06-18T17:30:00.000Z"),
  });

  assert.equal(removed, 1);
  assert.equal(store.hasPendingForAccount("account-1"), false);
});
