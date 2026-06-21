const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { rankByEmbedding } = require("./embedding-service");

const SEEDBOX_KINDS = new Set(["wishseed", "concern"]);

class SeedboxService {
  constructor({ config, embeddingService = null }) {
    this.config = config;
    this.embeddingService = embeddingService;
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

  async create(input = {}) {
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
    await applyEmbedding(this, item);
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

  async search({ query = "", limit = 20, includeCompleted = false } = {}) {
    this.load();
    const candidates = this.state.items
      .filter((item) => includeCompleted || !item.completedAt);
    if (this.embeddingService?.isConfigured()) {
      const [queryEmbedding] = await this.embeddingService.embed([normalizeText(query)]);
      if (Array.isArray(queryEmbedding) && queryEmbedding.length) {
        const matched = rankByEmbedding(candidates, queryEmbedding, { limit });
        if (matched.length) {
          return { filePath: this.filePath, query: normalizeText(query), count: matched.length, items: matched };
        }
      }
    }
    const terms = normalizeText(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) {
      const fallback = this.list({ limit, includeCompleted });
      return { ...fallback, query: "" };
    }
    const items = candidates
      .map((item) => ({ item, score: scoreSeedboxItem(item, terms) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || compareSeedboxItems(left.item, right.item))
      .slice(0, normalizeLimit(limit))
      .map((entry) => entry.item);
    return {
      filePath: this.filePath,
      query: normalizeText(query),
      count: items.length,
      items,
    };
  }

  async update({ id = "", ...patch } = {}) {
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
    if (this.embeddingService?.isConfigured() && seedboxContentChanged(current, next)) {
      await applyEmbedding(this, next);
    } else {
      next.embedding = Array.isArray(current.embedding) ? current.embedding : [];
    }
    this.state.items[index] = next;
    this.state.items.sort(compareSeedboxItems);
    this.save();
    return next;
  }

  async complete({ id = "", notes = "" } = {}) {
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

  async reindex() {
    this.load();
    if (!this.embeddingService?.isConfigured()) {
      return { reindexed: 0, skipped: true, reason: "embedding service is not configured" };
    }
    const targets = this.state.items.filter((item) => !Array.isArray(item.embedding) || !item.embedding.length);
    if (!targets.length) {
      return { reindexed: 0, skipped: false, reason: "no seedbox items without embedding" };
    }
    const texts = targets.map(buildSeedboxEmbeddingText);
    const embeddings = await this.embeddingService.embed(texts);
    if (!Array.isArray(embeddings) || !embeddings.length) {
      return {
        reindexed: 0,
        skipped: false,
        error: this.embeddingService.lastError || "embedding API returned no results",
        reason: "",
      };
    }
    let reindexed = 0;
    for (let i = 0; i < targets.length && i < embeddings.length; i += 1) {
      if (Array.isArray(embeddings[i]) && embeddings[i].length) {
        const index = this.state.items.findIndex((item) => item.id === targets[i].id);
        if (index >= 0) {
          this.state.items[index].embedding = embeddings[i];
          reindexed += 1;
        }
      }
    }
    if (reindexed > 0) {
      this.save();
    }
    return { reindexed, skipped: false, reason: "" };
  }
}

async function applyEmbedding(service, item) {
  if (!service.embeddingService?.isConfigured()) {
    item.embedding = [];
    return;
  }
  const [embedding] = await service.embeddingService.embed([buildSeedboxEmbeddingText(item)]);
  item.embedding = Array.isArray(embedding) && embedding.length ? embedding : [];
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
  const embedding = Array.isArray(value.embedding) ? value.embedding : [];

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
    embedding,
  };
}

function buildSeedboxEmbeddingText(item) {
  return [item?.kind, item?.title, item?.notes, ...(item?.tags || [])]
    .map(normalizeText)
    .filter(Boolean)
    .join(" ");
}

function seedboxContentChanged(left, right) {
  return normalizeText(left?.title) !== normalizeText(right?.title)
    || normalizeText(left?.notes) !== normalizeText(right?.notes)
    || JSON.stringify(normalizeStringList(left?.tags)) !== JSON.stringify(normalizeStringList(right?.tags));
}

function scoreSeedboxItem(item, terms) {
  const haystack = [item.kind, item.title, item.notes, ...(item.tags || [])].join(" ").toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!haystack.includes(term)) {
      return 0;
    }
    if (item.title.toLowerCase().includes(term)) {
      score += 3;
    }
    if (normalizeText(item.notes).toLowerCase().includes(term)) {
      score += 2;
    }
    if ((item.tags || []).some((tag) => tag.toLowerCase().includes(term))) {
      score += 1;
    }
  }
  return score;
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
