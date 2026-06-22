const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ACTIVITY_STATES = new Set(["intended", "active", "done", "dropped"]);
const OPEN_STATES = new Set(["intended", "active"]);
const MAX_ACTIVITIES = 40;
const DEFAULT_STALE_MINUTES = 30;

class ActivityService {
  constructor({ config }) {
    this.config = config;
    this.filePath = config.activityFile;
    this.state = { activities: [] };
    this.ensureParentDirectory();
    this.load();
    this.migrateTitlePool();
  }

  ensureParentDirectory() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  readStateFile(filePath) {
    if (!filePath) {
      return null;
    }
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  migrateTitlePool() {
    const poolFile = this.config?.titlePoolFile;
    if (!poolFile) {
      return;
    }
    const raw = this.readStateFile(poolFile);
    if (!raw) {
      return;
    }
    const items = Array.isArray(raw?.items) ? raw.items : [];
    if (!items.length) {
      return;
    }
    const existingIds = new Set(this.state.activities.map((activity) => activity.id));
    const migrated = items
      .map((item) => migratePoolItem(item, existingIds))
      .filter(Boolean);
    if (!migrated.length) {
      return;
    }
    this.state.activities.push(...migrated);
    this.state.activities.sort(compareActivities);
    this.save();
    console.log(`[cyberboss] migrated ${migrated.length} title-pool items into activities`);
    try {
      fs.writeFileSync(poolFile + ".migrated", JSON.stringify(raw, null, 2));
      fs.unlinkSync(poolFile);
    } catch (error) {
      console.warn(`[cyberboss] title-pool migration cleanup failed: ${error?.message || error}`);
    }
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      const activities = Array.isArray(parsed?.activities) ? parsed.activities : [];
      this.state = {
        activities: activities.map(normalizeActivity).filter(Boolean).sort(compareActivities),
      };
    } catch {
      this.state = { activities: [] };
    }
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  add({ title = "", note = "", checkBackMinutes } = {}) {
    this.load();
    const normalizedTitle = normalizeText(title);
    if (!normalizedTitle) {
      throw new Error("Activity add requires a non-empty title.");
    }
    const now = new Date().toISOString();
    const activity = normalizeActivity({
      id: crypto.randomUUID(),
      title: normalizedTitle,
      state: "intended",
      note: normalizeText(note),
      checkBackMinutes: normalizeCheckBackMinutes(checkBackMinutes),
      intendedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    this.state.activities.unshift(activity);
    this.pruneClosed();
    this.save();
    return activity;
  }

  start({ id = "", note = "" } = {}) {
    return this.transition(id, "active", { note });
  }

  complete({ id = "", note = "" } = {}) {
    return this.transition(id, "done", { note });
  }

  drop({ id = "", note = "" } = {}) {
    return this.transition(id, "dropped", { note });
  }

  transition(id, targetState, { note = "" } = {}) {
    this.load();
    const normalizedId = normalizeText(id);
    if (!normalizedId) {
      throw new Error(`Activity ${targetState} requires id.`);
    }
    const index = this.state.activities.findIndex((activity) => activity.id === normalizedId);
    if (index < 0) {
      throw new Error(`Activity not found: ${normalizedId}`);
    }
    const now = new Date().toISOString();
    const current = this.state.activities[index];
    const next = normalizeActivity({
      ...current,
      state: targetState,
      note: normalizeText(note) || current.note,
      startedAt: targetState === "active" ? (current.startedAt || now) : current.startedAt,
      completedAt: (targetState === "done" || targetState === "dropped") ? now : "",
      updatedAt: now,
    });
    this.state.activities[index] = next;
    this.state.activities.sort(compareActivities);
    this.pruneClosed();
    this.save();
    return next;
  }

  list({ state = "", includeClosed = false, limit = 20 } = {}) {
    this.load();
    const normalizedState = normalizeText(state).toLowerCase();
    const activities = this.state.activities
      .filter((activity) => {
        if (normalizedState) {
          return activity.state === normalizedState;
        }
        if (includeClosed) {
          return true;
        }
        return OPEN_STATES.has(activity.state);
      })
      .slice(0, normalizeLimit(limit));
    return {
      filePath: this.filePath,
      count: activities.length,
      activities,
    };
  }

  reviewStale({ staleMinutes = DEFAULT_STALE_MINUTES } = {}) {
    this.load();
    const thresholdMinutes = Number(staleMinutes) || DEFAULT_STALE_MINUTES;
    const nowMs = Date.now();
    const stale = this.state.activities
      .filter((activity) => activity.state === "intended")
      .filter((activity) => {
        const intendedMs = Date.parse(activity.intendedAt || activity.createdAt) || 0;
        const checkBackMs = (Number(activity.checkBackMinutes) || thresholdMinutes) * 60_000;
        return nowMs - intendedMs >= checkBackMs;
      });
    return {
      count: stale.length,
      activities: stale,
    };
  }

  remove({ id = "" } = {}) {
    this.load();
    const normalizedId = normalizeText(id);
    if (!normalizedId) {
      throw new Error("Activity remove requires id.");
    }
    const index = this.state.activities.findIndex((activity) => activity.id === normalizedId);
    if (index < 0) {
      throw new Error(`Activity not found: ${normalizedId}`);
    }
    const [removed] = this.state.activities.splice(index, 1);
    this.save();
    return removed;
  }

  pruneClosed() {
    const closed = this.state.activities.filter((activity) => !OPEN_STATES.has(activity.state));
    const open = this.state.activities.filter((activity) => OPEN_STATES.has(activity.state));
    const keptClosed = closed
      .sort(compareActivities)
      .slice(0, Math.max(0, MAX_ACTIVITIES - open.length));
    this.state.activities = [...open, ...keptClosed].sort(compareActivities);
  }
}

function migratePoolItem(item, existingIds) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const id = normalizeText(item.id);
  if (!id || existingIds.has(id)) {
    return null;
  }
  existingIds.add(id);
  const title = normalizeText(item.title);
  if (!title) {
    return null;
  }
  const createdAt = normalizeIsoTime(item.createdAt) || new Date().toISOString();
  return normalizeActivity({
    id: crypto.randomUUID(),
    title,
    state: "intended",
    note: "",
    intendedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
    sourceRef: `migrated_from_title_pool:${id}`,
  });
}

function normalizeActivity(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const id = normalizeText(value.id);
  const title = normalizeText(value.title);
  const state = ACTIVITY_STATES.has(normalizeText(value.state).toLowerCase())
    ? normalizeText(value.state).toLowerCase()
    : "intended";
  if (!id || !title) {
    return null;
  }
  const note = normalizeText(value.note);
  const intendedAt = normalizeIsoTime(value.intendedAt) || normalizeIsoTime(value.createdAt) || new Date().toISOString();
  const startedAt = normalizeIsoTime(value.startedAt);
  const completedAt = normalizeIsoTime(value.completedAt);
  const checkBackMinutes = normalizeCheckBackMinutes(value.checkBackMinutes);
  const createdAt = normalizeIsoTime(value.createdAt) || intendedAt;
  const updatedAt = normalizeIsoTime(value.updatedAt) || createdAt;
  const sourceRef = normalizeText(value.sourceRef);
  return {
    id,
    title,
    state,
    note,
    intendedAt,
    startedAt,
    completedAt,
    checkBackMinutes,
    createdAt,
    updatedAt,
    sourceRef,
  };
}

function compareActivities(left, right) {
  const leftOpen = OPEN_STATES.has(left.state);
  const rightOpen = OPEN_STATES.has(right.state);
  if (leftOpen !== rightOpen) {
    return leftOpen ? -1 : 1;
  }
  if (left.state !== right.state) {
    if (left.state === "active") return -1;
    if (right.state === "active") return 1;
    if (left.state === "intended") return -1;
    if (right.state === "intended") return 1;
  }
  const leftMs = Date.parse(left.updatedAt || left.createdAt) || 0;
  const rightMs = Date.parse(right.updatedAt || right.createdAt) || 0;
  return rightMs - leftMs;
}

function normalizeCheckBackMinutes(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.min(parsed, 1440);
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 20;
  }
  return Math.min(parsed, MAX_ACTIVITIES);
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

module.exports = { ActivityService, ACTIVITY_STATES, OPEN_STATES };
