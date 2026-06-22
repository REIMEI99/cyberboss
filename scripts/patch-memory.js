const fs = require("fs");
const filePath = "D:/Codex/cyberboss/src/services/agent-memory-service.js";
let content = fs.readFileSync(filePath, "utf8");

content = content.replace(
  'const MEMORY_TYPES = new Set(["preference", "fact", "principle", "relationship", "project", "self"]);',
  'const MEMORY_TYPES = new Set([\n  "preference", "fact", "principle", "relationship", "project", "self",\n  "wishseed", "concern",\n]);\nconst COMPLETABLE_TYPES = new Set(["wishseed", "concern", "project"]);'
);

content = content.replace(
  '    this.loadSync();\n  }\n\n  ensureParentDirectory() {',
  '    this.loadSync();\n    this.migrateSeedbox();\n  }\n\n  readStateFile(filePath) {\n    if (!filePath) {\n      return null;\n    }\n    try {\n      const raw = fs.readFileSync(filePath, "utf8");\n      return JSON.parse(raw);\n    } catch {\n      return null;\n    }\n  }\n\n  migrateSeedbox() {\n    const seedboxFile = this.config?.seedboxFile;\n    if (!seedboxFile) {\n      return;\n    }\n    const raw = this.readStateFile(seedboxFile);\n    if (!raw) {\n      return;\n    }\n    const items = Array.isArray(raw?.items)\n      ? raw.items\n      : Array.isArray(raw?.tasks)\n        ? raw.tasks\n        : [];\n    if (!items.length) {\n      return;\n    }\n    const existingIds = new Set(this.state.memories.map((memory) => memory.id));\n    const migrated = items\n      .map((item) => migrateSeedboxItem(item, existingIds))\n      .filter(Boolean);\n    if (!migrated.length) {\n      return;\n    }\n    this.state.memories.push(...migrated);\n    this.state.memories.sort(compareMemories);\n    this.save();\n    console.log(`[cyberboss] migrated ${migrated.length} seedbox items into memory`);\n    try {\n      const backupPath = seedboxFile + ".migrated";\n      fs.writeFileSync(backupPath, JSON.stringify(raw, null, 2));\n      fs.unlinkSync(seedboxFile);\n    } catch (error) {\n      console.warn(`[cyberboss] seedbox migration cleanup failed: ${error?.message || error}`);\n    }\n  }\n\n  ensureParentDirectory() {'
);

content = content.replace(
  '    const now = new Date().toISOString();\n    const memory = normalizeMemory({\n      id: crypto.randomUUID(),\n      type: input.type,\n      subject: input.subject,\n      content: input.content,\n      status: "active",\n      confidence: input.confidence,\n      source: input.source,\n      sourceRef: input.sourceRef,\n      expiresAt: input.expiresAt,\n      expiresAtMs: normalizeTimeMs(input.expiresAtMs || input.expiresAt),\n      tags: input.tags,\n      createdAt: now,\n      updatedAt: now,',
  '    const now = new Date().toISOString();\n    const completedAt = COMPLETABLE_TYPES.has(normalizeText(input.type).toLowerCase())\n      ? ""\n      : normalizeIsoTime(input.completedAt);\n    const memory = normalizeMemory({\n      id: crypto.randomUUID(),\n      type: input.type,\n      subject: input.subject,\n      content: input.content,\n      status: "active",\n      confidence: input.confidence,\n      source: input.source,\n      sourceRef: input.sourceRef,\n      expiresAt: input.expiresAt,\n      expiresAtMs: normalizeTimeMs(input.expiresAtMs || input.expiresAt),\n      tags: input.tags,\n      completedAt,\n      createdAt: now,\n      updatedAt: now,'
);

content = content.replace(
  '    return memory;\n  }\n\n  list({ type = "", subject = "", includeArchived = false, limit = 20 } = {}) {',
  '    return memory;\n  }\n\n  async complete({ id = "", notes = "" } = {}) {\n    this.loadSync();\n    const memoryId = normalizeText(id);\n    if (!memoryId) {\n      throw new Error("Memory complete requires id.");\n    }\n    const index = this.state.memories.findIndex((memory) => memory.id === memoryId);\n    if (index < 0) {\n      throw new Error(`Memory not found: ${memoryId}`);\n    }\n    const current = this.state.memories[index];\n    const completedAt = new Date().toISOString();\n    const next = normalizeMemory({\n      ...current,\n      content: normalizeText(notes) || current.content,\n      completedAt,\n      updatedAt: completedAt,\n    });\n    this.state.memories[index] = next;\n    this.state.memories.sort(compareMemories);\n    this.save();\n    return next;\n  }\n\n  list({ type = "", subject = "", includeArchived = false, limit = 20 } = {}) {'
);

