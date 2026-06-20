const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MEMORY_TYPES = new Set(["preference", "fact", "principle", "relationship", "project", "research", "self"]);
const MEMORY_STATUSES = new Set(["active", "archived"]);

class AgentMemoryService {
  constructor({ config }) {
    this.config = config;
    this.filePath = config.agentMemoryFile;
    this.state = { memories: [] };
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

  remember(input = {}) {
    this.load();
    const now = new Date().toISOString();
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
      createdAt: now,
      updatedAt: now,
      lastUsedAt: "",
      lastUsedAtMs: 0,
    });
    if (!memory) {
      throw new Error("Invalid memory. Provide at least type, subject, and content.");
    }
    this.state.memories.push(memory);
    this.state.memories.sort(compareMemories);
    this.save();
    return memory;
  }

  list({ type = "", subject = "", includeArchived = false, limit = 20 } = {}) {
    this.load();
    const normalizedType = normalizeText(type).toLowerCase();
    const normalizedSubject = normalizeText(subject).toLowerCase();
    const memories = this.state.memories
      .filter((memory) => includeArchived || memory.status === "active")
      .filter((memory) => !normalizedType || memory.type === normalizedType)
      .filter((memory) => !normalizedSubject || memory.subject.toLowerCase().includes(normalizedSubject))
      .filter((memory) => !isExpired(memory))
      .slice(0, normalizeLimit(limit));
    return {
      filePath: this.filePath,
      count: memories.length,
      memories,
    };
  }

  search({ query = "", limit = 20, includeArchived = false } = {}) {
    this.load();
    const terms = normalizeText(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) {
      return this.list({ limit, includeArchived });
    }
    const memories = this.state.memories
      .filter((memory) => includeArchived || memory.status === "active")
      .filter((memory) => !isExpired(memory))
      .map((memory) => ({ memory, score: scoreMemory(memory, terms) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || compareMemories(left.memory, right.memory))
      .slice(0, normalizeLimit(limit))
      .map((item) => item.memory);
    return {
      filePath: this.filePath,
      query: normalizeText(query),
      count: memories.length,
      memories,
    };
  }

  update({ id = "", ...patch } = {}) {
    this.load();
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
    return next;
  }

  touch({ id = "" } = {}) {
    const now = new Date().toISOString();
    return this.update({
      id,
      lastUsedAt: now,
      lastUsedAtMs: Date.parse(now),
    });
  }

  forget({ id = "", reason = "" } = {}) {
    const notes = normalizeText(reason);
    return this.update({
      id,
      status: "archived",
      sourceRef: notes ? `forgot: ${notes}` : undefined,
    });
  }
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
  const expiresAtMs = normalizeTimeMs(value.expiresAtMs || value.expiresAt);
  const lastUsedAt = normalizeIsoTime(value.lastUsedAt);
  const lastUsedAtMs = normalizeTimeMs(value.lastUsedAtMs || value.lastUsedAt);
  const tags = normalizeStringList(value.tags);

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
  };
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
  if (left.status !== right.status) {
    return left.status === "active" ? -1 : 1;
  }
  if (left.confidence !== right.confidence) {
    return right.confidence - left.confidence;
  }
  return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
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

module.exports = { AgentMemoryService };
