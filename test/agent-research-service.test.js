const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { AgentResearchService } = require("../src/services/agent-research-service");

function createService() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-research-test-"));
  return new AgentResearchService({
    config: {
      agentResearchFile: path.join(stateDir, "agent-research.json"),
    },
  });
}

test("agent research imports legacy research memories when research file is empty", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-research-test-"));
  const memoryFile = path.join(stateDir, "agent-memories.json");
  fs.writeFileSync(memoryFile, JSON.stringify({
    memories: [{
      id: "legacy-research-1",
      type: "research",
      subject: "legacy channel research",
      content: "Old research synthesis.",
      confidence: 0.8,
      source: "web_search",
      sourceRef: "legacy",
      tags: ["retail"],
      createdAt: "2026-06-18T10:00:00.000Z",
      updatedAt: "2026-06-18T11:00:00.000Z",
    }],
  }));

  const service = new AgentResearchService({
    config: {
      agentResearchFile: path.join(stateDir, "agent-research.json"),
      agentMemoryFile: memoryFile,
    },
  });

  const result = service.list({});
  assert.equal(result.count, 1);
  assert.equal(result.research[0].id, "legacy-research-1");
  assert.equal(result.research[0].topic, "legacy channel research");
  assert.equal(result.research[0].synthesis, "Old research synthesis.");
});

test("agent research upsert creates and appends evolving topic notes", () => {
  const service = createService();
  const first = service.upsert({
    topic: "phone retail channel",
    hypothesis: "Offline stores need service revenue, not only new phone margin.",
    notes: ["Repair and trade-in look structurally important."],
    openQuestions: ["How much commission remains in operator plans?"],
    tags: ["retail", "3c"],
  });

  const second = service.upsert({
    topic: "phone retail channel",
    evidence: ["2026 operator commission is reportedly tightening."],
    synthesis: "Service revenue is the durable axis to test.",
  });

  assert.equal(second.id, first.id);
  assert.equal(second.notes.length, 1);
  assert.equal(second.evidence.length, 1);
  assert.equal(second.openQuestions.length, 1);
  assert.equal(second.synthesis, "Service revenue is the durable axis to test.");
});

test("agent research search and archive manage dedicated research state", () => {
  const service = createService();
  const item = service.upsert({
    topic: "private domain retail",
    notes: ["Community group buying may create repeat purchase loops."],
    nextAction: "Compare community stores and phone stores.",
  });

  const results = service.search({ query: "community retail" });
  assert.equal(results.count, 1);
  assert.equal(results.research[0].id, item.id);

  const archived = service.archive({ id: item.id, reason: "converted to briefing" });
  assert.equal(archived.status, "archived");
  assert.equal(service.list({}).count, 0);
  assert.equal(service.list({ includeArchived: true }).count, 1);
});
