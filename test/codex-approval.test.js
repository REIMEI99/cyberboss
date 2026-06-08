const test = require("node:test");
const assert = require("node:assert/strict");

const { CyberbossApp } = require("../src/core/app");
const { mapCodexMessageToRuntimeEvent } = require("../src/adapters/runtime/codex/events");
const { mapClaudeCodeMessageToRuntimeEvent } = require("../src/adapters/runtime/claudecode/events");
const { buildCodexMcpConfigArgs } = require("../src/adapters/runtime/codex/mcp-config");

test("codex MCP config auto-approves cyberboss tools", () => {
  const args = buildCodexMcpConfigArgs({
    name: "cyberboss_tools",
    command: "/usr/bin/node",
    args: ["/workspace/bin/cyberboss.js", "tool-mcp-server"],
  });

  assert.deepEqual(args.slice(0, 4), [
    "-c",
    "mcp_servers.cyberboss_tools.command=\"/usr/bin/node\"",
    "-c",
    "mcp_servers.cyberboss_tools.args=[\"/workspace/bin/cyberboss.js\",\"tool-mcp-server\"]",
  ]);
  assert.match(
    args.join("\n"),
    /mcp_servers\.cyberboss_tools\.tools\.cyberboss_channel_send_file\.approval_mode="auto"/
  );
  assert.match(
    args.join("\n"),
    /mcp_servers\.cyberboss_tools\.tools\.cyberboss_reminder_create\.approval_mode="auto"/
  );
  assert.match(
    args.join("\n"),
    /mcp_servers\.cyberboss_tools\.tools\.cyberboss_timeline_screenshot\.approval_mode="auto"/
  );
  assert.match(
    args.join("\n"),
    /mcp_servers\.cyberboss_tools\.tools\.whereabouts_snapshot\.approval_mode="auto"/
  );
});

test("codex MCP elicitation approvals map to runtime approval events", () => {
  const event = mapCodexMessageToRuntimeEvent({
    id: "req-mcp-1",
    method: "mcpServer/elicitation/request",
    params: {
      serverName: "cyberboss_tools",
      threadId: "thread-1",
      turnId: "turn-1",
      mode: "form",
      _meta: {
        codex_approval_kind: "mcp_tool_call",
        persist: ["session", "always"],
        tool_description: "Create a reminder in Cyberboss. Input: { text: string, delayMinutes?: integer }",
        tool_params_display: [
          { name: "delayMinutes", display_name: "delayMinutes", value: 5 },
          { name: "text", display_name: "text", value: "hello" },
        ],
      },
      message: "Allow the cyberboss_tools MCP server to run tool \"cyberboss_reminder_create\"?",
      requestedSchema: {
        type: "object",
        properties: {},
      },
    },
  });

  assert.equal(event.type, "runtime.approval.requested");
  assert.equal(event.payload.kind, "mcp_tool_call");
  assert.equal(event.payload.threadId, "thread-1");
  assert.deepEqual(event.payload.commandTokens, ["mcp_tool", "cyberboss_tools", "cyberboss_reminder_create"]);
  assert.equal(event.payload.command, "cyberboss_reminder_create\ndelayMinutes: 5\ntext: hello");
  assert.deepEqual(event.payload.responseTemplate.supportedCommands, ["yes", "always", "no"]);
  assert.deepEqual(event.payload.responseTemplate.responseByCommand.yes, {
    action: "accept",
  });
  assert.deepEqual(event.payload.responseTemplate.responseByCommand.always, {
    action: "accept",
  });
  assert.equal(event.payload.elicitation.approvalKind, "mcp_tool_call");
  assert.deepEqual(event.payload.elicitation.persistScopes, ["session", "always"]);
  assert.deepEqual(event.payload.elicitation.toolParamsDisplay, [
    { name: "delayMinutes", displayName: "delayMinutes", value: 5 },
    { name: "text", displayName: "text", value: "hello" },
  ]);
  assert.deepEqual(event.payload.responseTemplate.responseByCommand.no, {
    action: "cancel",
  });
});

test("claudecode tool.use messages map MCP tool names to runtime tool events", () => {
  const event = mapClaudeCodeMessageToRuntimeEvent({
    type: "tool.use",
    sessionId: "thread-1",
    turnId: "turn-1",
    toolName: "mcp__cyberboss_tools__cyberboss_timeline_write",
  });

  assert.equal(event.type, "runtime.tool.started");
  assert.equal(event.payload.runtimeId, "claudecode");
  assert.equal(event.payload.threadId, "thread-1");
  assert.equal(event.payload.turnId, "turn-1");
  assert.equal(event.payload.serverName, "cyberboss_tools");
  assert.equal(event.payload.toolName, "cyberboss_timeline_write");
  assert.equal(event.payload.displayName, "cyberboss_tools.cyberboss_timeline_write");
});

