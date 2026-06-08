const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  CodexSessionToolCallWatcher,
  findSessionFileForThread,
} = require("../src/adapters/runtime/codex/session-tool-call-watcher");
const { mapCodexMessageToRuntimeEvent } = require("../src/adapters/runtime/codex/events");

test("codex session tool watcher emits new function calls for the active thread", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-codex-tool-watch-"));
  const codexHome = path.join(tempDir, ".codex");
  const sessionDir = path.join(codexHome, "sessions", "2026", "06", "09");
  const threadId = "019e16e7-cc33-7e21-9be8-90d975516dd9";
  const sessionFile = path.join(sessionDir, `rollout-2026-06-09T10-00-00-${threadId}.jsonl`);
  fs.mkdirSync(sessionDir, { recursive: true });
  appendJsonl(sessionFile, {
    timestamp: "2026-06-09T01:00:00.000Z",
    type: "session_meta",
    payload: {
      id: threadId,
    },
  });
  appendJsonl(sessionFile, {
    timestamp: "2026-06-09T01:01:00.000Z",
    type: "response_item",
    payload: {
      type: "function_call",
      name: "old_tool",
      namespace: "mcp__old_server__",
      call_id: "call-old",
    },
  });

  const messages = [];
  const watcher = new CodexSessionToolCallWatcher({
    codexHome,
    pollIntervalMs: 20,
    onMessage(message) {
      messages.push(message);
    },
  });

  try {
    watcher.watchThread(threadId);
    await waitForStableWatcher();

    appendJsonl(sessionFile, {
      timestamp: "2026-06-09T01:02:00.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "cyberboss_reminder_create",
        namespace: "mcp__cyberboss_tools__",
        call_id: "call-new",
      },
    });

    await waitUntil(() => messages.length === 1);
    assert.equal(messages[0].payload.threadId, threadId);
    assert.equal(messages[0].payload.thread_id, threadId);

    const event = mapCodexMessageToRuntimeEvent(messages[0]);
    assert.equal(event.type, "runtime.tool.started");
    assert.equal(event.payload.threadId, threadId);
    assert.equal(event.payload.displayName, "cyberboss_tools.cyberboss_reminder_create");
  } finally {
    watcher.close();
  }
});

test("codex session file lookup falls back to session metadata", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-codex-tool-find-"));
  const sessionDir = path.join(tempDir, ".codex", "sessions", "2026", "06", "09");
  const threadId = "thread-from-meta";
  const sessionFile = path.join(sessionDir, "rollout-without-id-in-name.jsonl");
  fs.mkdirSync(sessionDir, { recursive: true });
  appendJsonl(sessionFile, {
    type: "session_meta",
    payload: {
      id: threadId,
    },
  });

  assert.equal(findSessionFileForThread(path.join(tempDir, ".codex", "sessions"), threadId), sessionFile);
});

function appendJsonl(filePath, value) {
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
}

async function waitForStableWatcher() {
  await new Promise((resolve) => setTimeout(resolve, 40));
}

async function waitUntil(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("timed out waiting for condition");
}
