const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STONE_STATUSES = new Set(["active", "shared", "archived"]);

class StoneBoxService {
  constructor({ config }) {
    this.config = config;
    this.filePath = config.agentStoneBoxFile;
    this.state = { stones: [] };
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
      const stones = Array.isArray(parsed?.stones) ? parsed.stones : [];
      this.state = {
        stones: stones.map(normalizeStone).filter(Boolean).sort(compareStones),
      };
    } catch {
      this.state = { stones: [] };
    }
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  add(input = {}) {
    this.load();
    const now = new Date().toISOString();
    const stone = normalizeStone({
      id: crypto.randomUUID(),
      title: input.title,
      content: input.content,
      whyInteresting: input.whyInteresting,
      source: input.source,
      sourceRef: input.sourceRef,
      obsidianRef: input.obsidianRef,
      status: input.status || "active",
      tags: input.tags,
      createdAt: now,
      updatedAt: now,
    });
    if (!stone) {
      throw new Error("Invalid stone. Provide at least title and content.");
    }
    this.state.stones.push(stone);
    this.state.stones.sort(compareStones);
    this.save();
    return stone;
  }

  list({ status = "", limit = 20, includeArchived = false } = {}) {
    this.load();
    const normalizedStatus = normalizeText(status).toLowerCase();
    const stones = this.state.stones
      .filter((stone) => includeArchived || stone.status !== "archived")
      .filter((stone) => !normalizedStatus || stone.status === normalizedStatus)
      .slice(0, normalizeLimit(limit));
    return {
      filePath: this.filePath,
      count: stones.length,
      stones,
    };
  }

  search({ query = "", limit = 20, includeArchived = false } = {}) {
    this.load();
    const terms = normalizeText(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) {
      return this.list({ limit, includeArchived });
    }
    const stones = this.state.stones
      .filter((stone) => includeArchived || stone.status !== "archived")
      .map((stone) => ({ stone, score: scoreStone(stone, terms) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || compareStones(left.stone, right.stone))
      .slice(0, normalizeLimit(limit))
      .map((item) => item.stone);
    return {
      filePath: this.filePath,
      query: normalizeText(query),
      count: stones.length,
      stones,
    };
  }

  update({ id = "", ...patch } = {}) {
    this.load();
    const stoneId = normalizeText(id);
    const index = this.state.stones.findIndex((stone) => stone.id === stoneId);
    if (index < 0) {
      throw new Error(`Stone not found: ${stoneId}`);
    }
    const next = normalizeStone({
      ...this.state.stones[index],
      ...filterDefinedPatch(patch),
      updatedAt: new Date().toISOString(),
    });
    if (!next) {
      throw new Error("Stone update produced an invalid stone.");
    }
    this.state.stones[index] = next;
    this.state.stones.sort(compareStones);
    this.save();
    return next;
  }
}

function normalizeStone(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const id = normalizeText(value.id);
  const title = normalizeText(value.title);
  const content = normalizeText(value.content);
  const whyInteresting = normalizeText(value.whyInteresting);
  const source = normalizeText(value.source);
  const sourceRef = normalizeText(value.sourceRef);
  const obsidianRef = normalizeText(value.obsidianRef);
  const status = normalizeChoice(value.status, STONE_STATUSES, "active");
  const tags = normalizeStringList(value.tags);
  const createdAt = normalizeIsoTime(value.createdAt) || new Date().toISOString();
  const updatedAt = normalizeIsoTime(value.updatedAt) || createdAt;
  if (!id || !title || !content) {
    return null;
  }
  return { id, title, content, whyInteresting, source, sourceRef, obsidianRef, status, tags, createdAt, updatedAt };
}

function scoreStone(stone, terms) {
  const haystack = [
    stone.title,
    stone.content,
    stone.whyInteresting,
    stone.source,
    stone.sourceRef,
    stone.obsidianRef,
    ...(stone.tags || []),
  ].join(" ").toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!haystack.includes(term)) {
      return 0;
    }
    if (stone.title.toLowerCase().includes(term)) {
      score += 3;
    }
    if (stone.content.toLowerCase().includes(term)) {
      score += 2;
    }
    if ((stone.tags || []).some((tag) => tag.toLowerCase().includes(term))) {
      score += 1;
    }
  }
  return score;
}

function compareStones(left, right) {
  if (left.status !== right.status) {
    return statusRank(left.status) - statusRank(right.status);
  }
  return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
}

function statusRank(status) {
  return { active: 0, shared: 1, archived: 2 }[status] ?? 3;
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

module.exports = { StoneBoxService };
