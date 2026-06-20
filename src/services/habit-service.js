const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HABIT_STATUSES = new Set(["active", "paused", "archived"]);
const HABIT_CADENCES = new Set(["daily"]);
const EVENT_TYPES = new Set(["done", "incomplete", "abandoned", "skipped", "nudged", "deferred", "note"]);
const DAILY_STATE_EVENT_TYPES = new Set(["done", "incomplete", "abandoned", "skipped"]);
const DEFAULT_COOLDOWN_MINUTES = 180;
const HABIT_DAY_RESET_HOUR = 4;

class HabitService {
  constructor({ config }) {
    this.config = config;
    this.definitionsFile = config.habitDefinitionsFile;
    this.eventsFile = config.habitEventsFile;
    this.stateFile = config.habitStateFile;
    this.ensureParentDirectory();
    this.ensureDefinitionsFile();
    this.ensureEventsFile();
  }

  ensureParentDirectory() {
    fs.mkdirSync(path.dirname(this.definitionsFile), { recursive: true });
  }

  ensureDefinitionsFile() {
    if (!fs.existsSync(this.definitionsFile)) {
      fs.writeFileSync(this.definitionsFile, JSON.stringify({ habits: [] }, null, 2));
    }
  }

  ensureEventsFile() {
    if (!fs.existsSync(this.eventsFile)) {
      fs.writeFileSync(this.eventsFile, "");
    }
  }

  upsertDefinition(input = {}) {
    const state = this.loadDefinitions();
    const id = normalizeText(input.id) || slugify(input.title) || crypto.randomUUID();
    const index = state.habits.findIndex((habit) => habit.id === id);
    const now = new Date().toISOString();
    const current = index >= 0 ? state.habits[index] : null;
    const habit = normalizeHabit({
      id,
      title: input.title ?? current?.title,
      cadence: input.cadence ?? current?.cadence ?? "daily",
      status: input.status ?? current?.status ?? "active",
      preferredWindows: input.preferredWindows ?? current?.preferredWindows,
      contexts: input.contexts ?? current?.contexts,
      avoidContexts: input.avoidContexts ?? current?.avoidContexts,
      promptStyle: input.promptStyle ?? current?.promptStyle,
      cooldownMinutes: input.cooldownMinutes ?? current?.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES,
      minimumVersion: input.minimumVersion ?? current?.minimumVersion,
      notes: input.notes ?? current?.notes,
      createdAt: current?.createdAt || now,
      updatedAt: now,
    });
    if (!habit) {
      throw new Error("Invalid habit definition. Provide at least title.");
    }
    if (index >= 0) {
      state.habits[index] = habit;
    } else {
      state.habits.push(habit);
    }
    state.habits.sort(compareHabits);
    this.saveDefinitions(state);
    this.writeStateSnapshot();
    return habit;
  }

  listDefinitions({ includeArchived = false } = {}) {
    const habits = this.loadDefinitions().habits
      .filter((habit) => includeArchived || habit.status !== "archived");
    return {
      filePath: this.definitionsFile,
      count: habits.length,
      habits,
    };
  }

  statusToday({ habitId = "", date = "" } = {}) {
    const targetDate = normalizeDateKey(date) || dateKeyFor(new Date());
    const habits = this.listDefinitions({ includeArchived: false }).habits
      .filter((habit) => !habitId || habit.id === normalizeText(habitId));
    const events = this.loadEvents()
      .filter((event) => dateKeyFor(event.createdAt) === targetDate);
    const statuses = habits.map((habit) => buildHabitStatus(habit, events, Date.now()));
    const result = {
      date: targetDate,
      count: statuses.length,
      habits: statuses,
    };
    this.writeStateSnapshot(result);
    return {
      filePath: this.stateFile,
      ...result,
    };
  }

  logEvent(input = {}) {
    const habitId = normalizeText(input.habitId);
    const type = normalizeChoice(input.type, EVENT_TYPES, "");
    if (!habitId || !type) {
      throw new Error("Habit event requires habitId and type.");
    }
    const habit = this.loadDefinitions().habits.find((candidate) => candidate.id === habitId);
    if (!habit) {
      throw new Error(`Habit not found: ${habitId}`);
    }
    const event = {
      id: crypto.randomUUID(),
      habitId,
      type,
      note: normalizeText(input.note),
      source: normalizeText(input.source),
      context: normalizeText(input.context),
      createdAt: normalizeIsoTime(input.createdAt) || new Date().toISOString(),
    };
    fs.appendFileSync(this.eventsFile, `${JSON.stringify(event)}\n`);
    this.writeStateSnapshot();
    return event;
  }

