const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { StoneBoxService } = require("../src/services/stone-box-service");

function createService() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-stone-test-"));
  return new StoneBoxService({
    config: {
      agentStoneBoxFile: path.join(stateDir, "agent-stone-box.json"),
    },
  });
}

test("stone box stores, searches, and updates serendipitous finds", () => {
  const service = createService();
  const stone = service.add({
    title: "Tiny museum site",
    content: "A small archive of unusual interface buttons.",
    whyInteresting: "Could inspire a playful product UI note.",
    source: "web_search",
    sourceRef: "https://example.com/archive",
    obsidianRef: "Daily note/2026-06-19.md",
    tags: ["design", "interface"],
  });

  const search = service.search({ query: "interface archive" });
  assert.equal(search.count, 1);
  assert.equal(search.stones[0].id, stone.id);

  const updated = service.update({ id: stone.id, status: "shared" });
  assert.equal(updated.status, "shared");
  assert.equal(service.list({ status: "shared" }).count, 1);
});
