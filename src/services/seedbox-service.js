const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SEEDBOX_KINDS = new Set(["wishseed", "concern"]);

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

  list({ kind = "", limit = 20, includeCompleted = false, includeDone = false } = {}) {
    this.load();
    const normalizedKind = normalizeText(kind);
    const normalizedLimit = normalizeLimit(limit);
    const shouldIncludeCompleted = includeCompleted === true || includeDone === true;
    const items = this.state.items
      .filter((item) => shouldIncludeCompleted || !item.completedAt)
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
    this.load();
    const itemId = normalizeText(id);
    if (!itemId) {
      throw new Error("Seedbox complete requires id.");
    }
    const index = this.state.items.findIndex((item) => item.id === itemId);
    if (index < 0) {
      throw new Error(`Seedbox item not found: ${itemId}`);
    }
    const current = this.state.items[index];
    const completedAt = new Date().toISOString();
    const next = normalizeSeedboxItem({
      ...current,
      notes: normalizeText(notes) || current.notes,
      completedAt,
      updatedAt: completedAt,
    });
    this.state.items[index] = next;
    this.state.items.sort(compareSeedboxItems);
    this.save();
    return next;
  }
}

function normalizeSeedboxItem(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const id = normalizeText(value.id);
  const kind = normalizeChoice(value.kind, SEEDBOX_KINDS, "wishseed");
  const title = normalizeText(value.title);
  const createdAt = normalizeIsoTime(value.createdAt) || new Date().toISOString();
  const updatedAt = normalizeIsoTime(value.updatedAt) || createdAt;
  const completedAt = resolveCompletedAt(value, updatedAt || createdAt);
  const tags = normalizeStringList(value.tags);
  const notes = normalizeText(value.notes);

  if (!id || !title) {
    return null;
  }
  return {
    id,
    kind,
    title,
    tags,
    notes,
    createdAt,
    updatedAt,
    completedAt,
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
  const leftCompleted = Boolean(left.completedAt);
  const rightCompleted = Boolean(right.completedAt);
  if (leftCompleted !== rightCompleted) {
    return leftCompleted ? 1 : -1;
  }
  return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
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

function resolveCompletedAt(value, fallbackTime) {
  const completedAt = normalizeIsoTime(value.completedAt);
  if (completedAt) {
    return completedAt;
  }
  const legacyStatus = normalizeText(value.status).toLowerCase();
  if (legacyStatus === "done" || legacyStatus === "cancelled") {
    return normalizeIsoTime(value.updatedAt) || fallbackTime || new Date().toISOString();
  }
  return "";
}

module.exports = { SeedboxService };
