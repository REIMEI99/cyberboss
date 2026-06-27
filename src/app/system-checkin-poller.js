const crypto = require("crypto");

const { resolveSelectedAccount } = require("../adapters/channel/weixin/account-store");
const { SessionStore } = require("../adapters/runtime/codex/session-store");
const { PulseConfigStore, resolveDefaultPulseRange } = require("../core/pulse-config-store");
const { resolvePreferredSenderId, resolvePreferredWorkspaceRoot } = require("../core/default-targets");
const { SystemMessageQueueStore } = require("../core/system-message-queue-store");
const { AgentMemoryService } = require("../services/agent-memory-service");
const { ObsidianService } = require("../services/obsidian-service");
const { RuntimeContextStore } = require("../tools/runtime-context-store");

const INTERNAL_CHECKIN_TRIGGER_TEMPLATE = "A contact-gap check-in fired because you have not contacted %USER% for a while. Send a short natural message now. Only return silent if the user explicitly said not to message, or quiet hours are active. This is not a due reminder, but it is still a mandatory reach-out trigger once fired.";
const INTERNAL_PULSE_TRIGGER_TEMPLATE = "A scheduled life pulse fired. Send one short natural message to the user now. This is not a due reminder and not a contact-gap rescue. It is a proactive life-thread outreach, so do not return silent.";
const CHECKIN_SYSTEM_MESSAGE_SOURCE = "contact_gap_pulse";
const CHECKIN_SYSTEM_MESSAGE_TTL_MS = 30 * 60 * 1000;
const RANDOM_PULSE_SYSTEM_MESSAGE_SOURCE = "random_pulse";
const RANDOM_PULSE_SYSTEM_MESSAGE_TTL_MS = 60 * 60 * 1000;
const CONTACT_GAP_MODULE = "contactGapFloor";
const RANDOM_PULSE_MODULE = "scheduled_pulse";
const PULSE_MEMORY_SEEDS_MODULE = "pulse_memory_seeds";
const PULSE_MEMORY_SEED_COUNT = 2;
const PULSE_MEMORY_SEED_HISTORY_WINDOW = 10;
const CONTACT_GAP_POLL_INTERVAL_MS = 60_000;
const DEFAULT_REMINDER_BLOCK_WINDOW_MS = 15 * 60_000;

