const crypto = require("crypto");

const { resolveSelectedAccount } = require("../adapters/channel/weixin/account-store");
const { SessionStore } = require("../adapters/runtime/codex/session-store");
const { CheckinConfigStore, resolveDefaultCheckinRange } = require("../core/checkin-config-store");
const { resolvePreferredSenderId, resolvePreferredWorkspaceRoot } = require("../core/default-targets");
const { SystemMessageQueueStore } = require("../core/system-message-queue-store");
const { ObsidianService } = require("../services/obsidian-service");
const { RuntimeContextStore } = require("../tools/runtime-context-store");

const INTERNAL_CHECKIN_TRIGGER_TEMPLATE = "A contact-gap check-in fired because you have not contacted %USER% for a while. Send a short natural message now. Only return silent if the user explicitly said not to message, or quiet hours are active. This is not a due reminder, but it is still a mandatory reach-out trigger once fired.";
const CHECKIN_SYSTEM_MESSAGE_SOURCE = "contact_gap_pulse";
const CHECKIN_SYSTEM_MESSAGE_TTL_MS = 30 * 60 * 1000;
const CONTACT_GAP_MODULE = "contactGapFloor";
const CONTACT_GAP_POLL_INTERVAL_MS = 60_000;
const DEFAULT_REMINDER_BLOCK_WINDOW_MS = 15 * 60_000;

async function runSystemCheckinPoller(config) {
  const account = resolveSelectedAccount(config);
  const queue = new SystemMessageQueueStore({ filePath: config.systemMessageQueueFile });
  const obsidian = new ObsidianService({ config });
  const checkinConfigStore = new CheckinConfigStore({ filePath: config.checkinConfigFile });
  const sessionStore = new SessionStore({ filePath: config.sessionsFile });
  const runtimeContextStore = new RuntimeContextStore({ filePath: config.projectToolContextFile });
  const target = resolvePollerTarget({ config, account, sessionStore });
  const defaultRange = resolveDefaultCheckinRange();
  let currentRange = checkinConfigStore.getRange(defaultRange);
  const contactGapMinutes = Number.parseInt(String(config?.maxContactGapMinutes || ""), 10) > 0
    ? Number.parseInt(String(config?.maxContactGapMinutes || ""), 10)
    : 45;

  console.log(`[cyberboss] checkin poller ready user=${target.senderId} workspace=${target.workspaceRoot}`);
  console.log(`[cyberboss] pulse contact-gap threshold ${contactGapMinutes}m; trigger delay ${formatRangeMinutes(currentRange)}`);

  while (true) {
    const nowMs = Date.now();
    currentRange = checkinConfigStore.getRange(defaultRange);
    runtimeContextStore.load();
    const pulseState = runtimeContextStore.getPulseExposureModule(target.workspaceRoot, CONTACT_GAP_MODULE) || {};
    const pendingPulseDueAtMs = Date.parse(String(pulseState.pendingPulseDueAt || ""));
    if (Number.isFinite(pendingPulseDueAtMs) && pendingPulseDueAtMs > nowMs) {
      await sleep(Math.min(CONTACT_GAP_POLL_INTERVAL_MS, Math.max(1_000, pendingPulseDueAtMs - nowMs)));
      continue;
    }

    const baseCheckinTrigger = buildCheckinTrigger(config);
    const checkinTrigger = buildCheckinTrigger(config, {
      obsidianExcerpt: loadRandomObsidianExcerpt(obsidian),
    });
    const pruned = queue.pruneStaleForAccount(account.accountId, {
      source: CHECKIN_SYSTEM_MESSAGE_SOURCE,
      legacyText: baseCheckinTrigger,
      maxAgeMs: CHECKIN_SYSTEM_MESSAGE_TTL_MS,
      nowMs,
    });
    if (pruned) {
      console.log(`[cyberboss] checkin expired stale pending message count=${pruned}`);
    }

    if (queue.hasPendingForAccount(account.accountId)) {
      await sleep(CONTACT_GAP_POLL_INTERVAL_MS);
      continue;
    }

    if (isWithinQuietHours(config?.quietHoursStart, config?.quietHoursEnd)) {
      runtimeContextStore.setPulseExposureModule(target.workspaceRoot, CONTACT_GAP_MODULE, {
        pendingPulseDueAt: "",
      });
      await sleep(CONTACT_GAP_POLL_INTERVAL_MS);
      continue;
    }

    if (hasReminderDueSoon(config.reminderQueueFile, target.senderId, nowMs)) {
      runtimeContextStore.setPulseExposureModule(target.workspaceRoot, CONTACT_GAP_MODULE, {
        pendingPulseDueAt: "",
      });
      await sleep(CONTACT_GAP_POLL_INTERVAL_MS);
      continue;
    }

    const lastBotOutboundAtMs = Date.parse(String(pulseState.lastBotOutboundAt || ""));
    const gapMinutes = Number.isFinite(lastBotOutboundAtMs)
      ? Math.floor(Math.max(0, nowMs - lastBotOutboundAtMs) / 60000)
      : Infinity;
    if (gapMinutes < contactGapMinutes) {
      runtimeContextStore.setPulseExposureModule(target.workspaceRoot, CONTACT_GAP_MODULE, {
        pendingPulseDueAt: "",
      });
      await sleep(CONTACT_GAP_POLL_INTERVAL_MS);
      continue;
    }

    const lastPulseTriggeredAtMs = Date.parse(String(pulseState.lastPulseTriggeredAt || ""));
    const cooldownMs = Number.isFinite(lastPulseTriggeredAtMs)
      ? Math.max(0, nowMs - lastPulseTriggeredAtMs)
      : Infinity;
    if (cooldownMs < currentRange.minIntervalMs) {
      runtimeContextStore.setPulseExposureModule(target.workspaceRoot, CONTACT_GAP_MODULE, {
        pendingPulseDueAt: "",
      });
      const remainingCooldownMs = currentRange.minIntervalMs - cooldownMs;
      await sleep(Math.min(CONTACT_GAP_POLL_INTERVAL_MS, Math.max(1_000, remainingCooldownMs)));
      continue;
    }

    if (!Number.isFinite(pendingPulseDueAtMs) || pendingPulseDueAtMs <= 0) {
      const delayMs = pickRandomDelayMs(currentRange.minIntervalMs, currentRange.maxIntervalMs);
      const dueAtMs = nowMs + delayMs;
      runtimeContextStore.setPulseExposureModule(target.workspaceRoot, CONTACT_GAP_MODULE, {
        pendingPulseDueAt: new Date(dueAtMs).toISOString(),
      });
      console.log(`[cyberboss] contact-gap pulse armed in ${Math.round(delayMs / 60000)}m at ${formatLocalTime(dueAtMs)}`);
      await sleep(Math.min(CONTACT_GAP_POLL_INTERVAL_MS, delayMs));
      continue;
    }

    runtimeContextStore.setPulseExposureModule(target.workspaceRoot, CONTACT_GAP_MODULE, {
      pendingPulseDueAt: "",
      lastPulseTriggeredAt: new Date(nowMs).toISOString(),
    });
    const queued = queue.enqueue({
      id: crypto.randomUUID(),
      accountId: account.accountId,
      senderId: target.senderId,
      workspaceRoot: target.workspaceRoot,
      text: checkinTrigger,
      kind: "checkin",
      source: CHECKIN_SYSTEM_MESSAGE_SOURCE,
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + CHECKIN_SYSTEM_MESSAGE_TTL_MS).toISOString(),
    });
    console.log(`[cyberboss] contact-gap pulse queued id=${queued.id}`);
    await sleep(CONTACT_GAP_POLL_INTERVAL_MS);
  }
}

