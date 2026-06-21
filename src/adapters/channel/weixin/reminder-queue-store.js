const fs = require("fs");
const path = require("path");

class ReminderQueueStore {
  constructor({ filePath }) {
    this.filePath = filePath;
    this.state = { reminders: [] };
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
      const reminders = Array.isArray(parsed?.reminders) ? parsed.reminders : [];
      this.state = {
        reminders: reminders
          .map(normalizeReminder)
          .filter(Boolean)
          .sort((left, right) => left.dueAtMs - right.dueAtMs),
      };
    } catch {
      this.state = { reminders: [] };
    }
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  enqueue(reminder) {
    this.load();
    const normalized = normalizeReminder(reminder);
    if (!normalized) {
      throw new Error("invalid reminder");
    }
    this.state.reminders.push(normalized);
    this.state.reminders.sort((left, right) => left.dueAtMs - right.dueAtMs);
    this.save();
    return normalized;
  }

  listDue(nowMs = Date.now()) {
    this.load();
    return this.state.reminders
      .filter((reminder) => reminder.dueAtMs <= nowMs)
      .map((reminder) => ({ ...reminder }));
  }

  peekNextDueAtMs() {
    this.load();
    const first = this.state.reminders[0];
    return Number.isFinite(first?.dueAtMs) ? first.dueAtMs : 0;
  }

  listAll() {
    this.load();
    return this.state.reminders.map((reminder) => ({ ...reminder }));
  }

  defer({ id = "", dueAtMs = 0 } = {}) {
    this.load();
    const normalizedId = typeof id === "string" ? id.trim() : "";
    const normalizedDueAtMs = Number(dueAtMs);
    if (!normalizedId || !Number.isFinite(normalizedDueAtMs) || normalizedDueAtMs <= 0) {
      throw new Error("invalid reminder defer");
    }
    const index = this.state.reminders.findIndex((reminder) => reminder.id === normalizedId);
    if (index < 0) {
      throw new Error(`reminder not found: ${normalizedId}`);
    }
    this.state.reminders[index] = normalizeReminder({
      ...this.state.reminders[index],
      dueAtMs: normalizedDueAtMs,
      lastTriggeredAt: new Date().toISOString(),
      triggerCount: Number(this.state.reminders[index].triggerCount || 0) + 1,
    });
    this.state.reminders.sort((left, right) => left.dueAtMs - right.dueAtMs);
    this.save();
    return { ...this.state.reminders[index] };
  }

  complete({ id = "" } = {}) {
    this.load();
    const normalizedId = typeof id === "string" ? id.trim() : "";
    if (!normalizedId) {
      throw new Error("reminder complete requires id");
    }
    const index = this.state.reminders.findIndex((reminder) => reminder.id === normalizedId);
    if (index < 0) {
      throw new Error(`reminder not found: ${normalizedId}`);
    }
    const [removed] = this.state.reminders.splice(index, 1);
    this.save();
    return removed;
  }
}

function normalizeReminder(reminder) {
  if (!reminder || typeof reminder !== "object") {
    return null;
  }
  const id = typeof reminder.id === "string" ? reminder.id.trim() : "";
  const accountId = typeof reminder.accountId === "string" ? reminder.accountId.trim() : "";
  const senderId = typeof reminder.senderId === "string" ? reminder.senderId.trim() : "";
  const contextToken = typeof reminder.contextToken === "string" ? reminder.contextToken.trim() : "";
  const text = typeof reminder.text === "string" ? reminder.text.trim() : "";
  const dueAtMs = Number(reminder.dueAtMs);
  const createdAt = typeof reminder.createdAt === "string" ? reminder.createdAt.trim() : "";
  const followupDelayMinutes = Number.parseInt(String(reminder.followupDelayMinutes || ""), 10);
  const lastTriggeredAt = typeof reminder.lastTriggeredAt === "string" ? reminder.lastTriggeredAt.trim() : "";
  const triggerCount = Number.parseInt(String(reminder.triggerCount || ""), 10);
  if (!id || !accountId || !senderId || !contextToken || !text || !Number.isFinite(dueAtMs) || dueAtMs <= 0) {
    return null;
  }
  return {
    id,
    accountId,
    senderId,
    contextToken,
    text,
    dueAtMs,
    createdAt: createdAt || new Date().toISOString(),
    followupDelayMinutes: Number.isFinite(followupDelayMinutes) && followupDelayMinutes > 0 ? followupDelayMinutes : 15,
    lastTriggeredAt: lastTriggeredAt || "",
    triggerCount: Number.isFinite(triggerCount) && triggerCount > 0 ? triggerCount : 0,
  };
}

module.exports = { ReminderQueueStore };
