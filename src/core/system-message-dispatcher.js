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
    return {
      provider: "system",
      workspaceId: this.config.workspaceId,
      accountId: this.accountId,
      chatId: message.senderId,
      threadKey: `system:${message.senderId}`,
      senderId: message.senderId,
      messageId: message.id,
      text: buildSystemInboundText(message?.text, message?.createdAt),
      attachments: [],
      command: "message",
      contextToken,
      receivedAt: normalizeIsoTime(message?.createdAt) || new Date().toISOString(),
      workspaceRoot: this.resolveWorkspaceRoot(message),
    };
  }
}

function buildSystemInboundText(text, createdAt = "") {
  const body = normalizeText(text);
  const localTime = formatSystemLocalTime(createdAt);
  const sections = [
    ...(localTime ? [`[${localTime}]`, ""] : []),
    "SYSTEM ACTION MODE: internal trigger, not user chat.",
    "Tool families: memory = durable; research = evolving; stone box = shareable interesting finds; task = ongoing agent work; habit = recurring rhythms that should shape today's judgment.",
    "Reminder is the default follow-up substrate. When the question is how to come back to something later, the first answer should usually be to schedule a reminder.",
    "Pulse workflow step 1: context check. Figure out what the user is doing now, whether she is focused, stalled, tired, late on something, or likely to benefit from contact. Check whereabouts, recent context, timeline, diary, Obsidian, and memory as needed.",
    "Pulse workflow step 2: habit check. Habit is a default pulse module, not an optional extra. Inspect today's habit state before deciding silence. If a habit has a good contextual opening, strongly consider a short low-shame message now.",
    "Pulse workflow step 3: Obsidian fragment check. If the pulse includes an Obsidian fragment, treat it as a spark and decide whether it suggests something worth searching, feeding back, recording, or adding to the stone box.",
    "Pulse workflow step 4: decision. Combine context, habit state, and any Obsidian spark. If you do not know what she is doing, if a reminder or habit opening is timely, if she seems stuck or unfocused, or if there is a useful small intervention, a short useful message is allowed.",
    "Pulse workflow step 5: follow-up decision. Before finishing a pulse, explicitly decide whether this situation needs a reminder. If there is any plausible future checkpoint, unresolved thread, risk of delay, or value in checking back later, create the reminder by default. Only skip it when the situation is already fully resolved or another mechanism clearly covers it.",
    "Research is not a default pulse scan. Only load research when an already-active research thread clearly matters to the present context, or when the Obsidian spark naturally points into ongoing investigation.",
    "Priority 2: if you decide not to contact the user, you must still do one small private action. Do not choose silent until after doing useful private work or confirming there is truly nothing useful to do.",
    "Good private pulse actions include: create a reminder, evaluate or mark a habit, refine a task next action, add a serendipitous find to the stone box, write diary, update timeline, prepare a private synthesis, or continue a clearly relevant research topic.",
    "Return send_message when contacting the user now is useful. Return silent only after you have done private work and no message is useful now.",
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

module.exports = { SystemMessageDispatcher };
