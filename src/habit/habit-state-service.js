const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HABIT_STATUSES = new Set(["active", "paused", "archived"]);
const HABIT_CADENCES = new Set(["daily"]);
const EVENT_TYPES = new Set(["done", "incomplete", "abandoned", "skipped", "nudged", "deferred", "note"]);
const DAILY_STATE_EVENT_TYPES = new Set(["done", "incomplete", "abandoned", "skipped"]);
const DEFAULT_COOLDOWN_MINUTES = 180;
const DEFAULT_HABIT_DAY_RESET_HOUR = 4;
const DEFAULT_HABIT_TIMEZONE = "Asia/Shanghai";

class HabitStateService {
  constructor({
    definitionsFile,
    eventsFile,
    stateFile,
    heatmapFile,
    timezone = DEFAULT_HABIT_TIMEZONE,
    dayResetHour = DEFAULT_HABIT_DAY_RESET_HOUR,
  } = {}) {
    this.definitionsFile = normalizeRequiredPath(definitionsFile, "definitionsFile");
    this.eventsFile = normalizeRequiredPath(eventsFile, "eventsFile");
    this.stateFile = normalizeRequiredPath(stateFile, "stateFile");
    this.heatmapFile = normalizeRequiredPath(heatmapFile, "heatmapFile");
    this.timezone = normalizeText(timezone) || DEFAULT_HABIT_TIMEZONE;
    this.dayResetHour = normalizeDayResetHour(dayResetHour);
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

  history({ habitId = "", from = "", to = "", days = 120, includeArchived = false } = {}) {
    const range = resolveHistoryRange({
      from,
      to,
      days,
      timezone: this.timezone,
      dayResetHour: this.dayResetHour,
    });
    const habits = this.listDefinitions({ includeArchived }).habits
      .filter((habit) => !habitId || habit.id === normalizeText(habitId));
    const habitIds = new Set(habits.map((habit) => habit.id));
    const allEvents = this.loadEvents()
      .filter((event) => habitIds.has(event.habitId))
      .filter((event) => {
        const dateKey = dateKeyFor(event.createdAt, this.timezone, this.dayResetHour);
        return dateKey >= range.from && dateKey <= range.to;
      });
    const dates = enumerateDateKeys(range.from, range.to, this.timezone, this.dayResetHour);
    const items = habits.map((habit) => buildHabitHistoryRow({
      habit,
      dates,
      events: allEvents.filter((event) => event.habitId === habit.id),
      timezone: this.timezone,
      dayResetHour: this.dayResetHour,
    }));
    return {
      filePath: this.heatmapFile,
      from: range.from,
      to: range.to,
      days: dates.length,
      count: items.length,
      dates,
      habits: items,
    };
  }

  exportHeatmap(args = {}) {
    const snapshot = this.history({
      ...args,
      includeArchived: args.includeArchived !== false,
    });
    const payload = {
      updatedAt: new Date().toISOString(),
      ...snapshot,
    };
    fs.writeFileSync(this.heatmapFile, JSON.stringify(payload, null, 2));
    return {
      filePath: this.heatmapFile,
      ...payload,
    };
  }

  statusToday({ habitId = "", date = "" } = {}) {
    const targetDate = normalizeDateKey(date) || dateKeyFor(new Date(), this.timezone, this.dayResetHour);
    const habits = this.listDefinitions({ includeArchived: false }).habits
      .filter((habit) => !habitId || habit.id === normalizeText(habitId));
    const events = this.loadEvents()
      .filter((event) => dateKeyFor(event.createdAt, this.timezone, this.dayResetHour) === targetDate);
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

  getTodayClosureSnapshot() {
    const state = this.statusTodayNoWrite();
    const date = state.date;
    const stateEvents = this.loadEvents()
      .filter((event) => DAILY_STATE_EVENT_TYPES.has(event.type))
      .filter((event) => dateKeyFor(event.createdAt, this.timezone, this.dayResetHour) === date);
    const signature = state.habits
      .map((item) => `${item?.habit?.id || ""}:${item?.dailyState || "none"}`)
      .sort()
      .join("|");
    return {
      date,
      habitCount: Array.isArray(state.habits) ? state.habits.length : 0,
      stateEventCount: stateEvents.length,
      signature,
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
    this.writeHeatmapSnapshot();
  }

  statusTodayNoWrite() {
    const targetDate = dateKeyFor(new Date(), this.timezone, this.dayResetHour);
    const habits = this.listDefinitions({ includeArchived: false }).habits;
    const events = this.loadEvents().filter((event) => dateKeyFor(event.createdAt, this.timezone, this.dayResetHour) === targetDate);
    return {
      date: targetDate,
      count: habits.length,
      habits: habits.map((habit) => buildHabitStatus(habit, events, Date.now())),
    };
  }

  writeHeatmapSnapshot() {
    try {
      this.exportHeatmap({ days: 365, includeArchived: true });
    } catch {
      // Keep habit writes resilient even if analytics export fails.
    }
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

function buildHabitHistoryRow({ habit, dates, events, timezone, dayResetHour }) {
  const eventsByDate = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    const dateKey = dateKeyFor(event.createdAt, timezone, dayResetHour);
    if (!eventsByDate.has(dateKey)) {
      eventsByDate.set(dateKey, []);
    }
    eventsByDate.get(dateKey).push(event);
  }

  const cells = dates.map((date) => {
    const dayEvents = eventsByDate.get(date) || [];
    const stateEvent = latestEvent(dayEvents.filter((event) => DAILY_STATE_EVENT_TYPES.has(event.type)));
    const dailyState = normalizeDailyState(stateEvent?.type);
    return {
      date,
      state: dailyState,
      score: stateScoreFor(dailyState, dayEvents.length > 0),
      eventCount: dayEvents.length,
      stateEventType: stateEvent?.type || "",
      lastEventAt: latestEvent(dayEvents)?.createdAt || "",
    };
  });

  const summary = cells.reduce((accumulator, cell) => {
    accumulator[cell.state] = (accumulator[cell.state] || 0) + 1;
    if (cell.state === "done") {
      accumulator.completionRateDenominator += 1;
    }
    if (cell.state === "incomplete" || cell.state === "abandoned" || cell.state === "done") {
      accumulator.trackedDays += 1;
    }
    return accumulator;
  }, {
    done: 0,
    incomplete: 0,
    abandoned: 0,
    none: 0,
    trackedDays: 0,
    completionRateDenominator: 0,
  });

  const completionRate = summary.trackedDays > 0
    ? Number((summary.done / summary.trackedDays).toFixed(4))
    : 0;

  return {
    habit,
    summary: {
      doneDays: summary.done,
      incompleteDays: summary.incomplete,
      abandonedDays: summary.abandoned,
      emptyDays: summary.none,
      trackedDays: summary.trackedDays,
      completionRate,
    },
    cells,
  };
}

function normalizeDailyState(type) {
  switch (normalizeText(type).toLowerCase()) {
    case "done":
      return "done";
    case "abandoned":
    case "skipped":
      return "abandoned";
    case "incomplete":
      return "incomplete";
    case "":
      return "none";
    default:
      return "incomplete";
  }
}

function stateScoreFor(state, hasEvents) {
  if (!hasEvents || state === "none") {
    return null;
  }
  if (state === "done") {
    return 1;
  }
  if (state === "abandoned") {
    return -1;
  }
  return 0;
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

function dateKeyFor(value, timezone = DEFAULT_HABIT_TIMEZONE, dayResetHour = DEFAULT_HABIT_DAY_RESET_HOUR) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const shifted = new Date(date.getTime() - dayResetHour * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(shifted);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function resolveHistoryRange({
  from = "",
  to = "",
  days = 120,
  timezone = DEFAULT_HABIT_TIMEZONE,
  dayResetHour = DEFAULT_HABIT_DAY_RESET_HOUR,
} = {}) {
  const normalizedFrom = normalizeDateKey(from);
  const normalizedTo = normalizeDateKey(to);
  if (normalizedFrom && normalizedTo && normalizedFrom <= normalizedTo) {
    return { from: normalizedFrom, to: normalizedTo };
  }
  const dayCount = normalizeHistoryDays(days);
  const endDate = normalizedTo
    ? dateFromDateKey(normalizedTo, timezone, dayResetHour)
    : shiftedDateByRule(new Date(), timezone, dayResetHour);
  const startDate = normalizedFrom
    ? dateFromDateKey(normalizedFrom, timezone, dayResetHour)
    : new Date(endDate.getTime() - (dayCount - 1) * 24 * 60 * 60 * 1000);
  const ordered = startDate.getTime() <= endDate.getTime()
    ? { fromDate: startDate, toDate: endDate }
    : { fromDate: endDate, toDate: startDate };
  return {
    from: dateKeyFor(ordered.fromDate, timezone, dayResetHour),
    to: dateKeyFor(ordered.toDate, timezone, dayResetHour),
  };
}

function enumerateDateKeys(from, to, timezone = DEFAULT_HABIT_TIMEZONE, dayResetHour = DEFAULT_HABIT_DAY_RESET_HOUR) {
  const start = dateFromDateKey(from, timezone, dayResetHour);
  const end = dateFromDateKey(to, timezone, dayResetHour);
  const dates = [];
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += 24 * 60 * 60 * 1000) {
    dates.push(dateKeyFor(new Date(cursor), timezone, dayResetHour));
  }
  return dates;
}

function normalizeHistoryDays(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 120;
  }
  return Math.min(parsed, 3660);
}

function dateFromDateKey(
  value,
  timezone = DEFAULT_HABIT_TIMEZONE,
  dayResetHour = DEFAULT_HABIT_DAY_RESET_HOUR,
) {
  const normalized = normalizeDateKey(value) || dateKeyFor(new Date(), timezone, dayResetHour);
  const hour = String(dayResetHour).padStart(2, "0");
  return new Date(`${normalized}T${hour}:00:00+08:00`);
}

function shiftedDateByRule(value, timezone = DEFAULT_HABIT_TIMEZONE, dayResetHour = DEFAULT_HABIT_DAY_RESET_HOUR) {
  return dateFromDateKey(dateKeyFor(value, timezone, dayResetHour), timezone, dayResetHour);
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

function normalizeRequiredPath(value, fieldName) {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`HabitStateService requires ${fieldName}.`);
  }
  return path.resolve(normalized);
}

function normalizeDayResetHour(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23) {
    return DEFAULT_HABIT_DAY_RESET_HOUR;
  }
  return parsed;
}

module.exports = {
  HabitStateService,
  DEFAULT_COOLDOWN_MINUTES,
  DEFAULT_HABIT_DAY_RESET_HOUR,
  DEFAULT_HABIT_TIMEZONE,
};
