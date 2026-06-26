const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { AgentMemoryService } = require("../src/services/agent-memory-service");

function createTempConfig() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-memory-"));
  return {
    agentMemoryFile: path.join(stateDir, "agent-memories.json"),
    seedboxFile: path.join(stateDir, "seedbox.json"),
    memoryDedupThreshold: 0.9,
    memoryDedupLimit: 3,
  };
}

function createEmbeddingService() {
  return {
    isConfigured() {
      return true;
    },
    async embed(texts) {
      return texts.map((text) => {
        const normalized = String(text || "").toLowerCase();
        if (normalized.includes("latte")) {
          return [1, 0];
        }
        return [0, 1];
      });
    },
  };
}

test("agent memory remember stores a new memory when no duplicate is found", async () => {
  const service = new AgentMemoryService({
    config: createTempConfig(),
    embeddingService: createEmbeddingService(),
  });

  const result = await service.remember({
    type: "preference",
    subject: "Coffee order",
    content: "Prefers oat milk latte.",
  });

  assert.equal(result.action, "stored");
  assert.equal(result.memory.subject, "Coffee order");
  assert.equal(service.list({ includeArchived: true }).count, 1);
});

test("agent memory remember returns duplicate candidates instead of storing", async () => {
  const service = new AgentMemoryService({
    config: createTempConfig(),
    embeddingService: createEmbeddingService(),
  });

  const first = await service.remember({
    type: "preference",
    subject: "Coffee order",
    content: "Prefers oat milk latte.",
  });
  assert.equal(first.action, "stored");

  const second = await service.remember({
    type: "preference",
    subject: "Morning drink",
    content: "Usually wants an oat milk latte.",
  });

  assert.equal(second.action, "review_existing");
  assert.equal(second.matches.length, 1);
  assert.equal(second.matches[0].subject, "Coffee order");
  assert.ok(second.matches[0].similarity >= 0.9);
  assert.equal(service.list({ includeArchived: true }).count, 1);
});
