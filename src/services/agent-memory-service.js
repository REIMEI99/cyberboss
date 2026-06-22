const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { rankByEmbedding } = require("./embedding-service");

const MEMORY_TYPES = new Set([
  "preference", "fact", "principle", "relationship", "project", "self",
  "wishseed", "concern",
]);
const COMPLETABLE_TYPES = new Set(["wishseed", "concern", "project"]);
const MEMORY_STATUSES = new Set(["active", "archived"]);

class AgentMemoryService {
  constructor({ config, embeddingService = null }) {
    this.config = config;
    this.embeddingService = embeddingService;
    this.filePath = config.agentMemoryFile;
    this.state = { memories: [] };
    this.ensureParentDirectory();
    this.loadSync();
    this.migrateSeedbox();
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

  migrateSeedbox() {
    const seedboxFile = this.config?.seedboxFile;
    if (!seedboxFile) {
      return;
    }
    const raw = this.readStateFile(seedboxFile);
    if (!raw) {
      return;
    }
    const items = Array.isArray(raw?.items)
      ? raw.items
      : Array.isArray(raw?.tasks)
        ? raw.tasks
        : [];
    if (!items.length) {
      return;
    }
    const existingIds = new Set(this.state.memories.map((memory) => memory.id));
    const migrated = items
      .map((item) => migrateSeedboxItem(item, existingIds))
      .filter(Boolean);
    if (!migrated.length) {
      return;
    }
    this.state.memories.push(...migrated);
    this.state.memories.sort(compareMemories);
    this.save();
    console.log(`[cyberboss] migrated ${migrated.length} seedbox items into memory`);
    try {
      const backupPath = seedboxFile + ".migrated";
      fs.writeFileSync(backupPath, JSON.stringify(raw, null, 2));
      fs.unlinkSync(seedboxFile);
    } catch (error) {
      console.warn(`[cyberboss] seedbox migration cleanup failed: ${error?.message || error}`);
    }
  }

  ensureParentDirectory() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  loadSync() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      const memories = Array.isArray(parsed?.memories) ? parsed.memories : [];
      this.state = {
        memories: memories.map(normalizeMemory).filter(Boolean).sort(compareMemories),
      };
    } catch {
      this.state = { memories: [] };
    }
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  async remember(input = {}) {
    this.loadSync();
    const now = new Date().toISOString();
    const completedAt = COMPLETABLE_TYPES.has(normalizeText(input.type).toLowerCase())
      ? ""
      : normalizeIsoTime(input.completedAt);
    const memory = normalizeMemory({
      id: crypto.randomUUID(),
      type: input.type,
      subject: input.subject,
      content: input.content,
      status: "active",
      confidence: input.confidence,
      source: input.source,
      sourceRef: input.sourceRef,
      expiresAt: input.expiresAt,
      expiresAtMs: normalizeTimeMs(input.expiresAtMs || input.expiresAt),
      tags: input.tags,
      completedAt,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: "",
      lastUsedAtMs: 0,
    });
    if (!memory) {
      throw new Error("Invalid memory. Provide at least type, subject, and content.");
    }
    await applyEmbedding(this, memory);
    this.state.memories.push(memory);
    this.state.memories.sort(compareMemories);
    this.save();
    return stripEmbedding(memory);
  }

  async complete({ id = "", notes = "" } = {}) {
    this.loadSync();
    const memoryId = normalizeText(id);
    if (!memoryId) {
      throw new Error("Memory complete requires id.");
    }
    const index = this.state.memories.findIndex((memory) => memory.id === memoryId);
    if (index < 0) {
      throw new Error(`Memory not found: ${memoryId}`);
    }
    const current = this.state.memories[index];
    const completedAt = new Date().toISOString();
    const next = normalizeMemory({
      ...current,
      content: normalizeText(notes) || current.content,
      completedAt,
      updatedAt: completedAt,
    });
    this.state.memories[index] = next;
    this.state.memories.sort(compareMemories);
    this.save();
    return stripEmbedding(next);
  }

