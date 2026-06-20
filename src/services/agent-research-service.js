const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const RESEARCH_STATUSES = new Set(["active", "exploring", "parked", "synthesized", "archived"]);

class AgentResearchService {
  constructor({ config }) {
    this.config = config;
    this.filePath = config.agentResearchFile;
    this.state = { research: [] };
    this.ensureParentDirectory();
    this.load();
    this.importLegacyResearchMemoriesIfEmpty();
  }

  ensureParentDirectory() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      const research = Array.isArray(parsed?.research) ? parsed.research : [];
      this.state = {
        research: research.map(normalizeResearch).filter(Boolean).sort(compareResearch),
      };
    } catch {
      this.state = { research: [] };
    }
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  importLegacyResearchMemoriesIfEmpty() {
    if (this.state.research.length || !this.config.agentMemoryFile) {
      return;
    }
    let imported = [];
    try {
      const raw = fs.readFileSync(this.config.agentMemoryFile, "utf8");
      const parsed = JSON.parse(raw);
      const memories = Array.isArray(parsed?.memories) ? parsed.memories : [];
      imported = memories
        .filter((memory) => normalizeText(memory?.type).toLowerCase() === "research")
        .map((memory) => normalizeResearch({
          id: normalizeText(memory.id) || crypto.randomUUID(),
          topic: memory.subject,
          title: memory.subject,
          status: normalizeText(memory.status).toLowerCase() === "archived" ? "archived" : "active",
          synthesis: memory.content,
          confidence: memory.confidence,
          source: memory.source,
          sourceRef: memory.sourceRef,
          tags: memory.tags,
          createdAt: memory.createdAt,
          updatedAt: memory.updatedAt,
        }))
        .filter(Boolean);
    } catch {
      imported = [];
    }
    if (imported.length) {
      this.state.research = imported.sort(compareResearch);
      this.save();
    }
  }

  upsert(input = {}) {
    this.load();
    const researchId = normalizeText(input.id);
    const topic = normalizeText(input.topic);
    const index = researchId
      ? this.state.research.findIndex((item) => item.id === researchId)
      : topic
        ? this.state.research.findIndex((item) => item.topic.toLowerCase() === topic.toLowerCase() && item.status !== "archived")
        : -1;
    const now = new Date().toISOString();
    const current = index >= 0 ? this.state.research[index] : null;
    const next = normalizeResearch({
      id: current?.id || crypto.randomUUID(),
      topic: input.topic ?? current?.topic,
      title: input.title ?? current?.title,
      status: input.status ?? current?.status ?? "active",
      hypothesis: input.hypothesis ?? current?.hypothesis,
      synthesis: input.synthesis ?? current?.synthesis,
      notes: mergeTextList(current?.notes, input.notes),
      evidence: mergeTextList(current?.evidence, input.evidence),
      openQuestions: mergeTextList(current?.openQuestions, input.openQuestions),
      nextAction: input.nextAction ?? current?.nextAction,
      confidence: input.confidence ?? current?.confidence,
      source: input.source ?? current?.source,
      sourceRef: input.sourceRef ?? current?.sourceRef,
      taskId: input.taskId ?? current?.taskId,
      tags: mergeTextList(current?.tags, input.tags, 20),
      createdAt: current?.createdAt || now,
      updatedAt: now,
    });
    if (!next) {
      throw new Error("Invalid research item. Provide at least topic plus one useful research field.");
    }
    if (index >= 0) {
      this.state.research[index] = next;
    } else {
      this.state.research.push(next);
    }
    this.state.research.sort(compareResearch);
    this.save();
    return next;
  }

  list({ status = "", topic = "", limit = 20, includeArchived = false } = {}) {
    this.load();
    const normalizedStatus = normalizeText(status).toLowerCase();
    const normalizedTopic = normalizeText(topic).toLowerCase();
    const research = this.state.research
      .filter((item) => includeArchived || item.status !== "archived")
      .filter((item) => !normalizedStatus || item.status === normalizedStatus)
      .filter((item) => !normalizedTopic || item.topic.toLowerCase().includes(normalizedTopic))
      .slice(0, normalizeLimit(limit));
    return {
      filePath: this.filePath,
      count: research.length,
      research,
    };
  }

  search({ query = "", limit = 20, includeArchived = false } = {}) {
    this.load();
    const terms = normalizeText(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) {
      return this.list({ limit, includeArchived });
    }
    const research = this.state.research
      .filter((item) => includeArchived || item.status !== "archived")
      .map((item) => ({ item, score: scoreResearch(item, terms) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || compareResearch(left.item, right.item))
      .slice(0, normalizeLimit(limit))
      .map((entry) => entry.item);
    return {
      filePath: this.filePath,
      query: normalizeText(query),
      count: research.length,
      research,
    };
  }

  archive({ id = "", reason = "" } = {}) {
    const notes = normalizeText(reason);
    return this.upsert({
      id,
      status: "archived",
      notes: notes ? [`Archived: ${notes}`] : undefined,
    });
  }
}

function normalizeResearch(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const id = normalizeText(value.id);
  const topic = normalizeText(value.topic);
  const title = normalizeText(value.title) || topic;
  const status = normalizeChoice(value.status, RESEARCH_STATUSES, "active");
  const hypothesis = normalizeText(value.hypothesis);
  const synthesis = normalizeText(value.synthesis);
  const notes = normalizeStringList(value.notes, 200);
  const evidence = normalizeStringList(value.evidence, 200);
  const openQuestions = normalizeStringList(value.openQuestions, 100);
  const nextAction = normalizeText(value.nextAction);
  const confidence = normalizeConfidence(value.confidence);
  const source = normalizeText(value.source);
  const sourceRef = normalizeText(value.sourceRef);
  const taskId = normalizeText(value.taskId);
  const tags = normalizeStringList(value.tags, 20);
  const createdAt = normalizeIsoTime(value.createdAt) || new Date().toISOString();
  const updatedAt = normalizeIsoTime(value.updatedAt) || createdAt;

  if (!id || !topic || !hasResearchBody({ hypothesis, synthesis, notes, evidence, openQuestions, nextAction })) {
    return null;
  }
  return {
    id,
    topic,
    title,
    status,
    hypothesis,
    synthesis,
    notes,
    evidence,
    openQuestions,
    nextAction,
    confidence,
    source,
    sourceRef,
    taskId,
    tags,
    createdAt,
    updatedAt,
  };
}

function hasResearchBody(item) {
  return Boolean(
    item.hypothesis
    || item.synthesis
    || item.nextAction
    || item.notes?.length
    || item.evidence?.length
    || item.openQuestions?.length
  );
}

function mergeTextList(current, incoming, limit = 200) {
  const existing = normalizeStringList(current, limit);
  const next = normalizeStringList(incoming, limit);
  return [...existing, ...next].slice(-limit);
}

function scoreResearch(item, terms) {
  const haystack = [
    item.topic,
    item.title,
    item.hypothesis,
    item.synthesis,
    item.nextAction,
    item.source,
    item.sourceRef,
    item.taskId,
    ...(item.notes || []),
    ...(item.evidence || []),
    ...(item.openQuestions || []),
    ...(item.tags || []),
  ].join(" ").toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!haystack.includes(term)) {
      return 0;
    }
    if (item.topic.toLowerCase().includes(term) || item.title.toLowerCase().includes(term)) {
      score += 4;
    }
    if ((item.synthesis || "").toLowerCase().includes(term) || (item.hypothesis || "").toLowerCase().includes(term)) {
      score += 3;
    }
    if ((item.tags || []).some((tag) => tag.toLowerCase().includes(term))) {
      score += 1;
    }
  }
  return score + item.confidence;
}

function compareResearch(left, right) {
  if (left.status !== right.status) {
    return statusRank(left.status) - statusRank(right.status);
  }
  return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
}

function statusRank(status) {
  return {
    active: 0,
    exploring: 1,
    parked: 2,
    synthesized: 3,
    archived: 4,
  }[status] ?? 5;
}

function normalizeChoice(value, allowed, fallback) {
  const normalized = normalizeText(value).toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeStringList(value, limit = 100) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(normalizeText).filter(Boolean).slice(0, limit);
}

function normalizeConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, parsed));
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

module.exports = { AgentResearchService };
