const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { RuntimeContextStore } = require("../src/tools/runtime-context-store");

test("runtime context store merges cross-process pulse exposure writes", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-runtime-context-"));
  const filePath = path.join(tempDir, "project-tool-runtime-context.json");

  const writerA = new RuntimeContextStore({ filePath });
  const writerB = new RuntimeContextStore({ filePath });

  writerA.setPulseExposureModule("D:/Codex", "scheduled_pulse", {
    pendingPulseDueAt: "2026-06-28T10:00:00.000Z",
  });

  writerB.setPulseExposureModule("D:/Codex", "contactGapFloor", {
    lastBotOutboundAt: "2026-06-28T09:50:00.000Z",
  });

  const reader = new RuntimeContextStore({ filePath });
  const scheduledPulse = reader.getPulseExposureModule("D:/Codex", "scheduled_pulse");
  const contactGap = reader.getPulseExposureModule("D:/Codex", "contactGapFloor");

  assert.equal(scheduledPulse?.pendingPulseDueAt, "2026-06-28T10:00:00.000Z");
  assert.equal(contactGap?.lastBotOutboundAt, "2026-06-28T09:50:00.000Z");
});