  list({ type = "", subject = "", includeArchived = false, limit = 20 } = {}) {
    this.loadSync();
    const normalizedType = normalizeText(type).toLowerCase();
    const normalizedSubject = normalizeText(subject).toLowerCase();
    const includeCompleted = includeArchived === true;
    const memories = this.state.memories
      .filter((memory) => includeCompleted || !memory.completedAt)
      .filter((memory) => includeArchived || memory.status === "active")
      .filter((memory) => !normalizedType || memory.type === normalizedType)
      .filter((memory) => !normalizedSubject || memory.subject.toLowerCase().includes(normalizedSubject))
      .filter((memory) => !isExpired(memory))
      .slice(0, normalizeLimit(limit));
    return {
      filePath: this.filePath,
      count: memories.length,
      memories: stripEmbeddingFromMemories(memories),
    };
  }

  async search({ query = "", limit = 20, includeArchived = false } = {}) {
    this.loadSync();
    const includeCompleted = includeArchived === true;
    const candidates = this.state.memories
      .filter((memory) => includeCompleted || !memory.completedAt)
      .filter((memory) => includeArchived || memory.status === "active")
      .filter((memory) => !isExpired(memory));
    if (this.embeddingService?.isConfigured()) {
      const [queryEmbedding] = await this.embeddingService.embed([normalizeText(query)]);
      if (Array.isArray(queryEmbedding) && queryEmbedding.length) {
        const matched = rankByEmbedding(candidates, queryEmbedding, { limit });
        if (matched.length) {
          return { filePath: this.filePath, query: normalizeText(query), count: matched.length, memories: stripEmbeddingFromMemories(matched) };
        }
      }
    }
    const terms = normalizeText(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) {
      const fallback = this.list({ limit, includeArchived });
      return { ...fallback, query: "" };
    }
    const memories = candidates
      .map((memory) => ({ memory, score: scoreMemory(memory, terms) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || compareMemories(left.memory, right.memory))
      .slice(0, normalizeLimit(limit))
      .map((item) => item.memory);
    return {
      filePath: this.filePath,
      query: normalizeText(query),
      count: memories.length,
      memories: stripEmbeddingFromMemories(memories),
    };
  }

  async update({ id = "", ...patch } = {}) {
    this.loadSync();
    const memoryId = normalizeText(id);
    if (!memoryId) {
      throw new Error("Memory update requires id.");
    }
    const index = this.state.memories.findIndex((memory) => memory.id === memoryId);
    if (index < 0) {
      throw new Error(`Memory not found: ${memoryId}`);
    }
    const current = this.state.memories[index];
    const next = normalizeMemory({
      ...current,
      ...filterDefinedPatch(patch),
      expiresAtMs: Object.prototype.hasOwnProperty.call(patch, "expiresAt")
        ? normalizeTimeMs(patch.expiresAt)
        : Object.prototype.hasOwnProperty.call(patch, "expiresAtMs")
          ? normalizeTimeMs(patch.expiresAtMs)
          : current.expiresAtMs,
      updatedAt: new Date().toISOString(),
    });
    if (!next) {
      throw new Error("Memory update produced an invalid memory.");
    }
    if (this.embeddingService?.isConfigured() && contentChanged(current, next)) {
      await applyEmbedding(this, next);
    } else {
      next.embedding = Array.isArray(current.embedding) ? current.embedding : [];
    }
    this.state.memories[index] = next;
    this.state.memories.sort(compareMemories);
    this.save();
    return stripEmbedding(next);
  }

  touch({ id = "" } = {}) {
    const now = new Date().toISOString();
    return this.updateSync({
      id,
      lastUsedAt: now,
      lastUsedAtMs: Date.parse(now),
    });
  }

  forget({ id = "", reason = "" } = {}) {
    const notes = normalizeText(reason);
    return this.updateSync({
      id,
      status: "archived",
      sourceRef: notes ? `forgot: ${notes}` : undefined,
    });
  }

  delete({ id = "" } = {}) {
    this.loadSync();
    const memoryId = normalizeText(id);
    if (!memoryId) {
      throw new Error("Memory delete requires id.");
    }
    const index = this.state.memories.findIndex((memory) => memory.id === memoryId);
    if (index < 0) {
      throw new Error(`Memory not found: ${memoryId}`);
    }
    const [removed] = this.state.memories.splice(index, 1);
    this.save();
    return { id: removed.id, deleted: true, subject: removed.subject || "" };
  }

  updateSync({ id = "", ...patch } = {}) {
    this.loadSync();
    const memoryId = normalizeText(id);
    if (!memoryId) {
      throw new Error("Memory update requires id.");
    }
    const index = this.state.memories.findIndex((memory) => memory.id === memoryId);
    if (index < 0) {
      throw new Error(`Memory not found: ${memoryId}`);
    }
    const current = this.state.memories[index];
    const next = normalizeMemory({
      ...current,
      ...filterDefinedPatch(patch),
      expiresAtMs: Object.prototype.hasOwnProperty.call(patch, "expiresAt")
        ? normalizeTimeMs(patch.expiresAt)
        : Object.prototype.hasOwnProperty.call(patch, "expiresAtMs")
          ? normalizeTimeMs(patch.expiresAtMs)
          : current.expiresAtMs,
      updatedAt: new Date().toISOString(),
    });
    if (!next) {
      throw new Error("Memory update produced an invalid memory.");
    }
    this.state.memories[index] = next;
    this.state.memories.sort(compareMemories);
    this.save();
    return stripEmbedding(next);
  }

  async reindex() {
    this.loadSync();
    if (!this.embeddingService?.isConfigured()) {
      return { reindexed: 0, skipped: true, reason: "embedding service is not configured" };
    }
    const targets = this.state.memories.filter((memory) => !Array.isArray(memory.embedding) || !memory.embedding.length);
    if (!targets.length) {
      return { reindexed: 0, skipped: false, reason: "no memories without embedding" };
    }
    const texts = targets.map(buildMemoryEmbeddingText);
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
        const index = this.state.memories.findIndex((memory) => memory.id === targets[i].id);
        if (index >= 0) {
          this.state.memories[index].embedding = embeddings[i];
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

async function applyEmbedding(service, memory) {
  if (!service.embeddingService?.isConfigured()) {
    memory.embedding = [];
    return;
  }
  const [embedding] = await service.embeddingService.embed([buildMemoryEmbeddingText(memory)]);
  memory.embedding = Array.isArray(embedding) && embedding.length ? embedding : [];
}

function normalizeMemory(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const id = normalizeText(value.id);
  const type = normalizeChoice(value.type, MEMORY_TYPES, "fact");
  const subject = normalizeText(value.subject);
  const content = normalizeText(value.content);
  const status = normalizeChoice(value.status, MEMORY_STATUSES, "active");
  const confidence = normalizeConfidence(value.confidence);
  const source = normalizeText(value.source);
  const sourceRef = normalizeText(value.sourceRef);
  const createdAt = normalizeIsoTime(value.createdAt) || new Date().toISOString();
  const updatedAt = normalizeIsoTime(value.updatedAt) || createdAt;
  const completedAt = resolveCompletedAt(value, updatedAt || createdAt);
  const expiresAtMs = normalizeTimeMs(value.expiresAtMs || value.expiresAt);
  const lastUsedAt = normalizeIsoTime(value.lastUsedAt);
  const lastUsedAtMs = normalizeTimeMs(value.lastUsedAtMs || value.lastUsedAt);
  const tags = normalizeStringList(value.tags);
  const embedding = Array.isArray(value.embedding) ? value.embedding : [];

  if (!id || !subject || !content) {
    return null;
  }
  return {
    id,
    type,
    subject,
    content,
    status,
    confidence,
    source,
    sourceRef,
    expiresAtMs,
    tags,
    createdAt,
    updatedAt,
    lastUsedAt,
    lastUsedAtMs,
    completedAt,
    embedding,
  };
}

function buildMemoryEmbeddingText(memory) {
  return [memory?.type, memory?.subject, memory?.content, ...(memory?.tags || [])]
    .map(normalizeText)
    .filter(Boolean)
    .join(" ");
}

function contentChanged(left, right) {
  return normalizeText(left?.subject) !== normalizeText(right?.subject)
    || normalizeText(left?.content) !== normalizeText(right?.content)
    || JSON.stringify(normalizeStringList(left?.tags)) !== JSON.stringify(normalizeStringList(right?.tags));
}

function scoreMemory(memory, terms) {
  const haystack = [
    memory.type,
    memory.subject,
    memory.content,
    memory.source,
    memory.sourceRef,
    ...(memory.tags || []),
  ].join(" ").toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!haystack.includes(term)) {
      return 0;
    }
    if (memory.subject.toLowerCase().includes(term)) {
      score += 3;
    }
    if (memory.content.toLowerCase().includes(term)) {
      score += 2;
    }
    if ((memory.tags || []).some((tag) => tag.toLowerCase().includes(term))) {
      score += 1;
    }
  }
  return score + memory.confidence;
}

function compareMemories(left, right) {
  const leftCompleted = Boolean(left.completedAt);
  const rightCompleted = Boolean(right.completedAt);
  if (leftCompleted !== rightCompleted) {
    return leftCompleted ? 1 : -1;
  }
  if (left.status !== right.status) {
    return left.status === "active" ? -1 : 1;
  }
  if (left.confidence !== right.confidence) {
    return right.confidence - left.confidence;
  }
  return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
}

function resolveCompletedAt(value, fallbackTime) {
  const completedAt = normalizeIsoTime(value.completedAt);
  if (completedAt) {
    return completedAt;
  }
  return "";
}

function migrateSeedboxItem(item, existingIds) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const id = normalizeText(item.id);
  if (!id || existingIds.has(id)) {
    return null;
  }
  const kind = normalizeChoice(item.kind, new Set(["wishseed", "concern"]), "wishseed");
  const title = normalizeText(item.title);
  if (!title) {
    return null;
  }
  existingIds.add(id);
  const createdAt = normalizeIsoTime(item.createdAt) || new Date().toISOString();
  const updatedAt = normalizeIsoTime(item.updatedAt) || createdAt;
  const completedAt = normalizeIsoTime(item.completedAt) || resolveLegacySeedboxCompletedAt(item, updatedAt);
  const tags = normalizeStringList(item.tags);
  const notes = normalizeText(item.notes);
  return normalizeMemory({
    id,
    type: kind,
    subject: title,
    content: notes || title,
    status: "active",
    confidence: 0.5,
    source: "seedbox_migration",
    tags,
    createdAt,
    updatedAt,
    completedAt,
  });
}

function resolveLegacySeedboxCompletedAt(item, fallbackTime) {
  const legacyStatus = normalizeText(item.status).toLowerCase();
  if (legacyStatus === "done" || legacyStatus === "cancelled") {
    return normalizeIsoTime(item.updatedAt) || fallbackTime || new Date().toISOString();
  }
  return "";
}

function isExpired(memory) {
  return Number.isFinite(memory.expiresAtMs) && memory.expiresAtMs > 0 && memory.expiresAtMs < Date.now();
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

function normalizeConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, parsed));
}

function normalizeTimeMs(value) {
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

function stripEmbedding(memory) {
  if (!memory || typeof memory !== "object") {
    return memory;
  }
  const { embedding, ...rest } = memory;
  return rest;
}

function stripEmbeddingFromMemories(memories) {
  return Array.isArray(memories) ? memories.map(stripEmbedding) : memories;
}
module.exports = { AgentMemoryService, COMPLETABLE_TYPES, MEMORY_TYPES };
