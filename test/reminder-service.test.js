const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { ReminderService, resolveFollowupDelayMinutes } = require("../src/services/reminder-service");

function createConfig() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-reminder-service-test-"));
  return {
    reminderQueueFile: path.join(stateDir, "reminders.json"),
    accountsDir: path.join(stateDir, "accounts"),
    activeAccountFile: path.join(stateDir, "active-account.json"),
    contextTokenFile: path.join(stateDir, "context-tokens.json"),
    preferredSenderFile: path.join(stateDir, "preferred-sender.json"),
  };
}

function seedAccountFiles(config) {
  fs.mkdirSync(config.accountsDir, { recursive: true });
  fs.writeFileSync(config.activeAccountFile, JSON.stringify({
    accountId: "acct-1",
    rawAccountId: "acct-1",
    token: "tok",
    baseUrl: "https://example.com",
    userId: "bot-user",
    savedAt: "2026-06-21T00:00:00.000Z",
  }));
  fs.writeFileSync(path.join(config.accountsDir, "acct-1.json"), JSON.stringify({
    accountId: "acct-1",
    rawAccountId: "acct-1",
    token: "tok",
    baseUrl: "https://example.com",
    userId: "bot-user",
    savedAt: "2026-06-21T00:00:00.000Z",
  }));
  fs.writeFileSync(path.join(config.accountsDir, "acct-1.context-tokens.json"), JSON.stringify({
    "user-1": "ctx-1",
  }));
}

test("resolveFollowupDelayMinutes defaults to short sticky cadence", () => {
  assert.equal(resolveFollowupDelayMinutes({}), 15);
  assert.equal(resolveFollowupDelayMinutes({ delayMinutes: 2 }), 5);
  assert.equal(resolveFollowupDelayMinutes({ delayMinutes: 45 }), 45);
  assert.equal(resolveFollowupDelayMinutes({ dueAt: "2026-06-21T10:00:00+08:00" }), 30);
});

test("reminder service creates sticky reminders and can list and complete them", async () => {
  const config = createConfig();
  seedAccountFiles(config);
  const service = new ReminderService({
    config,
    sessionStore: {
      findPreferredSender() {
        return null;
      },
    },
  });

  const created = await service.create({
    text: "Pick up order",
    delayMinutes: 8,
  }, {
    senderId: "user-1",
  });

  assert.equal(created.followupDelayMinutes, 8);

  const listed = service.list({}, { senderId: "user-1" });
  assert.equal(listed.count, 1);
  assert.equal(listed.reminders[0].id, created.id);

  const completed = service.complete({ id: created.id });
  assert.equal(completed.id, created.id);
  assert.equal(service.list({}, { senderId: "user-1" }).count, 0);
});
