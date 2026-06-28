const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_OPEN = 40;
const MAX_DONE = 20;
const DEFAULT_CHECKBACK_MINUTES = 10;
const DEFAULT_REVIEW_MIN_MINUTES = 30;
const DEFAULT_REVIEW_MAX_MINUTES = 60;
const ACTIVE_STATUSES = new Set(["open", "paused"]);
const CLOSED_STATUSES = new Set(["done", "archived"]);
const ITEM_STATUSES = new Set(["open", "done", "dropped"]);

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
      .map((item) => normalizeActivity({
        id: crypto.randomUUID(),
        title: normalizeText(item.title),
        status: "open",
        items: [],
        reminderId: "",
        createdAt: normalizeIsoTime(item.createdAt) || now,
        updatedAt: normalizeIsoTime(item.createdAt) || now,
        reviewMinMinutes: DEFAULT_REVIEW_MIN_MINUTES,
        reviewMaxMinutes: DEFAULT_REVIEW_MAX_MINUTES,
      }))
      .filter(Boolean);
    if (!migrated.length) return;
    this.state.activities.unshift(...migrated);
    this.pruneState();
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
      this.state = normalizeActivityState(parsed);
      if (backfillMissingOpenActivityReviews(this.state)) {
        this.save();
      }
    } catch {
      this.state = { activities: [] };
    }
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  add({
    title = "",
    items,
    reminderId = "",
    reviewMinMinutes = DEFAULT_REVIEW_MIN_MINUTES,
    reviewMaxMinutes = DEFAULT_REVIEW_MAX_MINUTES,
    nextReviewAt = "",
  } = {}) {
    this.load();
    const normalizedTitle = normalizeText(title);
    if (!normalizedTitle) {
      throw new Error("Activity add requires a non-empty title.");
    }
    const now = new Date().toISOString();
    const normalizedReviewMinMinutes = normalizePositiveInteger(reviewMinMinutes, DEFAULT_REVIEW_MIN_MINUTES);
    const normalizedReviewMaxMinutes = Math.max(
      normalizedReviewMinMinutes,
      normalizePositiveInteger(reviewMaxMinutes, DEFAULT_REVIEW_MAX_MINUTES)
    );
    const activity = normalizeActivity({
      id: crypto.randomUUID(),
      title: normalizedTitle,
      status: "open",
      items: normalizeItems(items, { referenceTime: now }),
      reminderId: normalizeText(reminderId),
      nextReviewAt: normalizeIsoTime(nextReviewAt) || buildInitialNextReviewAt({
        baseTime: now,
        reviewMinMinutes: normalizedReviewMinMinutes,
        reviewMaxMinutes: normalizedReviewMaxMinutes,
      }),
      lastReviewedAt: "",
      lastProgressAt: "",
      reviewMinMinutes: normalizedReviewMinMinutes,
      reviewMaxMinutes: normalizedReviewMaxMinutes,
      createdAt: now,
      updatedAt: now,
    });
    this.state.activities.unshift(activity);
    this.pruneState();
    this.save();
    return cloneActivity(activity);
  }

  getById(id = "") {
    this.load();
    const activity = this.findActivity(id);
    return activity ? cloneActivity(activity) : null;
  }

  bindReminder({ id = "", reminderId = "" } = {}) {
    this.load();
    const activity = this.requireOpenActivity(id, "Activity bindReminder requires id.");
    activity.reminderId = normalizeText(reminderId);
    activity.updatedAt = new Date().toISOString();
    this.save();
    return cloneActivity(activity);
  }

  addItem({ id = "", text = "" } = {}) {
    this.load();
    const activity = this.requireOpenActivity(id, "Activity addItem requires id.");
    const normalizedText = normalizeText(text);
    if (!normalizedText) {
      throw new Error("Activity addItem requires non-empty text.");
    }
    const now = new Date().toISOString();
    activity.items.push({
      id: crypto.randomUUID(),
      text: normalizedText,
      status: "open",
      updatedAt: now,
      doneAt: "",
    });
    activity.lastProgressAt = now;
    activity.updatedAt = now;
    this.save();
    return cloneActivity(activity);
  }

  markItemDone({ id = "", itemId = "" } = {}) {
    this.load();
    const activity = this.requireActivity(id, "Activity markItemDone requires id.");
    const item = requireItem(activity, itemId, "Activity markItemDone requires itemId.");
    const now = new Date().toISOString();
    item.status = "done";
    item.doneAt = now;
    item.updatedAt = now;
    activity.lastProgressAt = now;
    activity.updatedAt = now;
    this.save();
    return cloneActivity(activity);
  }

  markItemDropped({ id = "", itemId = "" } = {}) {
    this.load();
    const activity = this.requireActivity(id, "Activity markItemDropped requires id.");
    const item = requireItem(activity, itemId, "Activity markItemDropped requires itemId.");
    const now = new Date().toISOString();
    item.status = "dropped";
    item.doneAt = "";
    item.updatedAt = now;
    activity.lastProgressAt = now;
    activity.updatedAt = now;
    this.save();
    return cloneActivity(activity);
  }

  updateActivityReview({
    id = "",
    nextReviewAt = "",
    lastReviewedAt = "",
    reviewMinMinutes = undefined,
    reviewMaxMinutes = undefined,
  } = {}) {
    this.load();
    const activity = this.requireActivity(id, "Activity updateActivityReview requires id.");
    const now = new Date().toISOString();
    if (nextReviewAt !== undefined) {
      activity.nextReviewAt = normalizeIsoTime(nextReviewAt);
    }
    if (lastReviewedAt !== undefined) {
      activity.lastReviewedAt = normalizeIsoTime(lastReviewedAt) || now;
    }
    if (reviewMinMinutes !== undefined) {
      activity.reviewMinMinutes = normalizePositiveInteger(reviewMinMinutes, DEFAULT_REVIEW_MIN_MINUTES);
    }
    if (reviewMaxMinutes !== undefined) {
      const normalizedMax = normalizePositiveInteger(reviewMaxMinutes, DEFAULT_REVIEW_MAX_MINUTES);
      activity.reviewMaxMinutes = Math.max(activity.reviewMinMinutes, normalizedMax);
    }
    activity.updatedAt = now;
    this.save();
    return cloneActivity(activity);
  }

  pauseActivity({ id = "" } = {}) {
    this.load();
    const activity = this.requireOpenActivity(id, "Activity pauseActivity requires id.");
    const now = new Date().toISOString();
    activity.status = "paused";
    activity.nextReviewAt = "";
    activity.updatedAt = now;
    this.save();
    return cloneActivity(activity);
  }

  reopenActivity({ id = "", nextReviewAt = "" } = {}) {
    this.load();
    const activity = this.requireActivity(id, "Activity reopenActivity requires id.");
    const now = new Date().toISOString();
    activity.status = "open";
    if (nextReviewAt) {
      activity.nextReviewAt = normalizeIsoTime(nextReviewAt);
    }
    activity.updatedAt = now;
    this.save();
    return cloneActivity(activity);
  }

  complete({ id = "" } = {}) {
    this.load();
    const activity = this.requireOpenActivity(id, "Activity complete requires id.");
    const now = new Date().toISOString();
    activity.status = "done";
    activity.completedAt = now;
    activity.nextReviewAt = "";
    activity.updatedAt = now;
    this.pruneState();
    this.save();
    return { ...cloneActivity(activity), remainingOpenCount: this.list({ limit: MAX_OPEN }).count };
  }

  drop({ id = "" } = {}) {
    this.load();
    const activity = this.requireOpenActivity(id, "Activity drop requires id.");
    const now = new Date().toISOString();
    activity.status = "archived";
    activity.archivedAt = now;
    activity.nextReviewAt = "";
    activity.updatedAt = now;
    this.pruneState();
    this.save();
    return { ...cloneActivity(activity), remainingOpenCount: this.list({ limit: MAX_OPEN }).count };
  }

  list({ limit = 20, includePaused = false, includeArchived = false, statuses = undefined } = {}) {
    this.load();
    const normalizedLimit = normalizeLimit(limit);
    const allowedStatuses = normalizeStatusFilter(statuses, includePaused, includeArchived);
    const activities = this.state.activities
      .filter((activity) => allowedStatuses.has(activity.status))
      .slice(0, normalizedLimit)
      .map(cloneActivity);
    return {
      count: activities.length,
      activities,
    };
  }

  listDone({ limit = MAX_DONE } = {}) {
    this.load();
    const activities = this.state.activities
      .filter((activity) => activity.status === "done")
      .slice(0, Math.min(normalizeLimit(limit), MAX_DONE))
      .map(cloneActivity);
    return {
      count: activities.length,
      activities,
    };
  }

  listDueReviews(nowMs = Date.now(), { limit = MAX_OPEN } = {}) {
    this.load();
    const due = this.state.activities
      .filter((activity) => activity.status === "open")
      .filter((activity) => {
        const dueAtMs = Date.parse(activity.nextReviewAt || "");
        return Number.isFinite(dueAtMs) && dueAtMs > 0 && dueAtMs <= nowMs;
      })
      .slice(0, normalizeLimit(limit))
      .map(cloneActivity);
    return {
      count: due.length,
      activities: due,
    };
  }

  allIds() {
    this.load();
    return this.state.activities.map((activity) => activity.id);
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
    return cloneActivity(removed);
  }

  countOpenItems(activity) {
    return listItemsByStatus(activity, "open").length;
  }

  countDoneItems(activity) {
    return listItemsByStatus(activity, "done").length;
  }

  listOpenItems(activity) {
    return listItemsByStatus(activity, "open").map(cloneItem);
  }

  listRecentlyDoneItems(activity, limit = 3) {
    return listItemsByStatus(activity, "done")
      .slice()
      .sort((left, right) => (Date.parse(right.doneAt || "") || 0) - (Date.parse(left.doneAt || "") || 0))
      .slice(0, Math.max(0, Number(limit) || 0))
      .map(cloneItem);
  }

  pruneState() {
    const open = this.state.activities
      .filter((activity) => ACTIVE_STATUSES.has(activity.status))
      .slice(0, MAX_OPEN);
    const done = this.state.activities
      .filter((activity) => activity.status === "done")
      .slice(0, MAX_DONE);
    const archived = this.state.activities
      .filter((activity) => activity.status === "archived");
    this.state.activities = [...open, ...done, ...archived];
  }

  findActivity(id = "") {
    const normalizedId = normalizeText(id);
    if (!normalizedId) return null;
    return this.state.activities.find((activity) => activity.id === normalizedId) || null;
  }

  requireActivity(id = "", errorText = "Activity requires id.") {
    const normalizedId = normalizeText(id);
    if (!normalizedId) {
      throw new Error(errorText);
    }
    const activity = this.findActivity(normalizedId);
    if (!activity) {
      throw new Error(`Activity not found: ${normalizedId}`);
    }
    return activity;
  }

  requireOpenActivity(id = "", errorText = "Activity requires id.") {
    const activity = this.requireActivity(id, errorText);
    if (!ACTIVE_STATUSES.has(activity.status)) {
      throw new Error(`Activity not open: ${activity.id}`);
    }
    return activity;
  }
}