test("handleRuntimeEvent auto-approves project-native Codex MCP elicitation approvals", async () => {
  const responses = [];
  const appLike = {
    config: { stateDir: "/tmp/cyberboss-test-state" },
    streamDelivery: {
      async handleRuntimeEvent() {},
    },
    runtimeAdapter: {
      getSessionStore() {
        return {
          clearApprovalPrompt() {},
          findBindingForThreadId() {
            return { bindingKey: "binding-1", workspaceRoot: "/workspace" };
          },
          getApprovalPromptState() {
            return null;
          },
          rememberApprovalPrompt() {},
          getApprovalCommandAllowlistForWorkspace() {
            return [];
          },
        };
      },
      async respondApproval(payload) {
        responses.push(payload);
      },
    },
    threadStateStore: {
      resolveApproval() {},
    },
    async sendApprovalPrompt() {
      throw new Error("should not prompt for project-native Codex MCP tools");
    },
  };

  await CyberbossApp.prototype.handleRuntimeEvent.call(appLike, {
    type: "runtime.approval.requested",
    payload: {
      kind: "mcp_elicitation",
      elicitation: {
        approvalKind: "mcp_tool_call",
      },
      threadId: "thread-1",
      requestId: "req-project-tool",
      commandTokens: ["mcp_tool", "cyberboss_tools", "cyberboss_reminder_create"],
      responseTemplate: {
        responseByCommand: {
          yes: {
            action: "accept",
          },
        },
      },
    },
  });

  assert.deepEqual(responses, [{
    requestId: "req-project-tool",
    result: {
      action: "accept",
    },
  }]);
});

test("handleRuntimeEvent sends tool call notices to the active WeChat thread when enabled", async () => {
  const sent = [];
  const appLike = Object.assign(Object.create(CyberbossApp.prototype), {
    channelAdapter: {
      getShowToolCalls() {
        return true;
      },
      getShowToolCallDetails() {
        return true;
      },
      async sendText(payload) {
        sent.push(payload);
      },
    },
    streamDelivery: {
      async handleRuntimeEvent() {},
      resolveReplyTargetForRun({ threadId, turnId }) {
        assert.equal(threadId, "thread-1");
        assert.equal(turnId, "turn-1");
        return {
          userId: "user-1",
          contextToken: "ctx-1",
          provider: "weixin",
        };
      },
    },
    threadStateStore: {
      snapshot() {
        return [{ threadId: "thread-1", turnId: "turn-1", status: "running" }];
      },
    },
    runtimeAdapter: {
      getSessionStore() {
        return {
          findBindingForThreadId() {
            return null;
          },
        };
      },
    },
  });

  await CyberbossApp.prototype.handleRuntimeEvent.call(appLike, {
    type: "runtime.tool.started",
    payload: {
      runtimeId: "codex",
      displayName: "cyberboss_tools.cyberboss_reminder_create",
      detail: "{\"delayMinutes\":5,\"text\":\"hello\"}",
    },
  });

  assert.deepEqual(sent, [{
    userId: "user-1",
    text: "🔧 tool call:\ncyberboss_tools.cyberboss_reminder_create\ndetail: {\"delayMinutes\":5,\"text\":\"hello\"}",
    contextToken: "ctx-1",
    preserveBlock: true,
  }]);
});

test("handleRuntimeEvent hides tool call details unless detail mode is enabled", async () => {
  const sent = [];
  const appLike = Object.assign(Object.create(CyberbossApp.prototype), {
    channelAdapter: {
      getShowToolCalls() {
        return true;
      },
      getShowToolCallDetails() {
        return false;
      },
      async sendText(payload) {
        sent.push(payload);
      },
    },
    streamDelivery: {
      async handleRuntimeEvent() {},
      resolveReplyTargetForRun() {
        return {
          userId: "user-1",
          contextToken: "ctx-1",
          provider: "weixin",
        };
      },
    },
    threadStateStore: {
      snapshot() {
        return [{ threadId: "thread-1", turnId: "turn-1", status: "running" }];
      },
    },
    runtimeAdapter: {
      getSessionStore() {
        return {
          findBindingForThreadId() {
            return null;
          },
        };
      },
    },
  });

  await CyberbossApp.prototype.handleRuntimeEvent.call(appLike, {
    type: "runtime.tool.started",
    payload: {
      runtimeId: "codex",
      displayName: "shell",
      detail: "date",
    },
  });

  assert.equal(sent[0].text, "🔧 tool call:\nshell");
});