function resolvePollerTarget({ config, account, sessionStore }) {
  const senderId = resolvePreferredSenderId({
    config,
    accountId: account.accountId,
    explicitUser: process.env.CYBERBOSS_CHECKIN_USER_ID || "",
    sessionStore,
  });
  const workspaceRoot = resolvePreferredWorkspaceRoot({
    config,
    accountId: account.accountId,
    senderId,
    explicitWorkspace: process.env.CYBERBOSS_CHECKIN_WORKSPACE || "",
    sessionStore,
  });

  if (!senderId) {
    throw new Error("Cannot determine the WeChat user for the checkin poller. Set CYBERBOSS_CHECKIN_USER_ID or let the only active user talk to the bot once first.");
  }
  if (!workspaceRoot) {
    throw new Error("Cannot determine the workspace for the checkin poller. Set CYBERBOSS_WORKSPACE_ROOT first.");
  }

  return { senderId, workspaceRoot };
}

function pickRandomDelayMs(minIntervalMs, maxIntervalMs) {
  if (maxIntervalMs <= minIntervalMs) {
    return minIntervalMs;
  }
  return minIntervalMs + Math.floor(Math.random() * (maxIntervalMs - minIntervalMs + 1));
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatLocalTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value || "");
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date).replace(/\//g, "-");
}

function formatRangeMinutes(range) {
  return `${Math.round(range.minIntervalMs / 60000)}m-${Math.round(range.maxIntervalMs / 60000)}m`;
}

function hasReminderDueSoon(reminderQueueFile, senderId, nowMs) {
  try {
    const { ReminderQueueStore } = require("../adapters/channel/weixin/reminder-queue-store");
    const store = new ReminderQueueStore({ filePath: reminderQueueFile });
    return store
      .listAll()
      .some((reminder) => reminder.senderId === senderId && Number(reminder.dueAtMs || 0) <= nowMs + DEFAULT_REMINDER_BLOCK_WINDOW_MS);
  } catch {
    return false;
  }
}

function loadRandomObsidianExcerpt(obsidian) {
  try {
    const result = obsidian.randomDailyExcerpt({ daysBack: 45, maxChars: 700 });
    return result?.found ? result : null;
  } catch {
    return null;
  }
}

function buildCheckinTrigger(config, { obsidianExcerpt = null } = {}) {
  const userName = normalizeText(config?.userName) || "the user";
  const trigger = INTERNAL_CHECKIN_TRIGGER_TEMPLATE.replace("%USER%", userName);
  if (!obsidianExcerpt?.excerpt) {
    return trigger;
  }
  return [
    trigger,
    "",
    "Random Obsidian daily-note fragment:",
    `Source: ${obsidianExcerpt.relativePath || ""}`,
    obsidianExcerpt.excerpt,
    "",
    "Use this fragment only as a spark. If it points to a searchable interest, seed, object, place, media, product, or question, you may investigate and capture the finding as a memory item. If it is private reflection or work/psychological context, use it only for judgment and do not force a search.",
  ].join("\n").trim();
}

function isWithinQuietHours(quietHoursStart, quietHoursEnd, now = new Date()) {
  const start = parseHourMinute(quietHoursStart);
  const end = parseHourMinute(quietHoursEnd);
  if (start === null || end === null) {
    return false;
  }
  const localTime = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const parts = localTime.split(":").map(Number);
  const currentMinutes = parts[0] * 60 + parts[1];
  if (start <= end) {
    return currentMinutes >= start && currentMinutes < end;
  }
  return currentMinutes >= start || currentMinutes < end;
}

function parseHourMinute(value) {
  if (typeof value !== "string") {
    return null;
  }
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

module.exports = { runSystemCheckinPoller };
