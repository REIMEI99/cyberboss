const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  CodexSessionToolCallWatcher,
  findSessionFileForThread,
  mapFunctionCallEntryToToolEvent,
} = require("../src/adapters/runtime/codex/session-tool-call-watcher");

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

  const events = [];
  const watcher = new CodexSessionToolCallWatcher({
    codexHome,
    pollIntervalMs: 20,
    onEvent(event) {
      events.push(event);
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

    await waitUntil(() => events.length === 1);
    const event = events[0];
    assert.equal(event.type, "runtime.tool.started");
    assert.equal(event.payload.threadId, threadId);
    assert.equal(event.payload.displayName, "cyberboss_tools.cyberboss_reminder_create");
    assert.equal(event.payload.detail, "");
  } finally {
    watcher.close();
  }
});

test("codex session function calls map to tool events inside the session watcher", () => {
  const event = mapFunctionCallEntryToToolEvent({
    type: "response_item",
    payload: {
      type: "function_call",
      name: "cyberboss_reminder_create",
      namespace: "mcp__cyberboss_tools__",
      arguments: "{\"delayMinutes\":5,\"text\":\"hello\"}",
      call_id: "call-1",
    },
  }, "thread-1");

  assert.equal(event.type, "runtime.tool.started");
  assert.equal(event.payload.runtimeId, "codex");
  assert.equal(event.payload.threadId, "thread-1");
  assert.equal(event.payload.serverName, "cyberboss_tools");
  assert.equal(event.payload.toolName, "cyberboss_reminder_create");
  assert.equal(event.payload.callId, "call-1");
  assert.equal(event.payload.displayName, "cyberboss_tools.cyberboss_reminder_create");
  assert.equal(event.payload.detail, "{\"delayMinutes\":5,\"text\":\"hello\"}");
});

test("codex session function calls show shell commands as detail", () => {
  const event = mapFunctionCallEntryToToolEvent({
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command",
      arguments: "{\"cmd\":\"curl -I https://example.com\",\"workdir\":\"/tmp\"}",
      call_id: "call-shell",
    },
  }, "thread-1");

  assert.equal(event.payload.toolName, "shell");
  assert.equal(event.payload.displayName, "shell");
  assert.equal(event.payload.detail, "curl -I https://example.com");
});

test("codex session function calls qualify Codex resource tools", () => {
  const event = mapFunctionCallEntryToToolEvent({
    type: "response_item",
    payload: {
      type: "function_call",
      name: "list_mcp_resources",
      arguments: "{\"server\":\"whisper\"}",
      call_id: "call-resource",
    },
  }, "thread-1");

  assert.equal(event.payload.serverName, "codex");
  assert.equal(event.payload.toolName, "list_mcp_resources");
  assert.equal(event.payload.displayName, "codex.list_mcp_resources");
  assert.equal(event.payload.detail, "{\"server\":\"whisper\"}");
});

test("codex session function calls parse bare MCP tool names", () => {
  const event = mapFunctionCallEntryToToolEvent({
    type: "response_item",
    payload: {
      type: "function_call",
      name: "mcp__cyberboss_tools__whereabouts_snapshot",
      arguments: "{\"stayLimit\":3,\"token\":\"secret-value\"}",
      call_id: "call-mcp",
    },
  }, "thread-1");

  assert.equal(event.payload.serverName, "cyberboss_tools");
  assert.equal(event.payload.toolName, "whereabouts_snapshot");
  assert.equal(event.payload.displayName, "cyberboss_tools.whereabouts_snapshot");
  assert.equal(event.payload.detail, "{\"stayLimit\":3,\"token\":\"[redacted]\"}");
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
