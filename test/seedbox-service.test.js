const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { SeedboxService } = require("../src/services/seedbox-service");

function createService({ initialState } = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-seedbox-test-"));
  const seedboxFile = path.join(stateDir, "seedbox.json");
  if (initialState) {
    fs.writeFileSync(seedboxFile, JSON.stringify(initialState, null, 2));
  }
  return new SeedboxService({
    config: {
      seedboxFile,
      legacyTaskFile: path.join(stateDir, "agent-tasks.json"),
    },
  });
}

test("seedbox service only returns simplified fields and supports completion", () => {
  const service = createService();
  const created = service.create({
    kind: "concern",
    title: "Housing uncertainty",
    tags: ["life"],
    notes: "Renewal risk in August.",
  });

  assert.equal(created.kind, "concern");
  assert.equal(created.title, "Housing uncertainty");
  assert.deepEqual(created.tags, ["life"]);
  assert.equal(created.completedAt, "");
  assert.equal("status" in created, false);
  assert.equal("priority" in created, false);
  assert.equal("nextAction" in created, false);

  const completed = service.complete({ id: created.id, notes: "Already handled." });
  assert.ok(completed.completedAt);
  assert.equal(completed.notes, "Already handled.");

  const activeList = service.list({});
  assert.equal(activeList.count, 0);

  const fullList = service.list({ includeCompleted: true });
  assert.equal(fullList.count, 1);
  assert.ok(fullList.items[0].completedAt);
  assert.equal("status" in fullList.items[0], false);
});

test("seedbox service normalizes legacy status-based items into completedAt without exposing old fields", () => {
  const service = createService({
    initialState: {
      items: [{
        id: "legacy-1",
        kind: "wishseed",
        title: "Old saved item",
        status: "done",
        priority: "high",
        nextAction: "Ignore me",
        tags: ["archive"],
        notes: "legacy",
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-21T00:00:00.000Z",
      }],
    },
  });

  const result = service.list({ includeCompleted: true });
  assert.equal(result.count, 1);
  assert.equal(result.items[0].id, "legacy-1");
  assert.equal(result.items[0].completedAt, "2026-06-21T00:00:00.000Z");
  assert.equal("status" in result.items[0], false);
  assert.equal("priority" in result.items[0], false);
  assert.equal("nextAction" in result.items[0], false);
});