function normalizeActivityState(parsed) {
  if (Array.isArray(parsed?.activities)) {
    return {
      activities: parsed.activities
        .map((activity) => normalizeActivity(activity))
        .filter(Boolean),
    };
  }
  const openActivities = Array.isArray(parsed?.open)
    ? parsed.open
      .map((activity) => normalizeActivity({ ...activity, status: normalizeText(activity?.status) || "open" }))
      .filter(Boolean)
    : [];
  const doneActivities = Array.isArray(parsed?.done)
    ? parsed.done
      .map((activity) => normalizeActivity({ ...activity, status: "done" }))
      .filter(Boolean)
    : [];
  return { activities: [...openActivities, ...doneActivities] };
}

function normalizeActivity(value) {
  if (!value || typeof value !== "object") return null;
  const id = normalizeText(value.id) || crypto.randomUUID();
  const title = normalizeText(value.title);
  if (!title) return null;
  const status = normalizeActivityStatus(value.status);
  const createdAt = normalizeIsoTime(value.createdAt) || new Date().toISOString();
  const updatedAt = normalizeIsoTime(value.updatedAt) || createdAt;
  const completedAt = status === "done"
    ? (normalizeIsoTime(value.completedAt) || updatedAt)
    : "";
  const archivedAt = status === "archived"
    ? (normalizeIsoTime(value.archivedAt) || updatedAt)
    : "";
  const activity = {
    id,
    title,
    status,
    items: normalizeItems(value.items, { referenceTime: updatedAt }),
    reminderId: normalizeText(value.reminderId),
    nextReviewAt: normalizeIsoTime(value.nextReviewAt),
    lastReviewedAt: normalizeIsoTime(value.lastReviewedAt),
    lastProgressAt: normalizeIsoTime(value.lastProgressAt),
    reviewMinMinutes: normalizePositiveInteger(value.reviewMinMinutes, DEFAULT_REVIEW_MIN_MINUTES),
    reviewMaxMinutes: Math.max(
      normalizePositiveInteger(value.reviewMinMinutes, DEFAULT_REVIEW_MIN_MINUTES),
      normalizePositiveInteger(value.reviewMaxMinutes, DEFAULT_REVIEW_MAX_MINUTES)
    ),
    createdAt,
    updatedAt,
  };
  if (completedAt) {
    activity.completedAt = completedAt;
  }
  if (archivedAt) {
    activity.archivedAt = archivedAt;
  }
  return activity;
}

