const fs = require("fs");
const path = require("path");

class SystemMessageQueueStore {
  constructor({ filePath }) {
    this.filePath = filePath;
    this.state = { messages: [] };
    this.ensureParentDirectory();
    this.load();
  }

  ensureParentDirectory() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
      this.state = {
        messages: messages
          .map(normalizeSystemMessage)
          .filter(Boolean)
          .sort(compareSystemMessages),
      };
    } catch {
      this.state = { messages: [] };
    }
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  enqueue(message) {
    this.load();
    const normalized = normalizeSystemMessage(message);
    if (!normalized) {
      throw new Error("invalid system message");
    }
    this.state.messages.push(normalized);
    this.state.messages.sort(compareSystemMessages);
    this.save();
    return normalized;
  }

  drainForAccount(accountId) {
    this.load();
    const normalizedAccountId = normalizeText(accountId);
    const drained = [];
    const pending = [];

    for (const message of this.state.messages) {
      if (message.accountId === normalizedAccountId) {
        drained.push(message);
      } else {
        pending.push(message);
      }
    }

    if (drained.length) {
      this.state.messages = pending;
      this.save();
    }

    return drained;
  }

  hasPendingForAccount(accountId) {
    this.load();
    const normalizedAccountId = normalizeText(accountId);
    return this.state.messages.some((message) => message.accountId === normalizedAccountId);
  }

  pruneStaleForAccount(accountId, { source = "", legacyText = "", maxAgeMs = 0, nowMs = Date.now() } = {}) {
    this.load();
    const normalizedAccountId = normalizeText(accountId);
    const normalizedSource = normalizeText(source);
    const normalizedLegacyText = normalizeText(legacyText);
    const normalizedMaxAgeMs = Number(maxAgeMs);
    const normalizedNowMs = Number(nowMs);
    if (!normalizedAccountId || !Number.isFinite(normalizedMaxAgeMs) || normalizedMaxAgeMs <= 0 || !Number.isFinite(normalizedNowMs)) {
      return 0;
    }

    let removed = 0;
    const pending = [];
    for (const message of this.state.messages) {
      if (
        message.accountId === normalizedAccountId
        && matchesStaleFilter(message, { source: normalizedSource, legacyText: normalizedLegacyText })
        && isOlderThan(message, normalizedMaxAgeMs, normalizedNowMs)
      ) {
        removed += 1;
        continue;
      }
      pending.push(message);
    }

    if (removed) {
      this.state.messages = pending;
      this.save();
    }
    return removed;
  }
}

function normalizeSystemMessage(message) {
  if (!message || typeof message !== "object") {
    return null;
  }

  const id = normalizeText(message.id);
  const accountId = normalizeText(message.accountId);
  const senderId = normalizeText(message.senderId);
  const workspaceRoot = normalizeText(message.workspaceRoot);
  const text = normalizeText(message.text);
  const createdAt = normalizeIsoTime(message.createdAt);
  const source = normalizeText(message.source);
  const expiresAt = normalizeIsoTime(message.expiresAt);

  if (!id || !accountId || !senderId || !workspaceRoot || !text) {
    return null;
  }

  const normalized = {
    id,
    accountId,
    senderId,
    workspaceRoot,
    text,
    createdAt: createdAt || new Date().toISOString(),
  };
  if (source) {
    normalized.source = source;
  }
  if (expiresAt) {
    normalized.expiresAt = expiresAt;
  }
  return normalized;
}

function matchesStaleFilter(message, { source, legacyText }) {
  if (source && message?.source === source) {
    return true;
  }
  return Boolean(legacyText && !message?.source && message?.text === legacyText);
}

function isOlderThan(message, maxAgeMs, nowMs) {
  const expiresAtMs = Date.parse(message?.expiresAt || "");
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) {
    return true;
  }
  const createdAtMs = Date.parse(message?.createdAt || "");
  return Number.isFinite(createdAtMs) && nowMs - createdAtMs >= maxAgeMs;
}

function normalizeIsoTime(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return new Date(parsed).toISOString();
}

function compareSystemMessages(left, right) {
  const leftTime = Date.parse(left?.createdAt || "") || 0;
  const rightTime = Date.parse(right?.createdAt || "") || 0;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { SystemMessageQueueStore };
