const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("codex adapter emits tool events from active session jsonl", async () => {
  const indexPath = path.resolve(__dirname, "../src/adapters/runtime/codex/index.js");
  const rpcClientPath = path.resolve(__dirname, "../src/adapters/runtime/codex/rpc-client.js");
  const mcpConfigPath = path.resolve(__dirname, "../src/adapters/runtime/codex/mcp-config.js");

  const originalIndex = require.cache[indexPath];
  const originalRpc = require.cache[rpcClientPath];
  const originalMcp = require.cache[mcpConfigPath];
  const calls = {
    resumeThread: [],
    sendUserMessage: [],
  };

  class MockCodexRpcClient {
    async connect() {}
    async initialize() {}
    isTransportReady() {
      return true;
    }
    async listModels() {
      return { result: { data: [] } };
    }
    onMessage() {
      return () => {};
    }
    async resumeThread(params) {
      calls.resumeThread.push(params);
      return { result: { thread: { id: params.threadId } } };
    }
    async sendUserMessage(params) {
      calls.sendUserMessage.push(params);
      return { result: { turn: { id: "turn-1" } } };
    }
    async close() {}
  }

  delete require.cache[indexPath];
  require.cache[rpcClientPath] = {
    id: rpcClientPath,
    filename: rpcClientPath,
    loaded: true,
    exports: {
      CodexRpcClient: MockCodexRpcClient,
    },
  };
  require.cache[mcpConfigPath] = {
    id: mcpConfigPath,
    filename: mcpConfigPath,
    loaded: true,
    exports: {
      resolveCodexProjectToolMcpServerConfig() {
        return null;
      },
    },
  };

  try {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-codex-adapter-tool-"));
    const codexHome = path.join(tempDir, ".codex");
    const sessionsFile = path.join(tempDir, "sessions.json");
    const workspaceRoot = path.join(tempDir, "workspace");
    const threadId = "thread-tool-events";
    const sessionDir = path.join(codexHome, "sessions", "2026", "06", "09");
    const sessionFile = path.join(sessionDir, `rollout-2026-06-09T10-00-00-${threadId}.jsonl`);
    fs.mkdirSync(workspaceRoot);
    fs.mkdirSync(sessionDir, { recursive: true });
    appendJsonl(sessionFile, {
      type: "session_meta",
      payload: {
        id: threadId,
      },
    });

    const { createCodexRuntimeAdapter } = require(indexPath);
    const adapter = createCodexRuntimeAdapter({
      sessionsFile,
      codexHome,
      codexEndpoint: "ws://127.0.0.1:8765",
      stateDir: tempDir,
    });
    adapter.getSessionStore().setThreadIdForWorkspace("binding", workspaceRoot, threadId);

    const events = [];
    const unsubscribe = adapter.onEvent((event) => {
      events.push(event);
    });

    try {
      await adapter.sendTextTurn({
        bindingKey: "binding",
        workspaceRoot,
        text: "create a reminder",
      });
      appendJsonl(sessionFile, {
        timestamp: "2026-06-09T01:02:00.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "cyberboss_reminder_create",
          namespace: "mcp__cyberboss_tools__",
          call_id: "call-tool",
        },
      });

      await waitUntil(() => events.some((event) => event.type === "runtime.tool.started"));
      const toolEvent = events.find((event) => event.type === "runtime.tool.started");
      assert.equal(toolEvent.payload.threadId, threadId);
      assert.equal(toolEvent.payload.displayName, "cyberboss_tools.cyberboss_reminder_create");
      assert.equal(calls.resumeThread.length, 1);
      assert.equal(calls.sendUserMessage.length, 1);
    } finally {
      unsubscribe();
      await adapter.close();
    }
  } finally {
    delete require.cache[indexPath];
    if (originalIndex) {
      require.cache[indexPath] = originalIndex;
    }
    if (originalRpc) {
      require.cache[rpcClientPath] = originalRpc;
    } else {
      delete require.cache[rpcClientPath];
    }
    if (originalMcp) {
      require.cache[mcpConfigPath] = originalMcp;
    } else {
      delete require.cache[mcpConfigPath];
    }
  }
});

function appendJsonl(filePath, value) {
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
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