function backfillMissingOpenActivityReviews(state) {
  let changed = false;
  const activities = Array.isArray(state?.activities) ? state.activities : [];
  for (const activity of activities) {
    if (activity?.status !== "open" || normalizeIsoTime(activity?.nextReviewAt)) {
      continue;
    }
    const baseTime = normalizeIsoTime(activity?.lastProgressAt)
      || normalizeIsoTime(activity?.updatedAt)
      || normalizeIsoTime(activity?.createdAt)
      || new Date().toISOString();
    activity.nextReviewAt = buildInitialNextReviewAt({
      baseTime,
      reviewMinMinutes: activity?.reviewMinMinutes,
      reviewMaxMinutes: activity?.reviewMaxMinutes,
    });
    if (activity.nextReviewAt) {
      changed = true;
    }
  }
  return changed;
}

function buildInitialNextReviewAt({ baseTime = "", reviewMinMinutes, reviewMaxMinutes } = {}) {
  const baseIso = normalizeIsoTime(baseTime) || new Date().toISOString();
  const baseMs = Date.parse(baseIso);
  if (!Number.isFinite(baseMs) || baseMs <= 0) {
    return "";
  }
  const minMinutes = normalizePositiveInteger(reviewMinMinutes, DEFAULT_REVIEW_MIN_MINUTES);
  const maxMinutes = Math.max(minMinutes, normalizePositiveInteger(reviewMaxMinutes, DEFAULT_REVIEW_MAX_MINUTES));
  const delayMinutes = pickRandomInteger(minMinutes, maxMinutes);
  return new Date(baseMs + delayMinutes * 60_000).toISOString();
}