async function runSystemCheckinPoller(config) {
  const account = resolveSelectedAccount(config);
  const queue = new SystemMessageQueueStore({ filePath: config.systemMessageQueueFile });
  const agentMemory = new AgentMemoryService({ config });
  const obsidian = new ObsidianService({ config });
  const pulseConfigStore = new PulseConfigStore({ filePath: config.pulseConfigFile });
  const sessionStore = new SessionStore({ filePath: config.sessionsFile });
  const runtimeContextStore = new RuntimeContextStore({ filePath: config.projectToolContextFile });
  const target = resolvePollerTarget({ config, account, sessionStore });
  const defaultRange = resolveDefaultPulseRange();
  let pulseRange = pulseConfigStore.getRange(defaultRange);
  const contactGapMinutes = Number.parseInt(String(config?.maxContactGapMinutes || ""), 10) > 0
    ? Number.parseInt(String(config?.maxContactGapMinutes || ""), 10)
    : 45;

  console.log(`[cyberboss] checkin poller ready user=${target.senderId} workspace=${target.workspaceRoot}`);
  console.log(`[cyberboss] contact-gap threshold ${contactGapMinutes}m`);
  console.log(`[cyberboss] scheduled pulse interval ${formatRangeMinutes(pulseRange)}`);

  while (true) {
    const nowMs = Date.now();
    pulseRange = pulseConfigStore.getRange(defaultRange);
    runtimeContextStore.load();
    const contactGapState = runtimeContextStore.getPulseExposureModule(target.workspaceRoot, CONTACT_GAP_MODULE) || {};
    const randomPulseState = runtimeContextStore.getPulseExposureModule(target.workspaceRoot, RANDOM_PULSE_MODULE) || {};
    const pendingPulseDueAtMs = Date.parse(String(randomPulseState.pendingPulseDueAt || ""));
    const baseCheckinTrigger = buildCheckinTrigger(config);
    const basePulseTrigger = buildPulseTrigger(config);
    const memorySeeds = pickPulseMemorySeeds({
      agentMemory,
      runtimeContextStore,
      workspaceRoot: target.workspaceRoot,
      limit: PULSE_MEMORY_SEED_COUNT,
    });
    const pulseTrigger = buildPulseTrigger(config, {
      obsidianExcerpt: loadRandomObsidianExcerpt(obsidian),
      memorySeeds,
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
    queue.pruneStaleForAccount(account.accountId, {
      source: RANDOM_PULSE_SYSTEM_MESSAGE_SOURCE,
      legacyText: basePulseTrigger,
      maxAgeMs: RANDOM_PULSE_SYSTEM_MESSAGE_TTL_MS,
      nowMs,
    });

    if (queue.hasPendingForAccount(account.accountId)) {
      await sleep(CONTACT_GAP_POLL_INTERVAL_MS);
      continue;
    }

    const quietHoursActive = isWithinQuietHours(config?.quietHoursStart, config?.quietHoursEnd);
    const reminderDueSoon = hasReminderDueSoon(config.reminderQueueFile, target.senderId, nowMs);

    const lastBotOutboundAtMs = Date.parse(String(contactGapState.lastBotOutboundAt || ""));
    const gapMinutes = Number.isFinite(lastBotOutboundAtMs)
      ? Math.floor(Math.max(0, nowMs - lastBotOutboundAtMs) / 60000)
      : Infinity;
    if (!quietHoursActive && !reminderDueSoon && gapMinutes >= contactGapMinutes) {
      const queued = queue.enqueue({
        id: crypto.randomUUID(),
        accountId: account.accountId,
        senderId: target.senderId,
        workspaceRoot: target.workspaceRoot,
        text: buildCheckinTrigger(config),
        kind: "checkin",
        source: CHECKIN_SYSTEM_MESSAGE_SOURCE,
        createdAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + CHECKIN_SYSTEM_MESSAGE_TTL_MS).toISOString(),
      });
      console.log(`[cyberboss] contact-gap checkin queued id=${queued.id}`);
      await sleep(CONTACT_GAP_POLL_INTERVAL_MS);
      continue;
    }

    if (!Number.isFinite(pendingPulseDueAtMs) || pendingPulseDueAtMs <= 0) {
      const delayMs = pickRandomDelayMs(pulseRange.minIntervalMs, pulseRange.maxIntervalMs);
      const dueAtMs = nowMs + delayMs;
      runtimeContextStore.setPulseExposureModule(target.workspaceRoot, RANDOM_PULSE_MODULE, {
        pendingPulseDueAt: new Date(dueAtMs).toISOString(),
      });
      console.log(`[cyberboss] scheduled pulse armed in ${Math.round(delayMs / 60000)}m at ${formatLocalTime(dueAtMs)}`);
    }

    if (!quietHoursActive && !reminderDueSoon && Number.isFinite(pendingPulseDueAtMs) && pendingPulseDueAtMs > 0 && pendingPulseDueAtMs <= nowMs) {
      runtimeContextStore.setPulseExposureModule(target.workspaceRoot, RANDOM_PULSE_MODULE, {
        pendingPulseDueAt: "",
        lastPulseTriggeredAt: new Date(nowMs).toISOString(),
      });
      const queued = queue.enqueue({
        id: crypto.randomUUID(),
        accountId: account.accountId,
        senderId: target.senderId,
        workspaceRoot: target.workspaceRoot,
        text: pulseTrigger,
        kind: "pulse",
        source: RANDOM_PULSE_SYSTEM_MESSAGE_SOURCE,
        createdAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + RANDOM_PULSE_SYSTEM_MESSAGE_TTL_MS).toISOString(),
      });
      console.log(`[cyberboss] scheduled pulse queued id=${queued.id}`);
    }
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

function buildCheckinTrigger(config) {
  const userName = normalizeText(config?.userName) || "the user";
  return INTERNAL_CHECKIN_TRIGGER_TEMPLATE.replace("%USER%", userName);
}

function buildPulseTrigger(config, { obsidianExcerpt = null, memorySeeds = [] } = {}) {
  const userName = normalizeText(config?.userName) || "the user";
  const lines = [INTERNAL_PULSE_TRIGGER_TEMPLATE.replace("%USER%", userName)];
  const normalizedSeeds = Array.isArray(memorySeeds)
    ? memorySeeds.map(normalizePulseMemorySeed).filter(Boolean)
    : [];
  if (normalizedSeeds.length) {
    lines.push(
      "",
      "Random longer-life seeds to bring into this outreach:",
      ...normalizedSeeds.map((seed, index) => `${index + 1}. ${formatPulseMemorySeed(seed)}`),
      "",
      normalizedSeeds.length >= 2
        ? "In this pulse, naturally mention at least one of these seeds, and preferably weave both in if it still sounds like one normal chat message."
        : "In this pulse, naturally mention this seed instead of leaving the message empty or generic.",
      "Do not dump them as a list or sound like a reminder app. Turn them into one natural message that feels like you remembered part of the user's longer life thread."
    );
  }
  if (!obsidianExcerpt?.excerpt) {
    return lines.join("\n").trim();
  }
  lines.push(
    "",
    "Random Obsidian daily-note fragment:",
    `Source: ${obsidianExcerpt.relativePath || ""}`,
    obsidianExcerpt.excerpt,
    "",
    "Use this fragment only as a spark. If it points to a searchable interest, seed, object, place, media, product, or question, you may investigate and capture the finding as a memory item. If it is private reflection or work/psychological context, use it only for judgment and do not force a search.",
  );
  return lines.join("\n").trim();
}

function pickPulseMemorySeeds({
  agentMemory,
  runtimeContextStore,
  workspaceRoot = "",
  limit = PULSE_MEMORY_SEED_COUNT,
} = {}) {
  const result = agentMemory?.list?.({ includeArchived: false, limit: 200 });
  const memories = Array.isArray(result?.memories) ? result.memories : [];
  const candidates = memories
    .map(normalizePulseMemorySeed)
    .filter(Boolean)
    .filter((item) => item.type === "wishseed" || item.type === "concern");
  if (!candidates.length) {
    return [];
  }

  const shownSet = getPulseShownSeedIdSet(runtimeContextStore, workspaceRoot);
  const unseenWishseed = shuffleArray(candidates.filter((item) => item.type === "wishseed" && !shownSet.has(item.id)));
  const unseenConcern = shuffleArray(candidates.filter((item) => item.type === "concern" && !shownSet.has(item.id)));
  const seenWishseed = shuffleArray(candidates.filter((item) => item.type === "wishseed" && shownSet.has(item.id)));
  const seenConcern = shuffleArray(candidates.filter((item) => item.type === "concern" && shownSet.has(item.id)));

  const picked = [];
  appendUniqueSeeds(picked, unseenWishseed, limit);
  appendUniqueSeeds(picked, unseenConcern, limit);
  appendUniqueSeeds(picked, seenWishseed, limit);
  appendUniqueSeeds(picked, seenConcern, limit);

  if (!picked.length) {
    return [];
  }
  recordPulseShownSeedIds(runtimeContextStore, workspaceRoot, picked.map((item) => item.id));
  return picked;
}

function normalizePulseMemorySeed(memory) {
  if (!memory || typeof memory !== "object") {
    return null;
  }
  const id = normalizeText(memory.id);
  const type = normalizeText(memory.type).toLowerCase();
  const subject = normalizeText(memory.subject);
  const content = normalizeText(memory.content);
  if (!id || !subject || !content) {
    return null;
  }
  const status = normalizeText(memory.status).toLowerCase();
  if (status && status !== "active") {
    return null;
  }
  if (normalizeText(memory.completedAt)) {
    return null;
  }
  return { id, type, subject, content };
}

function formatPulseMemorySeed(seed) {
  const label = seed.type === "concern" ? "concern" : "wishseed";
  const content = seed.content === seed.subject
    ? seed.subject
    : `${seed.subject} - ${seed.content}`;
  return `[${label}] ${content}`;
}

function appendUniqueSeeds(target, pool, limit) {
  for (const item of Array.isArray(pool) ? pool : []) {
    if (target.length >= limit) {
      return;
    }
    if (!target.some((existing) => existing.id === item.id)) {
      target.push(item);
    }
  }
}

function shuffleArray(items) {
  const list = Array.isArray(items) ? items.slice() : [];
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = list[index];
    list[index] = list[swapIndex];
    list[swapIndex] = current;
  }
  return list;
}

function getPulseShownSeedIdSet(runtimeContextStore, workspaceRoot = "") {
  const state = runtimeContextStore?.getPulseExposureModule?.(workspaceRoot, PULSE_MEMORY_SEEDS_MODULE);
  const rounds = Array.isArray(state?.shownRounds) ? state.shownRounds : [];
  return new Set(rounds.flat().map(normalizeText).filter(Boolean));
}

function recordPulseShownSeedIds(runtimeContextStore, workspaceRoot = "", ids = []) {
  const moduleState = runtimeContextStore?.getPulseExposureModule?.(workspaceRoot, PULSE_MEMORY_SEEDS_MODULE) || {};
  const rounds = Array.isArray(moduleState?.shownRounds) ? moduleState.shownRounds : [];
  const nextRound = (Array.isArray(ids) ? ids : []).map(normalizeText).filter(Boolean);
  runtimeContextStore?.setPulseExposureModule?.(workspaceRoot, PULSE_MEMORY_SEEDS_MODULE, {
    shownRounds: [...rounds, nextRound].slice(-PULSE_MEMORY_SEED_HISTORY_WINDOW),
  });
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

module.exports = {
  runSystemCheckinPoller,
  buildCheckinTrigger,
  buildPulseTrigger,
  pickPulseMemorySeeds,
};
