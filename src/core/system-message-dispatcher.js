class SystemMessageDispatcher {
  constructor({ queueStore, config, accountId }) {
    this.queueStore = queueStore;
    this.config = config;
    this.accountId = accountId;
  }

  hasPending() {
    return this.queueStore.hasPendingForAccount(this.accountId);
  }

  drainPending() {
    return this.queueStore.drainForAccount(this.accountId);
  }

  requeue(message) {
    return this.queueStore.enqueue(message);
  }

  resolveWorkspaceRoot(message) {
    return normalizeText(message?.workspaceRoot) || normalizeText(this.config.workspaceRoot);
  }

  buildPreparedMessage(message, contextToken = "") {
    const systemKind = normalizeSystemKind(message?.kind);
    return {
      provider: "system",
      turnIntent: resolveSystemTurnIntent(systemKind),
      systemKind,
      workspaceId: this.config.workspaceId,
      accountId: this.accountId,
      chatId: message.senderId,
      threadKey: `system:${message.senderId}`,
      senderId: message.senderId,
      messageId: message.id,
      text: buildSystemInboundText({
        text: message?.text,
        createdAt: message?.createdAt,
        systemKind,
      }),
      attachments: [],
      command: "message",
      contextToken,
      receivedAt: normalizeIsoTime(message?.createdAt) || new Date().toISOString(),
      workspaceRoot: this.resolveWorkspaceRoot(message),
    };
  }
}

function buildSystemInboundText({ text, createdAt = "", systemKind = "pulse" } = {}) {
  const body = normalizeText(text);
  const localTime = formatSystemLocalTime(createdAt);
  const effectiveKind = normalizeSystemKind(systemKind);
  const sections = [
    ...(localTime ? [`[${localTime}]`, ""] : []),
    "SYSTEM ACTION MODE: internal trigger, not user chat.",
    `Turn intent: ${resolveSystemTurnIntent(effectiveKind)}.`,
    `System kind: ${effectiveKind}.`,
    "Tool families: memory = durable; research = evolving; stone box = shareable interesting finds; task = ongoing agent work; habit = recurring rhythms that should shape today's judgment.",
    "Reminder is the default follow-up substrate.",
    "Prefer one unified first step. Start with cyberboss_pulse_review unless the trigger already gives you all needed context.",
    effectiveKind === "reminder"
      ? "This is a due reminder. Act on it now. Do not treat it as optional."
      : "This is a pulse-like trigger. Review context, decide whether to contact the user, and decide follow-up.",
    "Workflow: inspect context, inspect today's habit state when relevant, inspect any Obsidian signal, combine them into one decision, then make a follow-up decision.",
    "Habit is important, but its default channel is reminder: if a habit is still incomplete today, either remind the user now or set a reminder to check later. Research is not a default scan.",
    "If the user explicitly says a habit is done or already handled, prefer marking it done instead of leaving it conversational only.",
    "If no message is useful, do one small private action before returning silent.",
    "Prefer cyberboss_followup_decide whenever an open loop should become a reminder.",
    "Return send_message when contacting the user now is useful. Return silent only after useful private work or a clear judgment that nothing useful should be done now.",
    "Return exactly one JSON object after any tool calls:",
    "{\"action\":\"silent\"}",
    "{\"action\":\"send_message\",\"message\":\"<one short natural WeChat message>\"}",
    "No markdown fences. No reasoning. No text outside the JSON.",
  ];
  if (body) {
    sections.push("", "Trigger:", body);
  }
  return sections.join("\n").trim();
}

function formatSystemLocalTime(value) {
  const normalized = normalizeIsoTime(value);
  if (!normalized) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(normalized)).replace(/\//g, "-");
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

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSystemKind(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return "pulse";
  }
  if (["pulse", "reminder", "location", "checkin"].includes(normalized)) {
    return normalized;
  }
  return "pulse";
}

function resolveSystemTurnIntent(systemKind) {
  return normalizeSystemKind(systemKind) === "reminder" ? "reminder" : "pulse";
}

module.exports = { SystemMessageDispatcher };