test("handleToolVisibilityCommand switches detail and name-only modes", async () => {
  const sent = [];
  let showToolCalls = false;
  let showToolCallDetails = false;
  const appLike = {
    channelAdapter: {
      setShowToolCalls(value) {
        showToolCalls = Boolean(value);
        return showToolCalls;
      },
      setShowToolCallDetails(value) {
        showToolCallDetails = Boolean(value);
        return showToolCallDetails;
      },
      async sendText(payload) {
        sent.push(payload);
      },
    },
  };
  const normalized = {
    senderId: "user-1",
    contextToken: "ctx-1",
  };

  await CyberbossApp.prototype.handleToolVisibilityCommand.call(appLike, normalized, {
    args: "detail",
  });
  assert.equal(showToolCalls, true);
  assert.equal(showToolCallDetails, true);
  assert.equal(sent.at(-1).text, "✅ Tool call notices enabled with details.");

  await CyberbossApp.prototype.handleToolVisibilityCommand.call(appLike, normalized, {
    args: "on",
  });
  assert.equal(showToolCalls, true);
  assert.equal(showToolCallDetails, false);
  assert.equal(sent.at(-1).text, "✅ Tool call notices enabled with names only.");
});

test("handleApprovalCommand sends MCP elicitation responses back through the runtime", async () => {
  const responses = [];
  const sent = [];
  const approval = {
    kind: "mcp_tool_call",
    requestId: "req-ext-mcp",
    commandTokens: ["mcp_tool", "notes_server", "note_create"],
    responseTemplate: {
      supportedCommands: ["yes", "no"],
      responseByCommand: {
        yes: {
          action: "accept",
        },
        no: {
          action: "cancel",
        },
      },
    },
  };

  const appLike = {
    resolveWorkspaceRoot() {
      return "/workspace";
    },
    runtimeAdapter: {
      async respondApproval(payload) {
        responses.push(payload);
      },
      getSessionStore() {
        return {
          buildBindingKey() {
            return "binding-1";
          },
          getThreadIdForWorkspace() {
            return "thread-1";
          },
          clearApprovalPrompt() {},
          rememberApprovalPrefixForWorkspace() {
            throw new Error("should not remember allowlists for MCP elicitation responses");
          },
        };
      },
    },
    threadStateStore: {
      getThreadState() {
        return { pendingApproval: approval };
      },
      resolveApproval() {},
    },
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload.text);
      },
    },
  };

  await CyberbossApp.prototype.handleApprovalCommand.call(
    appLike,
    { workspaceId: "workspace-id", accountId: "account-id", senderId: "user-1", contextToken: "ctx-1" },
    { name: "yes" },
  );

  assert.deepEqual(responses, [{
    requestId: "req-ext-mcp",
    result: {
      action: "accept",
    },
  }]);
  assert.deepEqual(sent, ["✅ This request has been approved."]);
});

test("handleApprovalCommand enables persistent Codex MCP tool approval from WeChat", async () => {
  const responses = [];
  const sent = [];
  const remembered = [];
  const approval = {
    kind: "mcp_tool_call",
    requestId: "req-ext-mcp",
    commandTokens: ["mcp_tool", "notes_server", "note_create"],
    responseTemplate: {
      supportedCommands: ["yes", "no"],
      responseByCommand: {
        yes: {
          action: "accept",
        },
        no: {
          action: "cancel",
        },
      },
    },
  };

  const appLike = {
    resolveWorkspaceRoot() {
      return "/workspace";
    },
    runtimeAdapter: {
      async respondApproval(payload) {
        responses.push(payload);
      },
      getSessionStore() {
        return {
          buildBindingKey() {
            return "binding-1";
          },
          getThreadIdForWorkspace() {
            return "thread-1";
          },
          clearApprovalPrompt() {},
          rememberApprovalPrefixForWorkspace(workspaceRoot, commandTokens) {
            remembered.push({ workspaceRoot, commandTokens });
          },
        };
      },
    },
    threadStateStore: {
      getThreadState() {
        return { pendingApproval: approval };
      },
      resolveApproval() {},
    },
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload.text);
      },
    },
  };

  await CyberbossApp.prototype.handleApprovalCommand.call(
    appLike,
    { workspaceId: "workspace-id", accountId: "account-id", senderId: "user-1", contextToken: "ctx-1" },
    { name: "always" },
  );

  assert.deepEqual(responses, [{
    requestId: "req-ext-mcp",
    result: {
      action: "accept",
    },
  }]);
  assert.deepEqual(remembered, [{
    workspaceRoot: "/workspace",
    commandTokens: ["mcp_tool", "notes_server", "note_create"],
  }]);
  assert.deepEqual(sent, ["💡 Auto-approve enabled for this MCP tool in the current workspace."]);
});