function normalizeItems(value, { referenceTime = "" } = {}) {
  if (!Array.isArray(value)) return [];
  const fallbackTime = normalizeIsoTime(referenceTime) || new Date().toISOString();
  return value
    .map((item) => normalizeItem(item, fallbackTime))
    .filter(Boolean);
}

function normalizeItem(value, fallbackTime) {
  if (typeof value === "string") {
    const text = normalizeText(value);
    if (!text) return null;
    return {
      id: crypto.randomUUID(),
      text,
      status: "open",
      updatedAt: fallbackTime,
      doneAt: "",
    };
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const text = normalizeText(value.text || value.title);
  if (!text) return null;
  const status = normalizeItemStatus(value.status);
  const updatedAt = normalizeIsoTime(value.updatedAt) || fallbackTime;
  const doneAt = status === "done"
    ? (normalizeIsoTime(value.doneAt || value.completedAt) || updatedAt)
    : "";
  return {
    id: normalizeText(value.id) || crypto.randomUUID(),
    text,
    status,
    updatedAt,
    doneAt,
  };
}

function normalizeActivityStatus(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (ACTIVE_STATUSES.has(normalized) || CLOSED_STATUSES.has(normalized)) {
    return normalized;
  }
  return "open";
}

function normalizeItemStatus(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (ITEM_STATUSES.has(normalized)) {
    return normalized;
  }
  if (normalized === "completed") {
    return "done";
  }
  return "open";
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pickRandomInteger(min, max) {
  const normalizedMin = normalizePositiveInteger(min, DEFAULT_REVIEW_MIN_MINUTES);
  const normalizedMax = Math.max(normalizedMin, normalizePositiveInteger(max, DEFAULT_REVIEW_MAX_MINUTES));
  if (normalizedMin === normalizedMax) {
    return normalizedMin;
  }
  return normalizedMin + Math.floor(Math.random() * (normalizedMax - normalizedMin + 1));
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 20;
  return Math.min(parsed, Math.max(MAX_OPEN, MAX_DONE));
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

function cloneActivity(activity) {
  return activity ? JSON.parse(JSON.stringify(activity)) : null;
}

function cloneItem(item) {
  return item ? JSON.parse(JSON.stringify(item)) : null;
}

function listItemsByStatus(activity, status) {
  const normalizedStatus = normalizeItemStatus(status);
  const items = Array.isArray(activity?.items) ? activity.items : [];
  return items.filter((item) => normalizeItemStatus(item?.status) === normalizedStatus);
}

function requireItem(activity, itemId, errorText) {
  const normalizedItemId = normalizeText(itemId);
  if (!normalizedItemId) {
    throw new Error(errorText);
  }
  const item = Array.isArray(activity?.items)
    ? activity.items.find((candidate) => candidate.id === normalizedItemId)
    : null;
  if (!item) {
    throw new Error(`Activity item not found: ${normalizedItemId}`);
  }
  return item;
}

function normalizeStatusFilter(statuses, includePaused, includeArchived) {
  const normalized = Array.isArray(statuses)
    ? statuses.map((status) => normalizeActivityStatus(status))
    : null;
  if (normalized?.length) {
    return new Set(normalized);
  }
  const defaults = ["open"];
  if (includePaused) {
    defaults.push("paused");
  }
  if (includeArchived) {
    defaults.push("archived");
  }
  return new Set(defaults);
}

module.exports = {
  ActivityService,
  MAX_OPEN,
  MAX_DONE,
  DEFAULT_CHECKBACK_MINUTES,
  DEFAULT_REVIEW_MIN_MINUTES,
  DEFAULT_REVIEW_MAX_MINUTES,
};
