const test = require("node:test");
const assert = require("node:assert/strict");

const { SystemMessageDispatcher } = require("../src/core/system-message-dispatcher");

function createDispatcher() {
  return new SystemMessageDispatcher({
    queueStore: {
      hasPendingForAccount() { return false; },
      drainForAccount() { return []; },
      enqueue(message) { return message; },
    },
    config: {
      workspaceId: "ws-1",
      workspaceRoot: "/workspace",
    },
    accountId: "acct-1",
  });
}

test("checkin system messages are prepared as pulse turns with mandatory reach-out wording", () => {
  const dispatcher = createDispatcher();
  const prepared = dispatcher.buildPreparedMessage({
    id: "sys-1",
    senderId: "user-1",
    kind: "checkin",
    text: "contact-gap fired",
    createdAt: "2026-06-27T10:00:00.000Z",
  });

  assert.equal(prepared.turnIntent, "pulse");
  assert.equal(prepared.systemKind, "checkin");
  assert.match(prepared.text, /This is a contact-gap check-in\./);
  assert.match(prepared.text, /default action is to send a message to the user now/i);
  assert.match(prepared.text, /natural chat message, not a cold system ping/i);
  assert.match(prepared.text, /Send a short grounded check-in now\./);
  assert.match(prepared.text, /Do not downgrade it into private reflection or optional review\./);
});

test("reminder system messages keep explicit due-reminder mandatory wording", () => {
  const dispatcher = createDispatcher();
  const prepared = dispatcher.buildPreparedMessage({
    id: "sys-2",
    senderId: "user-1",
    kind: "reminder",
    text: "due reminder",
    createdAt: "2026-06-27T10:00:00.000Z",
  });

  assert.equal(prepared.turnIntent, "reminder");
  assert.equal(prepared.systemKind, "reminder");
  assert.match(prepared.text, /This is a due reminder\./);
  assert.match(prepared.text, /Do not return silent for a due reminder/i);
  assert.match(prepared.text, /Do not sound like a robotic alarm/i);
  assert.match(prepared.text, /natural chat message that lightly carries the reminder/i);
});

test("random pulse system messages are prepared as mandatory life-thread outreach", () => {
  const dispatcher = createDispatcher();
  const prepared = dispatcher.buildPreparedMessage({
    id: "sys-3",
    senderId: "user-1",
    kind: "pulse",
    source: "random_pulse",
    text: "scheduled pulse fired",
    createdAt: "2026-06-27T10:00:00.000Z",
  });

  assert.equal(prepared.turnIntent, "pulse");
  assert.equal(prepared.systemKind, "pulse");
  assert.equal(prepared.systemSource, "random_pulse");
  assert.match(prepared.text, /scheduled life pulse/i);
  assert.match(prepared.text, /default action is to send a message to the user now/i);
  assert.match(prepared.text, /do not return silent/i);
});

test("activity review system messages are prepared as mandatory task-thread outreach", () => {
  const dispatcher = createDispatcher();
  const prepared = dispatcher.buildPreparedMessage({
    id: "sys-4",
    senderId: "user-1",
    kind: "pulse",
    source: "activity_review",
    text: "review due",
    createdAt: "2026-06-27T10:00:00.000Z",
  });

  assert.equal(prepared.turnIntent, "pulse");
  assert.equal(prepared.systemSource, "activity_review");
  assert.match(prepared.text, /scheduled activity review/i);
  assert.match(prepared.text, /default action is to send a message to the user now/i);
  assert.match(prepared.text, /do not silently mark items done, dropped, or abandoned/i);
});

test("hard reminder system messages keep mandatory reminder wording", () => {
  const dispatcher = createDispatcher();
  const prepared = dispatcher.buildPreparedMessage({
    id: "sys-5",
    senderId: "user-1",
    kind: "reminder",
    source: "hard_reminder",
    text: "follow up now",
    createdAt: "2026-06-27T10:00:00.000Z",
  });

  assert.equal(prepared.turnIntent, "reminder");
  assert.equal(prepared.systemSource, "hard_reminder");
  assert.match(prepared.text, /This is a hard reminder\./);
  assert.match(prepared.text, /Do not return silent/i);
});
