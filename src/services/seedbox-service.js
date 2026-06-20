const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SEEDBOX_KINDS = new Set(["seed", "concern", "wish", "research", "followup", "find", "explore", "remember", "maintenance"]);
const SEEDBOX_STATUSES = new Set(["pending", "active", "waiting", "done", "cancelled"]);
const SEEDBOX_PRIORITIES = new Set(["low", "normal", "high"]);
const DELIVERABLES = new Set(["silent", "message", "diary", "timeline", "briefing", "file"]);

class SeedboxService {
  constructor({ config }) {
    this.config = config;
    this.filePath = config.seedboxFile;
    this.legacyFilePath = config.legacyTaskFile;
    this.state = { items: [] };
    this.ensureParentDirectory();
    this.load();
  }

  ensureParentDirectory() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  load() {
    const parsed = this.readStateFile(this.filePath) || this.readStateFile(this.legacyFilePath);
    const items = Array.isArray(parsed?.items)
      ? parsed.items
      : Array.isArray(parsed?.tasks)
        ? parsed.tasks
        : [];
    this.state = {
      items: items.map(normalizeSeedboxItem).filter(Boolean).sort(compareSeedboxItems),
    };
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
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

  create(input = {}) {
    this.load();
    const now = new Date().toISOString();
    const item = normalizeSeedboxItem({
      id: crypto.randomUUID(),
      kind: input.kind,
      title: input.title,
      goal: input.goal || input.notes || input.title,
      status: input.status || "pending",
      priority: input.priority || "normal",
      dueAt: input.dueAt,
      dueAtMs: normalizeDueAtMs(input.dueAtMs || input.dueAt),
      nextAction: input.nextAction,
      deliverable: input.deliverable || "silent",
      tags: input.tags,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    });
    if (!item) {
      throw new Error("Invalid seedbox item. Provide at least a title.");
    }
    this.state.items.push(item);
    this.state.items.sort(compareSeedboxItems);
    this.save();
    return item;
  }

  list({ status = "", kind = "", limit = 20, includeDone = false } = {}) {
    this.load();
    const normalizedStatus = normalizeText(status);
    const normalizedKind = normalizeText(kind);
    const normalizedLimit = normalizeLimit(limit);
    const items = this.state.items
      .filter((item) => includeDone || !["done", "cancelled"].includes(item.status))
      .filter((item) => !normalizedStatus || item.status === normalizedStatus)
      .filter((item) => !normalizedKind || item.kind === normalizedKind)
      .slice(0, normalizedLimit);
    return {
      filePath: this.filePath,
      count: items.length,
      items,
    };
  }

  update({ id = "", ...patch } = {}) {
    this.load();
    const itemId = normalizeText(id);
    if (!itemId) {
      throw new Error("Seedbox update requires id.");
    }
    const index = this.state.items.findIndex((item) => item.id === itemId);
    if (index < 0) {
      throw new Error(`Seedbox item not found: ${itemId}`);
    }
    const current = this.state.items[index];
    const next = normalizeSeedboxItem({
      ...current,
      ...filterDefinedPatch(patch),
      dueAtMs: Object.prototype.hasOwnProperty.call(patch, "dueAt")
        ? normalizeDueAtMs(patch.dueAt)
        : Object.prototype.hasOwnProperty.call(patch, "dueAtMs")
          ? normalizeDueAtMs(patch.dueAtMs)
          : current.dueAtMs,
      updatedAt: new Date().toISOString(),
    });
    if (!next) {
      throw new Error("Seedbox update produced an invalid item.");
    }
    this.state.items[index] = next;
    this.state.items.sort(compareSeedboxItems);
    this.save();
    return next;
  }

  complete({ id = "", notes = "" } = {}) {
    return this.update({
      id,
      status: "done",
      notes: normalizeText(notes) || undefined,
    });
  }
}

function normalizeSeedboxItem(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const id = normalizeText(value.id);
  const kind = normalizeChoice(value.kind, SEEDBOX_KINDS, "seed");
  const title = normalizeText(value.title);
  const goal = normalizeText(value.goal);
  const status = normalizeChoice(value.status, SEEDBOX_STATUSES, "pending");
  const priority = normalizeChoice(value.priority, SEEDBOX_PRIORITIES, "normal");
  const nextAction = normalizeText(value.nextAction);
  const deliverable = normalizeChoice(value.deliverable, DELIVERABLES, "silent");
  const createdAt = normalizeIsoTime(value.createdAt) || new Date().toISOString();
  const updatedAt = normalizeIsoTime(value.updatedAt) || createdAt;
  const dueAtMs = normalizeDueAtMs(value.dueAtMs || value.dueAt);
  const tags = normalizeStringList(value.tags);
  const notes = normalizeText(value.notes);

  if (!id || !title) {
    return null;
  }
  return {
    id,
    kind,
    title,
    goal,
    status,
    priority,
    dueAtMs,
    nextAction,
    deliverable,
    tags,
    notes,
    createdAt,
    updatedAt,
  };
}

function filterDefinedPatch(patch) {
  const result = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function compareSeedboxItems(left, right) {
  const leftStatus = statusRank(left.status);
  const rightStatus = statusRank(right.status);
  if (leftStatus !== rightStatus) {
    return leftStatus - rightStatus;
  }
  const leftPriority = priorityRank(left.priority);
  const rightPriority = priorityRank(right.priority);
  if (leftPriority !== rightPriority) {
    return rightPriority - leftPriority;
  }
  const leftDue = left.dueAtMs || Number.MAX_SAFE_INTEGER;
  const rightDue = right.dueAtMs || Number.MAX_SAFE_INTEGER;
  if (leftDue !== rightDue) {
    return leftDue - rightDue;
  }
  return String(left.updatedAt || "").localeCompare(String(right.updatedAt || ""));
}

function statusRank(status) {
  return {
    active: 0,
    pending: 1,
    waiting: 2,
    done: 3,
    cancelled: 4,
  }[status] ?? 5;
}

function priorityRank(priority) {
  return {
    low: 0,
    normal: 1,
    high: 2,
  }[priority] ?? 1;
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

function normalizeDueAtMs(value) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeIsoTime(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 20;
  }
  return Math.min(parsed, 100);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { SeedboxService };
