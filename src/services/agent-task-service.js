const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TASK_KINDS = new Set(["explore", "research", "remember", "followup", "maintenance"]);
const TASK_STATUSES = new Set(["pending", "active", "waiting", "done", "cancelled"]);
const TASK_PRIORITIES = new Set(["low", "normal", "high"]);
const DELIVERABLES = new Set(["silent", "message", "diary", "timeline", "briefing", "file"]);

class AgentTaskService {
  constructor({ config }) {
    this.config = config;
    this.filePath = config.agentTaskFile;
    this.state = { tasks: [] };
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
      const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
      this.state = {
        tasks: tasks.map(normalizeTask).filter(Boolean).sort(compareTasks),
      };
    } catch {
      this.state = { tasks: [] };
    }
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  create(input = {}) {
    this.load();
    const now = new Date().toISOString();
    const task = normalizeTask({
      id: crypto.randomUUID(),
      kind: input.kind,
      title: input.title,
      goal: input.goal,
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
    if (!task) {
      throw new Error("Invalid agent task. Provide at least kind, title, and goal.");
    }
    this.state.tasks.push(task);
    this.state.tasks.sort(compareTasks);
    this.save();
    return task;
  }

  list({ status = "", kind = "", limit = 20, includeDone = false } = {}) {
    this.load();
    const normalizedStatus = normalizeText(status);
    const normalizedKind = normalizeText(kind);
    const normalizedLimit = normalizeLimit(limit);
    const tasks = this.state.tasks
      .filter((task) => includeDone || !["done", "cancelled"].includes(task.status))
      .filter((task) => !normalizedStatus || task.status === normalizedStatus)
      .filter((task) => !normalizedKind || task.kind === normalizedKind)
      .slice(0, normalizedLimit);
    return {
      filePath: this.filePath,
      count: tasks.length,
      tasks,
    };
  }

  update({ id = "", ...patch } = {}) {
    this.load();
    const taskId = normalizeText(id);
    if (!taskId) {
      throw new Error("Agent task update requires id.");
    }
    const index = this.state.tasks.findIndex((task) => task.id === taskId);
    if (index < 0) {
      throw new Error(`Agent task not found: ${taskId}`);
    }
    const current = this.state.tasks[index];
    const next = normalizeTask({
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
      throw new Error("Agent task update produced an invalid task.");
    }
    this.state.tasks[index] = next;
    this.state.tasks.sort(compareTasks);
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

function normalizeTask(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const id = normalizeText(value.id);
  const kind = normalizeChoice(value.kind, TASK_KINDS, "followup");
  const title = normalizeText(value.title);
  const goal = normalizeText(value.goal);
  const status = normalizeChoice(value.status, TASK_STATUSES, "pending");
  const priority = normalizeChoice(value.priority, TASK_PRIORITIES, "normal");
  const nextAction = normalizeText(value.nextAction);
  const deliverable = normalizeChoice(value.deliverable, DELIVERABLES, "silent");
  const createdAt = normalizeIsoTime(value.createdAt) || new Date().toISOString();
  const updatedAt = normalizeIsoTime(value.updatedAt) || createdAt;
  const dueAtMs = normalizeDueAtMs(value.dueAtMs || value.dueAt);
  const tags = normalizeStringList(value.tags);
  const notes = normalizeText(value.notes);

  if (!id || !title || !goal) {
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

function compareTasks(left, right) {
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

module.exports = { AgentTaskService };
