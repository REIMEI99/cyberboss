const crypto = require("crypto");

const { resolveSelectedAccount } = require("../adapters/channel/weixin/account-store");
const { SessionStore } = require("../adapters/runtime/codex/session-store");
const { CheckinConfigStore, resolveDefaultCheckinRange } = require("../core/checkin-config-store");
const { resolvePreferredSenderId, resolvePreferredWorkspaceRoot } = require("../core/default-targets");
const { SystemMessageQueueStore } = require("../core/system-message-queue-store");
const { ObsidianService } = require("../services/obsidian-service");

const INTERNAL_CHECKIN_TRIGGER_TEMPLATE = "A quiet pulse fires. First review %USER%'s current context and decide whether contact is useful now: if you do not know her situation, have finished research or seed-like findings not yet discussed, a habit genuinely fits the current scene, or she seems stalled and a small intervention would help, consider a short message. If a habit is still incomplete but the timing is not right for contact, set yourself a reminder to check again later. If you decide not to contact her, you still must do one small private action: inspect context, review habits/tasks if relevant, continue or start research when justified, capture or refine a seed-like item, remember what matters, prepare a private note, or maintain diary/timeline.";
const CHECKIN_SYSTEM_MESSAGE_SOURCE = "checkin";
const CHECKIN_SYSTEM_MESSAGE_TTL_MS = 30 * 60 * 1000;

async function runSystemCheckinPoller(config) {
  const account = resolveSelectedAccount(config);
  const queue = new SystemMessageQueueStore({ filePath: config.systemMessageQueueFile });
  const obsidian = new ObsidianService({ config });
  const checkinConfigStore = new CheckinConfigStore({ filePath: config.checkinConfigFile });
  const sessionStore = new SessionStore({ filePath: config.sessionsFile });
  const target = resolvePollerTarget({ config, account, sessionStore });
  const defaultRange = resolveDefaultCheckinRange();
  let currentRange = checkinConfigStore.getRange(defaultRange);

  console.log(`[cyberboss] checkin poller ready user=${target.senderId} workspace=${target.workspaceRoot}`);
  console.log(`[cyberboss] checkin interval range ${formatRangeMinutes(currentRange)}`);

  while (true) {
    currentRange = checkinConfigStore.getRange(defaultRange);
    const delayMs = pickRandomDelayMs(currentRange.minIntervalMs, currentRange.maxIntervalMs);
    const wakeAt = formatLocalTime(Date.now() + delayMs);
    console.log(`[cyberboss] next checkin in ${Math.round(delayMs / 60000)}m at ${wakeAt}`);
    await sleep(delayMs);

    const nowMs = Date.now();
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
      console.log("[cyberboss] checkin skipped: pending system message still in queue");
      continue;
    }

    const queued = queue.enqueue({
      id: crypto.randomUUID(),
      accountId: account.accountId,
      senderId: target.senderId,
      workspaceRoot: target.workspaceRoot,
      text: checkinTrigger,
      source: CHECKIN_SYSTEM_MESSAGE_SOURCE,
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + CHECKIN_SYSTEM_MESSAGE_TTL_MS).toISOString(),
    });
    console.log(`[cyberboss] checkin queued id=${queued.id}`);
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
    "Use this fragment only as a spark. If it points to a searchable interest, seed, object, place, media, product, or question, you may investigate and capture the finding as a task seed. If it is private reflection or work/psychological context, use it only for judgment and do not force a search.",
  ].join("\n").trim();
}

module.exports = { runSystemCheckinPoller };
