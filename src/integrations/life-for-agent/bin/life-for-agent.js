#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const EVENT_KINDS = new Set([
  "pulse",
  "explore",
  "research",
  "memory",
  "diary",
  "user_timeline",
  "message",
  "maintenance",
  "decision",
]);

const OUTCOMES = new Set([
  "silent",
  "messaged_user",
  "wrote_diary",
  "updated_user_timeline",
  "updated_task",
  "created_task",
  "researched",
  "read_context",
  "no_action",
]);

async function main() {
  const [subcommand, ...args] = process.argv.slice(2);
  const stateDir = resolveStateDir();
  const storeFile = path.join(stateDir, "events.jsonl");
  fs.mkdirSync(stateDir, { recursive: true });

  if (subcommand === "write") {
    const input = await readStdinJson();
    const events = Array.isArray(input?.events) ? input.events : [input];
    const normalized = events.map(normalizeEvent).filter(Boolean);
    if (!normalized.length) {
      throw new Error("No valid life events were provided.");
    }
    fs.appendFileSync(storeFile, normalized.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
    writeJson({ status: "ok", eventCount: normalized.length, events: normalized });
    return;
  }

  if (subcommand === "read") {
    const options = parseOptions(args);
    const events = readEvents(storeFile)
      .filter((event) => matchesSince(event, options.since))
      .filter((event) => !options.kind || event.kind === options.kind)
      .filter((event) => !options.taskId || event.taskId === options.taskId)
      .sort((left, right) => String(right.at).localeCompare(String(left.at)))
      .slice(0, normalizeLimit(options.limit));
    writeJson({ status: "ok", eventCount: events.length, events });
    return;
  }

  if (subcommand === "summary") {
    const options = parseOptions(args);
    const events = readEvents(storeFile)
      .filter((event) => matchesSince(event, options.since))
      .sort((left, right) => String(right.at).localeCompare(String(left.at)));
    writeJson({
      status: "ok",
      eventCount: events.length,
      byKind: countBy(events, "kind"),
      byOutcome: countBy(events, "outcome"),
      recent: events.slice(0, normalizeLimit(options.limit)),
    });
    return;
  }

  throw new Error(`Unknown life-for-agent subcommand: ${subcommand || "(empty)"}`);
}

function resolveStateDir() {
  const configured = normalizeText(process.env.LIFE_FOR_AGENT_STATE_DIR);
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(process.cwd(), ".life-for-agent");
}

function parseOptions(args = []) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const next = args[index + 1];
    if (token === "--limit") {
      options.limit = next;
      index += 1;
    } else if (token === "--since") {
      options.since = next;
      index += 1;
    } else if (token === "--kind") {
      options.kind = normalizeText(next).toLowerCase();
      index += 1;
    } else if (token === "--task-id") {
      options.taskId = normalizeText(next);
      index += 1;
    }
  }
  return options;
}

function readEvents(storeFile) {
  try {
    return fs.readFileSync(storeFile, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .map(normalizeEvent)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const id = normalizeText(value.id) || crypto.randomUUID();
  const at = normalizeIsoTime(value.at) || new Date().toISOString();
  const kind = normalizeChoice(value.kind, EVENT_KINDS, "decision");
  const title = normalizeText(value.title);
  const why = normalizeText(value.why);
  const action = normalizeText(value.action);
  const outcome = normalizeChoice(value.outcome, OUTCOMES, "silent");
  const result = normalizeText(value.result);
  const nextAction = normalizeText(value.nextAction);
  const taskId = normalizeText(value.taskId);
  const visibility = normalizeText(value.visibility) || "private";
  const tags = normalizeStringList(value.tags);

  if (!title || !why) {
    return null;
  }
  return {
    id,
    at,
    kind,
    title,
    why,
    action,
    outcome,
    result,
    nextAction,
    taskId,
    visibility,
    tags,
  };
}

function matchesSince(event, since) {
  const normalized = normalizeText(since);
  if (!normalized) {
    return true;
  }
  const sinceMs = Date.parse(normalized);
  const eventMs = Date.parse(event.at);
  if (!Number.isFinite(sinceMs) || !Number.isFinite(eventMs)) {
    return true;
  }
  return eventMs >= sinceMs;
}

function countBy(events, field) {
  const counts = {};
  for (const event of events) {
    const key = normalizeText(event[field]) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function readStdinJson() {
  return new Promise((resolve, reject) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.once("error", reject);
    process.stdin.once("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (error) {
        reject(new Error(`Invalid JSON input: ${error.message}`));
      }
    });
  });
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
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

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
