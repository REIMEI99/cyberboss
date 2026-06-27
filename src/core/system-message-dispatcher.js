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
    const systemSource = normalizeText(message?.source);
    return {
      provider: "system",
      turnIntent: resolveSystemTurnIntent(systemKind),
      systemKind,
      systemSource,
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
        systemSource,
      }),
      attachments: [],
      command: "message",
      contextToken,
      receivedAt: normalizeIsoTime(message?.createdAt) || new Date().toISOString(),
      workspaceRoot: this.resolveWorkspaceRoot(message),
    };
  }
}

function buildSystemInboundText({ text, createdAt = "", systemKind = "pulse", systemSource = "" } = {}) {
  const body = normalizeText(text);
  const localTime = formatSystemLocalTime(createdAt);
  const effectiveKind = normalizeSystemKind(systemKind);
  const isReminder = effectiveKind === "reminder";
  const isCheckin = effectiveKind === "checkin";
  const isScheduledPulse = normalizeText(systemSource) === "random_pulse";
  const sections = [
    ...(localTime ? [`[${localTime}]`, ""] : []),
    "SYSTEM ACTION MODE: internal trigger, not user chat.",
    `Turn intent: ${resolveSystemTurnIntent(effectiveKind)}.`,
    `System kind: ${effectiveKind}.`,
    isReminder
      ? "This is a due reminder. Your default action is to send a message to the user. Do not return silent for a due reminder unless the user already confirmed completion in the current turn."
      : isCheckin
        ? "This is a contact-gap check-in. The gap threshold has already been exceeded, so your default action is to send a message to the user now."
        : isScheduledPulse
          ? "This is a scheduled life pulse. Your default action is to send a message to the user now."
          : "This is a pulse-like trigger. Review context and decide whether it is a good time to reach out now.",
    isReminder
      ? "Do not sound like a robotic alarm. You must reach out, but you may phrase it as a natural chat message that lightly carries the reminder, references current context, or opens a small real conversation."
      : isCheckin
        ? "This must still feel like a natural chat message, not a cold system ping. You may open from current context, activity, habit, memory, or a light human topic, as long as you genuinely contact the user now."
        : isScheduledPulse
          ? "This should feel like a natural life-thread message, not a robotic notification. You are expected to actually reach out in this turn."
          : "If you choose to message, prefer a natural chat tone over robotic notification wording.",
    "Default first step: use cyberboss_pulse_review unless the trigger already gives you enough context.",
    "Activity is the soul of this assistant. Read the situation in this order: current open activities (what is the user doing or about to do?), today's habit state, any Obsidian signal, memory items, whether user contact is useful now, and whether a follow-up is needed.",
    "For near-term user actions, capture them as open activities with cyberboss_activity_add; the activity auto-binds a short-cycle check-back reminder. Same-day ongoing activities should usually stay in the 10-60 minute range unless the user explicitly said much later. Use a standalone reminder only for far-future non-action follow-ups.",
    isReminder
      ? "Due reminders stay active until explicitly cleared. Do not assume the user already did it just because the reminder fired. If recent context clearly shows completion, list active reminders and clear the matching one. Otherwise, send a message to the user now."
      : isCheckin
        ? "This check-in was only queued after quiet-hours and nearby-reminder guards were satisfied. Send a short grounded check-in now. Only return silent if current context clearly shows the user explicitly asked for no message."
        : isScheduledPulse
          ? "This pulse was scheduled precisely to create a gentle proactive outreach. Send a natural message now rather than turning it into private review."
          : "If you have not contacted the user for a while, treat this as a real opportunity to reach out. Only return silent if the user explicitly said not to message, or quiet hours are active.",
    isReminder
      ? "A good reminder message can briefly mention the due thing and also sound alive: for example by checking how the user is doing, picking up the current thread, or asking one concrete next-step question."
      : isCheckin
        ? "A good check-in can be indirect and human, but it still has to be an actual outbound message in this turn."
        : isScheduledPulse
          ? "A good scheduled pulse should sound like you genuinely remembered a part of the user's life and brought it up naturally."
          : "A good pulse message should feel grounded in the user's real life, not like a generic notification.",
    "Habit closure matters. If a habit is still incomplete today, either nudge now or set a reminder to check later. If the user already confirmed completion or clean abandonment, prefer writing the habit state.",
    isReminder
      ? "For a due reminder, sending the user a message is itself a complete action. Do not require extra private maintenance work before finishing the turn."
      : isCheckin
        ? "For this fired contact-gap check-in, sending the user a message is itself a complete action. Do not downgrade it into private reflection or optional review."
        : isScheduledPulse
          ? "For this scheduled pulse, sending the user a message is itself a complete action. Do not return silent."
          : "For a pulse, silence is allowed only when the user explicitly said not to message, or quiet hours are active.",
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
