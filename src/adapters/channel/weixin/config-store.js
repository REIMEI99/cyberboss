const fs = require("fs");
const path = require("path");

const DEFAULT_MIN_WEIXIN_CHUNK = 20;
const MAX_MIN_WEIXIN_CHUNK = 3800;
const DEFAULT_SHOW_TOOL_CALLS = false;

function loadWeixinConfig(config) {
  const filePath = config?.weixinConfigFile;
  const envDefault = normalizeMinChunkChars(
    config?.weixinMinChunkChars,
    DEFAULT_MIN_WEIXIN_CHUNK,
  );
  const showToolCallsDefault = typeof config?.weixinShowToolCalls === "boolean"
    ? config.weixinShowToolCalls
    : DEFAULT_SHOW_TOOL_CALLS;
  if (!filePath) {
    return {
      minChunkChars: envDefault,
      showToolCalls: showToolCallsDefault,
    };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      minChunkChars: normalizeMinChunkChars(parsed?.minChunkChars, envDefault),
      showToolCalls: normalizeShowToolCalls(parsed?.showToolCalls, showToolCallsDefault),
    };
  } catch {
    return {
      minChunkChars: envDefault,
      showToolCalls: showToolCallsDefault,
    };
  }
}

function saveWeixinConfig(config, values) {
  const filePath = config?.weixinConfigFile;
  if (!filePath) {
    return;
  }
  const current = loadWeixinConfig(config);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        minChunkChars: normalizeMinChunkChars(values?.minChunkChars, current.minChunkChars),
        showToolCalls: normalizeShowToolCalls(values?.showToolCalls, current.showToolCalls),
      },
      null,
      2,
    ),
  );
}

function normalizeMinChunkChars(value, defaultValue = DEFAULT_MIN_WEIXIN_CHUNK) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isFinite(parsed) && parsed >= 1 && parsed <= MAX_MIN_WEIXIN_CHUNK) {
    return parsed;
  }
  return defaultValue;
}

function normalizeShowToolCalls(value, defaultValue = DEFAULT_SHOW_TOOL_CALLS) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return Boolean(defaultValue);
}

module.exports = {
  loadWeixinConfig,
  saveWeixinConfig,
  DEFAULT_MIN_WEIXIN_CHUNK,
  MAX_MIN_WEIXIN_CHUNK,
  DEFAULT_SHOW_TOOL_CALLS,
  normalizeMinChunkChars,
  normalizeShowToolCalls,
};
