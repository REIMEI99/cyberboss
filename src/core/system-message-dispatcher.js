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
    effectiveKind === "reminder"
      ? "This is a due reminder. Act on it now. Do not treat it as optional."
      : "This is a pulse-like trigger. Review context, decide whether to contact the user, and decide follow-up.",
    "Default first step: use cyberboss_pulse_review unless the trigger already gives you enough context.",
    "Read the situation in this order: context, today's habit state, Obsidian signal, carry-over material, whether user contact is useful now, and whether later follow-up should become a reminder.",
    "Reminder is the default follow-up substrate. If an open loop may matter later, either create a reminder or conclude clearly that no reminder is needed.",
    "Habit closure matters. If a habit is still incomplete today, either nudge now or set a reminder to check later. If the user already confirmed completion or clean abandonment, prefer writing the habit state.",
    "If you return silent, that should follow useful private work or a clear judgment that nothing useful should be done now.",
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
