const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { ObsidianService } = require("../src/services/obsidian-service");

test("obsidian randomDailyExcerpt samples a usable block from recent daily notes", () => {
  const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-obsidian-test-"));
  const dailyDir = path.join(vaultRoot, "Daily note");
  fs.mkdirSync(dailyDir, { recursive: true });
  fs.writeFileSync(path.join(dailyDir, "2026-06-19.md"), [
    "# 2026-06-19",
    "",
    "short",
    "",
    "I found a strange little seed of interest about handheld consoles and retail display design.",
  ].join("\n"));

  const service = new ObsidianService({
    config: {
      obsidianVaultRoot: vaultRoot,
      obsidianMaxSearchFiles: 100,
    },
  });
  const result = service.randomDailyExcerpt({ daysBack: 365, maxChars: 120 });

  assert.equal(result.found, true);
  assert.equal(result.relativePath, "Daily note/2026-06-19.md");
  assert.match(result.excerpt, /handheld consoles/);
});

test("obsidian search matches note body text and reports scan coverage", () => {
  const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-obsidian-search-test-"));
  fs.mkdirSync(path.join(vaultRoot, "Work"), { recursive: true });
  fs.writeFileSync(path.join(vaultRoot, "Work", "shift.md"), [
    "# Work notes",
    "",
    "今天在1903店工作，记录了一些交接和观察。",
  ].join("\n"));
  fs.writeFileSync(path.join(vaultRoot, "other.md"), "nothing relevant");

  const service = new ObsidianService({
    config: {
      obsidianVaultRoot: vaultRoot,
      obsidianMaxSearchFiles: 100,
    },
  });
  const result = service.search({ query: "1903", limit: 10 });

  assert.equal(result.resultCount, 1);
  assert.equal(result.searchedFiles, 2);
  assert.equal(result.searchTruncated, false);
  assert.equal(result.results[0].relativePath, "Work/shift.md");
  assert.match(result.results[0].snippet, /1903店工作/);
});
