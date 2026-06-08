const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

class CodexSessionToolCallWatcher {
  constructor({ codexHome = "", pollIntervalMs = 750, onEvent = null } = {}) {
    this.codexHome = normalizePath(codexHome) || path.join(os.homedir(), ".codex");
    this.sessionsRoot = path.join(this.codexHome, "sessions");
    this.pollIntervalMs = Math.max(50, Number(pollIntervalMs) || 750);
    this.onEvent = typeof onEvent === "function" ? onEvent : () => {};
    this.watchStates = new Map();
  }

  watchThread(threadId) {
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedThreadId || this.watchStates.has(normalizedThreadId)) {
      return;
    }

    const state = {
      threadId: normalizedThreadId,
      filePath: "",
      offset: 0,
      buffer: "",
      reading: false,
      seenCallIds: new Set(),
      timer: null,
    };
    this.watchStates.set(normalizedThreadId, state);
    this.refreshStateFile(state, { startAtEnd: true });
    state.timer = setInterval(() => {
      this.pollState(state);
    }, this.pollIntervalMs);
    if (typeof state.timer.unref === "function") {
      state.timer.unref();
    }
  }

  close() {
    for (const state of this.watchStates.values()) {
      if (state.timer) {
        clearInterval(state.timer);
      }
    }
    this.watchStates.clear();
  }

  pollState(state) {
    if (!state.filePath) {
      this.refreshStateFile(state, { startAtEnd: true });
      return;
    }
    if (state.reading) {
      return;
    }

    let stat = null;
    try {
      stat = fs.statSync(state.filePath);
    } catch {
      state.filePath = "";
      state.offset = 0;
      state.buffer = "";
      return;
    }

    if (stat.size < state.offset) {
      state.offset = stat.size;
      state.buffer = "";
      return;
    }
    if (stat.size === state.offset) {
      return;
    }

    const stream = fs.createReadStream(state.filePath, {
      start: state.offset,
      end: stat.size - 1,
      encoding: "utf8",
    });
    state.reading = true;
    state.offset = stat.size;
    stream.on("data", (chunk) => {
      state.buffer += chunk;
      this.drainLines(state);
    });
    stream.on("end", () => {
      this.drainLines(state, { flush: false });
      state.reading = false;
    });
    stream.on("error", () => {
      state.reading = false;
    });
  }

  drainLines(state, { flush = true } = {}) {
    const lines = state.buffer.split(/\r?\n/);
    state.buffer = flush ? lines.pop() || "" : state.buffer.endsWith("\n") ? "" : lines.pop() || "";
    for (const line of lines) {
      this.handleLine(state, line);
    }
  }

  handleLine(state, line) {
    const trimmed = normalizeText(line);
    if (!trimmed) {
      return;
    }
    let entry = null;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (entry?.type !== "response_item" || normalizeText(entry?.payload?.type) !== "function_call") {
      return;
    }
    const callKey = buildCallKey(entry);
    if (callKey && state.seenCallIds.has(callKey)) {
      return;
    }
    if (callKey) {
      state.seenCallIds.add(callKey);
    }
    const event = mapFunctionCallEntryToToolEvent(entry, state.threadId);
    if (event) {
      this.onEvent(event, entry);
    }
  }

  refreshStateFile(state, { startAtEnd }) {
    const filePath = findSessionFileForThread(this.sessionsRoot, state.threadId);
    if (!filePath || filePath === state.filePath) {
      return;
    }
    state.filePath = filePath;
    state.buffer = "";
    state.reading = false;
    try {
      const stat = fs.statSync(filePath);
      state.offset = startAtEnd ? stat.size : 0;
    } catch {
      state.filePath = "";
      state.offset = 0;
    }
  }
}

function findSessionFileForThread(sessionsRoot, threadId) {
  const files = listJsonlFiles(sessionsRoot);
  const byName = files
    .filter((filePath) => path.basename(filePath).includes(threadId))
    .sort(compareFileMtimeDesc);
  if (byName.length) {
    return byName[0];
  }

  for (const filePath of files.sort(compareFileMtimeDesc)) {
    if (fileContainsSessionId(filePath, threadId)) {
      return filePath;
    }
  }
  return "";
}

function listJsonlFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function fileContainsSessionId(filePath, threadId) {
  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return false;
  }
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const entry = JSON.parse(line);
      if (normalizeText(entry?.type) === "session_meta" && normalizeText(entry?.payload?.id) === threadId) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

function compareFileMtimeDesc(left, right) {
  return getMtimeMs(right) - getMtimeMs(left);
}

function getMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function buildCallKey(entry) {
  const payload = entry?.payload || {};
  return normalizeText(payload.call_id || payload.callId)
    || `${normalizeText(entry.timestamp)}:${normalizeText(payload.namespace)}:${normalizeText(payload.name)}:${normalizeText(payload.arguments)}`;
}

