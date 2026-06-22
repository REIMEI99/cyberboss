const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_OPEN = 40;
const MAX_DONE = 5;
const DEFAULT_CHECKBACK_MINUTES = 10;

class ActivityService {
  constructor({ config }) {
    this.config = config;
    this.filePath = config.activityFile;
    this.state = { open: [], done: [] };
    this.ensureParentDirectory();
    this.load();
    this.migrateTitlePool();
  }

  ensureParentDirectory() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  readStateFile(filePath) {
    if (!filePath) return null;
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  migrateTitlePool() {
    const poolFile = this.config?.titlePoolFile;
    if (!poolFile) return;
    const raw = this.readStateFile(poolFile);
    if (!raw) return;
    const items = Array.isArray(raw?.items) ? raw.items : [];
    if (!items.length) return;
    const now = new Date().toISOString();
    const migrated = items
      .filter((item) => item && normalizeText(item.title))
      .map((item) => ({
        id: crypto.randomUUID(),
        title: normalizeText(item.title),
        reminderId: "",
        createdAt: normalizeIsoTime(item.createdAt) || now,
      }));
    if (!migrated.length) return;
    this.state.open.push(...migrated);
    this.pruneOpen();
    this.save();
    console.log(`[cyberboss] migrated ${migrated.length} title-pool items into open activities`);
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
      // Migrate old format { activities: [...] } to { open: [...], done: [...] }
      if (Array.isArray(parsed?.activities) && !Array.isArray(parsed?.open)) {
        this.migrateOldFormat(parsed.activities);
        return;
      }
      this.state = {
        open: Array.isArray(parsed?.open) ? parsed.open.map(normalizeActivity).filter(Boolean) : [],
        done: Array.isArray(parsed?.done) ? parsed.done.map(normalizeActivity).filter(Boolean).slice(0, MAX_DONE) : [],
      };
    } catch {
      this.state = { open: [], done: [] };
    }
  }

  migrateOldFormat(activities) {
    const now = new Date().toISOString();
    this.state = {
      open: activities
        .filter((a) => a && (a.state === "intended" || a.state === "active"))
        .map((a) => ({
          id: a.id || crypto.randomUUID(),
          title: normalizeText(a.title),
          reminderId: "",
          createdAt: normalizeIsoTime(a.createdAt) || normalizeIsoTime(a.intendedAt) || now,
        }))
        .filter((a) => a.title)
        .slice(0, MAX_OPEN),
      done: activities
        .filter((a) => a && a.state === "done")
        .map((a) => ({
          id: a.id || crypto.randomUUID(),
          title: normalizeText(a.title),
          reminderId: "",
          createdAt: normalizeIsoTime(a.createdAt) || now,
          completedAt: normalizeIsoTime(a.completedAt) || normalizeIsoTime(a.updatedAt) || now,
        }))
        .filter((a) => a.title)
        .slice(0, MAX_DONE),
    };
    this.save();
    console.log(`[cyberboss] migrated old activity format: ${this.state.open.length} open, ${this.state.done.length} done`);
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  add({ title = "", reminderId = "" } = {}) {
    this.load();
    const normalizedTitle = normalizeText(title);
    if (!normalizedTitle) {
      throw new Error("Activity add requires a non-empty title.");
    }
    const now = new Date().toISOString();
    const activity = {
      id: crypto.randomUUID(),
      title: normalizedTitle,
      reminderId: normalizeText(reminderId),
      createdAt: now,
    };
    this.state.open.unshift(activity);
    this.pruneOpen();
    this.save();
    return activity;
  }

  complete({ id = "" } = {}) {
    this.load();
    const normalizedId = normalizeText(id);
    if (!normalizedId) {
      throw new Error("Activity complete requires id.");
    }
    const index = this.state.open.findIndex((a) => a.id === normalizedId);
    if (index < 0) {
      throw new Error(`Activity not found: ${normalizedId}`);
    }
    const [activity] = this.state.open.splice(index, 1);
    const now = new Date().toISOString();
    const doneActivity = { ...activity, completedAt: now };
    this.state.done.unshift(doneActivity);
    this.state.done = this.state.done.slice(0, MAX_DONE);
    this.save();
    return { ...doneActivity, remainingOpenCount: this.state.open.length };
  }

  drop({ id = "" } = {}) {
    this.load();
    const normalizedId = normalizeText(id);
    if (!normalizedId) {
      throw new Error("Activity drop requires id.");
    }
    const index = this.state.open.findIndex((a) => a.id === normalizedId);
    if (index < 0) {
      throw new Error(`Activity not found: ${normalizedId}`);
    }
    const [activity] = this.state.open.splice(index, 1);
    this.save();
    return { ...activity, remainingOpenCount: this.state.open.length };
  }

  list({ limit = 20 } = {}) {
    this.load();
    const activities = this.state.open.slice(0, normalizeLimit(limit));
    return {
      count: activities.length,
      activities,
    };
  }

  listDone({ limit = MAX_DONE } = {}) {
    this.load();
    const activities = this.state.done.slice(0, Math.min(limit, MAX_DONE));
    return {
      count: activities.length,
      activities,
    };
  }

  allIds() {
    this.load();
    return [
      ...this.state.open.map((a) => a.id),
      ...this.state.done.map((a) => a.id),
    ];
  }

  remove({ id = "" } = {}) {
    this.load();
    const normalizedId = normalizeText(id);
    if (!normalizedId) {
      throw new Error("Activity remove requires id.");
    }
    let index = this.state.open.findIndex((a) => a.id === normalizedId);
    if (index >= 0) {
      const [removed] = this.state.open.splice(index, 1);
      this.save();
      return removed;
    }
    index = this.state.done.findIndex((a) => a.id === normalizedId);
    if (index >= 0) {
      const [removed] = this.state.done.splice(index, 1);
      this.save();
      return removed;
    }
    throw new Error(`Activity not found: ${normalizedId}`);
  }

  pruneOpen() {
    if (this.state.open.length > MAX_OPEN) {
      this.state.open = this.state.open.slice(0, MAX_OPEN);
    }
  }
}

function normalizeActivity(value) {
  if (!value || typeof value !== "object") return null;
  const id = normalizeText(value.id);
  const title = normalizeText(value.title);
  if (!id || !title) return null;
  const result = {
    id,
    title,
    reminderId: normalizeText(value.reminderId),
    createdAt: normalizeIsoTime(value.createdAt) || new Date().toISOString(),
  };
  const completedAt = normalizeIsoTime(value.completedAt);
  if (completedAt) {
    result.completedAt = completedAt;
  }
  return result;
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 20;
  return Math.min(parsed, MAX_OPEN);
}

function normalizeIsoTime(value) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { ActivityService, MAX_OPEN, MAX_DONE, DEFAULT_CHECKBACK_MINUTES };
