class AgentLifeService {
  constructor({ lifeIntegration }) {
    this.lifeIntegration = lifeIntegration;
  }

  async write({
    events = undefined,
    kind = "",
    title = "",
    why = "",
    action = "",
    outcome = "",
    result = "",
    nextAction = "",
    taskId = "",
    visibility = "",
    tags = undefined,
  } = {}) {
    const payload = Array.isArray(events)
      ? { events }
      : {
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
    const execution = await this.lifeIntegration.runSubcommand("write", [], payload);
    return {
      subcommand: "write",
      data: parseJsonOutput(execution, "write"),
      execution,
    };
  }

  async read({ limit = 20, since = "", kind = "", taskId = "" } = {}) {
    const args = buildReadArgs({ limit, since, kind, taskId });
    const execution = await this.lifeIntegration.runSubcommand("read", args);
    return {
      subcommand: "read",
      args,
      data: parseJsonOutput(execution, "read"),
      execution,
    };
  }

  async summary({ limit = 20, since = "" } = {}) {
    const args = buildReadArgs({ limit, since });
    const execution = await this.lifeIntegration.runSubcommand("summary", args);
    return {
      subcommand: "summary",
      args,
      data: parseJsonOutput(execution, "summary"),
      execution,
    };
  }
}

function buildReadArgs({ limit = 20, since = "", kind = "", taskId = "" } = {}) {
  const args = [];
  if (Number.isInteger(limit) && limit > 0) {
    args.push("--limit", String(limit));
  }
  if (normalizeText(since)) {
    args.push("--since", normalizeText(since));
  }
  if (normalizeText(kind)) {
    args.push("--kind", normalizeText(kind));
  }
  if (normalizeText(taskId)) {
    args.push("--task-id", normalizeText(taskId));
  }
  return args;
}

function parseJsonOutput(execution, subcommand) {
  const text = normalizeText(execution?.stdout);
  if (!text) {
    throw new Error(`life-for-agent ${subcommand} returned no JSON output.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`life-for-agent ${subcommand} returned invalid JSON output.`);
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { AgentLifeService };