  markDone({ habitId = "", note = "", source = "user", createdAt = "" } = {}) {
    return this.logEvent({ habitId, type: "done", note, source, createdAt });
  }

  markIncomplete({ habitId = "", note = "", source = "agent", createdAt = "" } = {}) {
    return this.logEvent({ habitId, type: "incomplete", note, source, createdAt });
  }

  markAbandoned({ habitId = "", note = "", source = "agent", createdAt = "" } = {}) {
    return this.logEvent({ habitId, type: "abandoned", note, source, createdAt });
  }

  markSkipped({ habitId = "", note = "", source = "agent", createdAt = "" } = {}) {
    return this.logEvent({ habitId, type: "abandoned", note, source, createdAt });
  }

  suggestNextAction({ context = "", userState = "", limit = 3 } = {}) {
    const nowMs = Date.now();
    const status = this.statusToday({}).habits;
    const normalizedContext = normalizeText(context).toLowerCase();
    const normalizedUserState = normalizeText(userState).toLowerCase();
    const candidates = status
      .filter((item) => item.habit.status === "active")
      .filter((item) => item.dailyState === "incomplete")
      .map((item) => ({
        ...item,
        score: scoreHabitOpportunity(item, `${normalizedContext} ${normalizedUserState}`, nowMs),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.habit.title.localeCompare(right.habit.title))
      .slice(0, normalizeLimit(limit));
    const best = candidates[0] || null;
    return {
      shouldContactUser: Boolean(best && best.canNudge),
      reason: best
        ? buildSuggestionReason(best)
        : "No active incomplete habit currently looks appropriate.",
      suggestions: candidates.map(buildHabitSuggestion),
    };
  }

  loadDefinitions() {
    try {
      const raw = fs.readFileSync(this.definitionsFile, "utf8");
      const parsed = JSON.parse(raw);
      const habits = Array.isArray(parsed?.habits) ? parsed.habits : [];
      return {
        habits: habits.map(normalizeHabit).filter(Boolean).sort(compareHabits),
      };
    } catch {
      return { habits: [] };
    }
  }

  saveDefinitions(state) {
    fs.writeFileSync(this.definitionsFile, JSON.stringify(state, null, 2));
  }

  loadEvents() {
    try {
      return fs.readFileSync(this.eventsFile, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          try {
            return normalizeEvent(JSON.parse(line));
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  writeStateSnapshot(snapshot = null) {
    const state = snapshot || this.statusTodayNoWrite();
    fs.writeFileSync(this.stateFile, JSON.stringify({
      updatedAt: new Date().toISOString(),
      ...state,
    }, null, 2));
  }

  statusTodayNoWrite() {
    const targetDate = dateKeyFor(new Date());
    const habits = this.listDefinitions({ includeArchived: false }).habits;
    const events = this.loadEvents().filter((event) => dateKeyFor(event.createdAt) === targetDate);
    return {
      date: targetDate,
      count: habits.length,
      habits: habits.map((habit) => buildHabitStatus(habit, events, Date.now())),
    };
  }
}

function normalizeHabit(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const id = normalizeText(value.id);
  const title = normalizeText(value.title);
  const cadence = normalizeChoice(value.cadence, HABIT_CADENCES, "daily");
  const status = normalizeChoice(value.status, HABIT_STATUSES, "active");
  const cooldownMinutes = normalizePositiveInteger(value.cooldownMinutes, DEFAULT_COOLDOWN_MINUTES);
  const createdAt = normalizeIsoTime(value.createdAt) || new Date().toISOString();
  const updatedAt = normalizeIsoTime(value.updatedAt) || createdAt;
  if (!id || !title) {
    return null;
  }
  return {
    id,
    title,
    cadence,
    status,
    preferredWindows: normalizeStringList(value.preferredWindows),
    contexts: normalizeStringList(value.contexts),
    avoidContexts: normalizeStringList(value.avoidContexts),
    promptStyle: normalizeText(value.promptStyle) || "gentle_varied",
    cooldownMinutes,
    minimumVersion: normalizeText(value.minimumVersion),
    notes: normalizeText(value.notes),
    createdAt,
    updatedAt,
  };
}

function normalizeEvent(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const id = normalizeText(value.id);
  const habitId = normalizeText(value.habitId);
  const type = normalizeChoice(value.type, EVENT_TYPES, "");
  const createdAt = normalizeIsoTime(value.createdAt);
  if (!id || !habitId || !type || !createdAt) {
    return null;
  }
  return {
    id,
    habitId,
    type,
    note: normalizeText(value.note),
    source: normalizeText(value.source),
    context: normalizeText(value.context),
    createdAt,
  };
}

function buildHabitStatus(habit, todayEvents, nowMs) {
  const habitEvents = todayEvents.filter((event) => event.habitId === habit.id);
  const stateEvent = latestEvent(habitEvents.filter((event) => DAILY_STATE_EVENT_TYPES.has(event.type)));
  const dailyState = normalizeDailyState(stateEvent?.type);
  const nudgeEvents = habitEvents.filter((event) => event.type === "nudged" || event.type === "deferred");
  const lastNudge = latestEvent(nudgeEvents);
  const lastEvent = latestEvent(habitEvents);
  const cooldownMs = habit.cooldownMinutes * 60 * 1000;
  const lastNudgeMs = lastNudge ? Date.parse(lastNudge.createdAt) : 0;
  return {
    habit,
    dailyState,
    stateEvent,
    completedToday: dailyState === "done",
    abandonedToday: dailyState === "abandoned",
    incompleteToday: dailyState === "incomplete",
    eventCount: habitEvents.length,
    lastEvent,
    lastNudgeAt: lastNudge?.createdAt || "",
    canNudge: dailyState === "incomplete" && (!lastNudgeMs || nowMs - lastNudgeMs >= cooldownMs),
  };
}

function latestEvent(events) {
  let latest = null;
  for (const event of Array.isArray(events) ? events : []) {
    if (!latest) {
      latest = event;
      continue;
    }
    const eventMs = Date.parse(event.createdAt);
    const latestMs = Date.parse(latest.createdAt);
    if (eventMs >= latestMs) {
      latest = event;
    }
  }
  return latest;
}

function scoreHabitOpportunity(status, context, nowMs) {
  if (!status.canNudge) {
    return 0;
  }
  const habit = status.habit;
  let score = 1;
  const avoidHit = habit.avoidContexts.some((item) => context.includes(item.toLowerCase()));
  if (avoidHit) {
    return 0;
  }
  for (const item of habit.contexts) {
    if (context.includes(item.toLowerCase())) {
      score += 3;
    }
  }
  for (const item of habit.preferredWindows) {
    if (context.includes(item.toLowerCase())) {
      score += 2;
    }
  }
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    hour12: false,
  }).format(new Date(nowMs)));
  if (hour >= 10 && hour <= 23) {
    score += 1;
  }
  return score;
}

function buildHabitSuggestion(item) {
  const habit = item.habit;
  return {
    habitId: habit.id,
    title: habit.title,
    shouldContactUser: item.canNudge,
    reason: buildSuggestionReason(item),
    messageGuidance: buildMessageGuidance(habit),
    fallbackPrivateAction: `Record why ${habit.title} was not nudged now, or update its context/cooldown if the timing was wrong.`,
  };
}

function buildSuggestionReason(item) {
  const habit = item.habit;
  const bits = [`today state: ${item.dailyState || "incomplete"}`];
  if (habit.preferredWindows.length) {
    bits.push(`preferred windows: ${habit.preferredWindows.join(", ")}`);
  }
  if (habit.contexts.length) {
    bits.push(`useful contexts: ${habit.contexts.join(", ")}`);
  }
  if (item.lastNudgeAt) {
    bits.push(`last nudge: ${item.lastNudgeAt}`);
  }
  return bits.join("; ");
}

function normalizeDailyState(type) {
  switch (normalizeText(type).toLowerCase()) {
    case "done":
      return "done";
    case "abandoned":
    case "skipped":
      return "abandoned";
    case "incomplete":
    default:
      return "incomplete";
  }
}

function buildMessageGuidance(habit) {
  const minimum = habit.minimumVersion
    ? ` Offer the minimum viable version: ${habit.minimumVersion}.`
    : " Offer a minimum viable version so this does not feel like a full task.";
  return `Write one fresh, context-aware, low-shame message about "${habit.title}". Avoid repeating fixed wording.${minimum}`;
}

function compareHabits(left, right) {
  if (left.status !== right.status) {
    return statusRank(left.status) - statusRank(right.status);
  }
  return left.title.localeCompare(right.title);
}

function statusRank(status) {
  return { active: 0, paused: 1, archived: 2 }[status] ?? 3;
}

function dateKeyFor(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const shifted = new Date(date.getTime() - HABIT_DAY_RESET_HOUR * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(shifted);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function normalizeDateKey(value) {
  const normalized = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function normalizeChoice(value, allowed, fallback) {
  const normalized = normalizeText(value).toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(normalizeText).filter(Boolean).slice(0, 20);
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 1440);
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 3;
  }
  return Math.min(parsed, 20);
}

function normalizeIsoTime(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { HabitService };
