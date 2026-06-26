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
});