function mapFunctionCallEntryToToolEvent(entry, threadId) {
  const payload = entry?.payload || {};
  const rawToolName = normalizeText(payload.name);
  if (!rawToolName) {
    return null;
  }
  const parsedArguments = parseArguments(payload.arguments);
  const toolIdentity = resolveToolIdentity({
    namespace: payload.namespace,
    rawToolName,
    parsedArguments,
  });
  return {
    type: "runtime.tool.started",
    payload: {
      runtimeId: "codex",
      threadId: normalizeText(payload.thread_id || payload.threadId) || normalizeText(threadId),
      turnId: normalizeText(payload.turn_id || payload.turnId),
      callId: normalizeText(payload.call_id || payload.callId),
      toolName: toolIdentity.toolName,
      rawToolName,
      serverName: toolIdentity.serverName,
      displayName: toolIdentity.displayName,
      detail: formatToolCallDetail({ rawToolName, parsedArguments, rawArguments: payload.arguments }),
    },
  };
}

function resolveToolIdentity({ namespace = "", rawToolName = "", parsedArguments = null } = {}) {
  const namespaced = parseMcpToolName(rawToolName);
  if (namespaced.serverName && namespaced.toolName) {
    return {
      serverName: namespaced.serverName,
      toolName: namespaced.toolName,
      displayName: formatToolCallDisplayName(namespaced),
    };
  }

  const serverName = extractMcpServerName(namespace);
  if (serverName) {
    return {
      serverName,
      toolName: rawToolName,
      displayName: formatToolCallDisplayName({ serverName, toolName: rawToolName }),
    };
  }

  if (rawToolName === "exec_command") {
    return {
      serverName: "",
      toolName: "shell",
      displayName: "shell",
    };
  }

  if (rawToolName === "write_stdin") {
    return {
      serverName: "",
      toolName: "shell.input",
      displayName: "shell.input",
    };
  }

  if (rawToolName === "list_mcp_resources" || rawToolName === "list_mcp_resource_templates") {
    return {
      serverName: "codex",
      toolName: rawToolName,
      displayName: `codex.${rawToolName}`,
    };
  }

  const normalizedNamespace = normalizeText(namespace);
  if (normalizedNamespace) {
    return {
      serverName: normalizedNamespace,
      toolName: rawToolName,
      displayName: formatToolCallDisplayName({ serverName: normalizedNamespace, toolName: rawToolName }),
    };
  }

  const commandName = normalizeText(parsedArguments?.cmd).split(/\s+/)[0];
  return {
    serverName: "",
    toolName: rawToolName,
    displayName: commandName && rawToolName === "exec_command" ? commandName : rawToolName,
  };
}

function parseMcpToolName(toolName) {
  const normalized = normalizeText(toolName);
  if (!normalized.startsWith("mcp__")) {
    return { serverName: "", toolName: "" };
  }
  const parts = normalized.split("__").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3 || parts[0] !== "mcp") {
    return { serverName: "", toolName: "" };
  }
  return {
    serverName: parts[1],
    toolName: parts.slice(2).join("__"),
  };
}

function extractMcpServerName(namespace) {
  const normalized = normalizeText(namespace);
  if (!normalized.startsWith("mcp__")) {
    return "";
  }
  const parts = normalized.split("__").map((part) => part.trim()).filter(Boolean);
  return parts[0] === "mcp" && parts[1] ? parts[1] : "";
}

function formatToolCallDisplayName({ serverName = "", toolName = "" } = {}) {
  const normalizedToolName = normalizeText(toolName);
  const normalizedServerName = normalizeText(serverName);
  return normalizedServerName
    ? `${normalizedServerName}.${normalizedToolName}`
    : normalizedToolName;
}

function formatToolCallDetail({ rawToolName = "", parsedArguments = null, rawArguments = "" } = {}) {
  if (rawToolName === "exec_command") {
    return truncateDetail(normalizeText(parsedArguments?.cmd));
  }
  if (rawToolName === "write_stdin") {
    const sessionId = normalizeText(parsedArguments?.session_id);
    return sessionId ? `session_id: ${sessionId}` : "";
  }
  const redacted = redactValue(parsedArguments);
  if (redacted && typeof redacted === "object" && !Array.isArray(redacted) && Object.keys(redacted).length === 0) {
    return "";
  }
  if (redacted !== null && redacted !== undefined) {
    return truncateDetail(JSON.stringify(redacted));
  }
  return truncateDetail(normalizeText(rawArguments));
}

function parseArguments(value) {
  if (!normalizeText(value)) {
    return null;
  }
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function redactValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const redacted = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      redacted[key] = "[redacted]";
    } else {
      redacted[key] = redactValue(child);
    }
  }
  return redacted;
}

function isSensitiveKey(key) {
  return /token|secret|password|passwd|api[_-]?key|authorization|cookie/i.test(String(key || ""));
}

function truncateDetail(text, maxLength = 320) {
  const normalized = normalizeText(text).replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 2)}…`;
}

function normalizePath(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  CodexSessionToolCallWatcher,
  findSessionFileForThread,
  mapFunctionCallEntryToToolEvent,
  resolveToolIdentity,
};
