const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_ITEMS = 20;

class TitlePoolService {
  constructor({ config }) {
    this.filePath = config.titlePoolFile;
    this.state = { items: [] };
    this.ensureParentDirectory();
    this.load();
  }

  ensureParentDirectory() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      this.state = {
        items: items.map(normalizeTitlePoolItem).filter(Boolean).sort(compareTitlePoolItems),
      };
    } catch {
      this.state = { items: [] };
    }
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  add({ title = "" } = {}) {
    this.load();
    const normalizedTitle = normalizeText(title);
    if (!normalizedTitle) {
      throw new Error("Title pool item requires a non-empty title.");
    }
    const existing = this.state.items.find((item) => item.title === normalizedTitle);
    if (existing) {
      return existing;
    }
    const item = normalizeTitlePoolItem({
      id: crypto.randomUUID(),
      title: normalizedTitle,
      createdAt: new Date().toISOString(),
    });
    this.state.items.unshift(item);
    this.state.items = this.state.items.slice(0, MAX_ITEMS);
    this.save();
    return item;
  }

  list({ limit = MAX_ITEMS } = {}) {
    this.load();
    const normalizedLimit = normalizeLimit(limit);
    const items = this.state.items.slice(0, normalizedLimit);
    return {
      filePath: this.filePath,
      count: items.length,
      items,
    };
  }

  remove({ id = "" } = {}) {
    this.load();
    const normalizedId = normalizeText(id);
    if (!normalizedId) {
      throw new Error("Title pool remove requires id.");
    }
    const index = this.state.items.findIndex((item) => item.id === normalizedId);
    if (index < 0) {
      throw new Error(`Title pool item not found: ${normalizedId}`);
    }
    const [removed] = this.state.items.splice(index, 1);
    this.save();
    return removed;
  }

  clear({ ids = [] } = {}) {
    this.load();
    const targetIds = new Set((Array.isArray(ids) ? ids : []).map((value) => normalizeText(value)).filter(Boolean));
    if (!targetIds.size) {
      return {
        filePath: this.filePath,
        removedCount: 0,
        items: [],
      };
    }
    const removed = this.state.items.filter((item) => targetIds.has(item.id));
    this.state.items = this.state.items.filter((item) => !targetIds.has(item.id));
    this.save();
    return {
      filePath: this.filePath,
      removedCount: removed.length,
      items: removed,
    };
  }
}

function normalizeTitlePoolItem(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const id = normalizeText(value.id);
  const title = normalizeText(value.title);
  const createdAt = normalizeIsoTime(value.createdAt) || new Date().toISOString();
  if (!id || !title) {
    return null;
  }
  return { id, title, createdAt };
}

function compareTitlePoolItems(left, right) {
  const leftMs = Date.parse(left.createdAt || "") || 0;
  const rightMs = Date.parse(right.createdAt || "") || 0;
  return rightMs - leftMs;
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return MAX_ITEMS;
  }
  return Math.min(parsed, MAX_ITEMS);
}

function normalizeIsoTime(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return new Date(parsed).toISOString();
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { TitlePoolService };