content = content.replace(
  '    const normalizedSubject = normalizeText(subject).toLowerCase();\n    const memories = this.state.memories\n      .filter((memory) => includeArchived || memory.status === "active")\n      .filter((memory) => !normalizedType || memory.type === normalizedType)',
  '    const normalizedSubject = normalizeText(subject).toLowerCase();\n    const includeCompleted = includeArchived === true;\n    const memories = this.state.memories\n      .filter((memory) => includeCompleted || !memory.completedAt)\n      .filter((memory) => includeArchived || memory.status === "active")\n      .filter((memory) => !normalizedType || memory.type === normalizedType)'
);

content = content.replace(
  '  async search({ query = "", limit = 20, includeArchived = false } = {}) {\n    this.loadSync();\n    const candidates = this.state.memories\n      .filter((memory) => includeArchived || memory.status === "active")',
  '  async search({ query = "", limit = 20, includeArchived = false } = {}) {\n    this.loadSync();\n    const includeCompleted = includeArchived === true;\n    const candidates = this.state.memories\n      .filter((memory) => includeCompleted || !memory.completedAt)\n      .filter((memory) => includeArchived || memory.status === "active")'
);

content = content.replace(
  '  const updatedAt = normalizeIsoTime(value.updatedAt) || createdAt;\n  const expiresAtMs = normalizeTimeMs(value.expiresAtMs || value.expiresAt);',
  '  const updatedAt = normalizeIsoTime(value.updatedAt) || createdAt;\n  const completedAt = resolveCompletedAt(value, updatedAt || createdAt);\n  const expiresAtMs = normalizeTimeMs(value.expiresAtMs || value.expiresAt);'
);

content = content.replace(
  '    lastUsedAt,\n    lastUsedAtMs,\n    embedding,\n  };',
  '    lastUsedAt,\n    lastUsedAtMs,\n    completedAt,\n    embedding,\n  };'
);

content = content.replace(
  'function compareMemories(left, right) {\n  if (left.status !== right.status) {',
  'function compareMemories(left, right) {\n  const leftCompleted = Boolean(left.completedAt);\n  const rightCompleted = Boolean(right.completedAt);\n  if (leftCompleted !== rightCompleted) {\n    return leftCompleted ? 1 : -1;\n  }\n  if (left.status !== right.status) {'
);

content = content.replace(
  'function isExpired(memory) {',
  'function resolveCompletedAt(value, fallbackTime) {\n  const completedAt = normalizeIsoTime(value.completedAt);\n  if (completedAt) {\n    return completedAt;\n  }\n  return "";\n}\n\nfunction migrateSeedboxItem(item, existingIds) {\n  if (!item || typeof item !== "object") {\n    return null;\n  }\n  const id = normalizeText(item.id);\n  if (!id || existingIds.has(id)) {\n    return null;\n  }\n  const kind = normalizeChoice(item.kind, new Set(["wishseed", "concern"]), "wishseed");\n  const title = normalizeText(item.title);\n  if (!title) {\n    return null;\n  }\n  existingIds.add(id);\n  const createdAt = normalizeIsoTime(item.createdAt) || new Date().toISOString();\n  const updatedAt = normalizeIsoTime(item.updatedAt) || createdAt;\n  const completedAt = normalizeIsoTime(item.completedAt) || resolveLegacySeedboxCompletedAt(item, updatedAt);\n  const tags = normalizeStringList(item.tags);\n  const notes = normalizeText(item.notes);\n  return normalizeMemory({\n    id,\n    type: kind,\n    subject: title,\n    content: notes || title,\n    status: "active",\n    confidence: 0.5,\n    source: "seedbox_migration",\n    tags,\n    createdAt,\n    updatedAt,\n    completedAt,\n  });\n}\n\nfunction resolveLegacySeedboxCompletedAt(item, fallbackTime) {\n  const legacyStatus = normalizeText(item.status).toLowerCase();\n  if (legacyStatus === "done" || legacyStatus === "cancelled") {\n    return normalizeIsoTime(item.updatedAt) || fallbackTime || new Date().toISOString();\n  }\n  return "";\n}\n\nfunction isExpired(memory) {'
);

content = content.replace(
  'module.exports = { AgentMemoryService };',
  'module.exports = { AgentMemoryService, COMPLETABLE_TYPES, MEMORY_TYPES };'
);

fs.writeFileSync(filePath, content);
console.log("agent-memory-service.js updated successfully");
